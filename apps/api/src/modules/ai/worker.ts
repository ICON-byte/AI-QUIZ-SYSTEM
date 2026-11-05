import { Prisma } from '../../generated/prisma/client.js';
import type { Database } from '../../infrastructure/database.js';
import type { Config } from '../../config/env.js';
import { databaseNow, lock } from '../quizzes/data.js';
import {
  generationInputSchema,
  validateOutput,
  OutputFailure,
} from './validation.js';
import { createAiService, isAiConfigured } from './service.js';
import {
  ProviderFailure,
  type QuestionProvider,
  type ProviderMetadata,
} from './provider.js';

export function createAiWorker(
  db: Database,
  config: Config,
  provider: QuestionProvider,
) {
  let busy = false;
  let stopped = false;
  let controller: AbortController | undefined;
  const service = createAiService(db, config);
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    let jobId: string | undefined;
    try {
      await service.cleanup();
      if (!isAiConfigured(config)) return;
      const job = await db.$transaction(async (tx) => {
        await lock(tx, 'ai-dispatch');
        const now = await databaseNow(tx);
        const dispatch = await tx.aiDispatch.upsert({
          where: { id: 'project' },
          create: { id: 'project' },
          update: {},
        });
        if (
          (dispatch.leaseUntil && dispatch.leaseUntil > now) ||
          (dispatch.nextCallAt && dispatch.nextCallAt > now)
        )
          return null;
        const candidate = await tx.aiGeneration.findFirst({
          where: { status: 'QUEUED', deadlineAt: { gt: now } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            user: { select: { status: true, adultConfirmedAt: true } },
          },
        });
        if (!candidate) return null;
        if (
          candidate.user.status !== 'ACTIVE' ||
          !candidate.user.adultConfirmedAt
        ) {
          await tx.aiGeneration.update({
            where: { id: candidate.id },
            data: {
              status: 'FAILED',
              input: Prisma.DbNull,
              failureCode: 'ACCOUNT_INELIGIBLE',
              completedAt: now,
            },
          });
          return null;
        }
        await tx.aiDispatch.update({
          where: { id: 'project' },
          data: { jobId: candidate.id, leaseUntil: candidate.deadlineAt },
        });
        return tx.aiGeneration.update({
          where: { id: candidate.id },
          data: { status: 'RUNNING', phase: 'PACING' },
        });
      });
      if (!job) return;
      jobId = job.id;
      const input = generationInputSchema.parse(job.input);
      controller = new AbortController();
      const now = await db.$transaction((tx) => databaseNow(tx));
      const deadlineTimer = setTimeout(
        () => controller?.abort(),
        Math.max(1, job.deadlineAt.getTime() - now.getTime()),
      );
      let result: ReturnType<typeof validateOutput> | undefined;
      let failure = 'GENERATION_TIMEOUT';
      const diagnostics: object[] = [];
      let recovery: { category: string; fields: string[] } | undefined;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (controller.signal.aborted || stopped) break;
          // Reserve each actual call under the same global lock, including retries.
          const reservation = await db.$transaction(async (tx) => {
            await lock(tx, 'ai-dispatch');
            const time = await databaseNow(tx);
            const current = await tx.aiGeneration.findUnique({
              where: { id: job.id },
            });
            const dispatch = await tx.aiDispatch.findUnique({
              where: { id: 'project' },
            });
            if (
              current?.status !== 'RUNNING' ||
              current.deadlineAt <= time ||
              dispatch?.jobId !== job.id
            )
              return { invalid: true, wait: 0 };
            if (dispatch.nextCallAt && dispatch.nextCallAt > time)
              return { wait: dispatch.nextCallAt.getTime() - time.getTime() };
            const day = time.toISOString().slice(0, 10);
            const bucket = await tx.aiUsageBucket.upsert({
              where: { day },
              create: { day },
              update: {},
            });
            if (bucket.providerCalls >= config.AI_DAILY_PROJECT_CALL_LIMIT)
              return { limit: true, wait: 0 };
            await tx.aiUsageBucket.update({
              where: { day },
              data: { providerCalls: { increment: 1 } },
            });
            await tx.aiDispatch.update({
              where: { id: 'project' },
              data: {
                nextCallAt: new Date(
                  time.getTime() + config.AI_CALL_INTERVAL_SECONDS * 1000,
                ),
              },
            });
            await tx.aiGeneration.update({
              where: { id: job.id },
              data: { providerAttempts: { increment: 1 }, phase: 'CALLING' },
            });
            return { wait: 0 };
          });
          if (reservation.invalid) break;
          if (reservation.limit) {
            failure = 'PROJECT_LIMIT';
            break;
          }
          if (reservation.wait) {
            attempt--;
            await pause(reservation.wait, controller.signal);
            continue;
          }
          let metadata: ProviderMetadata = {};
          try {
            const response = await Promise.race([
              provider.generate(input, job.model, controller.signal, recovery),
              aborted(controller.signal),
            ]);
            const raw = typeof response === 'string' ? response : response.text;
            metadata = typeof response === 'string' ? {} : response.metadata;
            try {
              result = validateOutput(raw, input);
            } catch (error) {
              if (!(error instanceof OutputFailure)) throw error;
              recovery = { category: error.code, fields: error.fields };
              diagnostics.push({
                attempt: attempt + 1,
                ...metadata,
                category: error.code,
                fields: error.fields,
              });
              throw new ProviderFailure(
                'INVALID_AI_OUTPUT',
                true,
                1000,
                metadata,
              );
            }
            diagnostics.push({
              attempt: attempt + 1,
              ...metadata,
              category: 'VALID',
            });
            await db.aiGeneration.updateMany({
              where: { id: job.id, status: 'RUNNING' },
              data: { diagnostics: JSON.parse(JSON.stringify(diagnostics)) },
            });
            break;
          } catch (error) {
            const known =
              error instanceof ProviderFailure
                ? error
                : new ProviderFailure(
                    controller.signal.aborted
                      ? 'GENERATION_TIMEOUT'
                      : 'PROVIDER_CONNECTION',
                  );
            failure = known.code;
            if (diagnostics.length <= attempt)
              diagnostics.push({
                attempt: attempt + 1,
                ...known.metadata,
                category: known.code,
              });
            // Even a caller-supplied retryable flag cannot replay permanent failures.
            const eligible =
              known.retryable &&
              [
                'INVALID_AI_OUTPUT',
                'OUTPUT_TRUNCATED',
                'EMPTY_OUTPUT',
                'PROVIDER_TEMPORARY',
              ].includes(known.code);
            await db.aiGeneration.updateMany({
              where: { id: job.id, status: 'RUNNING' },
              data: {
                diagnostics: JSON.parse(JSON.stringify(diagnostics)),
                phase: eligible && attempt < 1 ? 'RECOVERING' : 'CALLING',
              },
            });
            if (!eligible || attempt === 1) break;
            await pause(known.retryAfterMs || 1000, controller.signal);
          }
        }
      } finally {
        clearTimeout(deadlineTimer);
      }
      await db.$transaction(async (tx) => {
        const time = await databaseNow(tx);
        await tx.aiGeneration.updateMany({
          where: { id: job.id, status: 'RUNNING' },
          data:
            result && time < job.deadlineAt
              ? {
                  status: 'READY',
                  result: result as Prisma.InputJsonValue,
                  input: Prisma.DbNull,
                  charged: true,
                  completedAt: time,
                  resultExpiresAt: new Date(time.getTime() + 86400000),
                }
              : {
                  status: 'FAILED',
                  failureCode:
                    time >= job.deadlineAt ? 'GENERATION_TIMEOUT' : failure,
                  input: Prisma.DbNull,
                  result: Prisma.DbNull,
                  completedAt: time,
                },
        });
      });
    } catch {
      if (jobId)
        await db.aiGeneration
          .updateMany({
            where: { id: jobId, status: 'RUNNING' },
            data: {
              status: 'FAILED',
              input: Prisma.DbNull,
              failureCode: 'PROVIDER_CONNECTION',
              completedAt: new Date(),
            },
          })
          .catch(() => {});
      // No provider errors, prompts or source text are logged.
    } finally {
      if (jobId)
        await db
          .$transaction(async (tx) => {
            await lock(tx, 'ai-dispatch');
            await tx.aiDispatch.updateMany({
              where: { id: 'project', jobId },
              data: { jobId: null, leaseUntil: null },
            });
          })
          .catch(() => {});
      controller = undefined;
      busy = false;
    }
  }
  return {
    tick,
    stop() {
      stopped = true;
      controller?.abort();
    },
    start() {
      const timer = setInterval(() => {
        void tick();
      }, 2000);
      timer.unref();
      void tick();
      return () => {
        clearInterval(timer);
        stopped = true;
        controller?.abort();
      };
    },
  };
}
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', end);
      resolve();
    };
    const timer = setTimeout(end, ms);
    signal.addEventListener('abort', end, { once: true });
  });
}
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new ProviderFailure('GENERATION_TIMEOUT'));
    else
      signal.addEventListener(
        'abort',
        () => reject(new ProviderFailure('GENERATION_TIMEOUT')),
        { once: true },
      );
  });
}
