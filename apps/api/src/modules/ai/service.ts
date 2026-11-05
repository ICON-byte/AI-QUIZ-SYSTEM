import { createHash } from 'node:crypto';
import { Prisma, type AiGeneration } from '../../generated/prisma/client.js';
import type { Database } from '../../infrastructure/database.js';
import type { Config } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';
import { databaseNow, lock } from '../quizzes/data.js';
import { saveAcceptedQuestions } from '../banks/service.js';
import {
  acceptSchema,
  generationInputSchema,
  reviewSchema,
  type GenerationInput,
} from './validation.js';
import type { z } from 'zod';

const active = ['QUEUED', 'RUNNING'] as const;
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const failureMessages: Record<string, string> = {
  PROVIDER_REQUEST:
    'Gemini rejected the request configuration. Ask the operator to check the model, credentials and supported request settings. Your allowance was not used.',
  GENERATION_TIMEOUT:
    'Generation did not finish in time. Your daily generation allowance was not used.',
  INVALID_AI_OUTPUT:
    'The AI response could not be validated. Try a narrower topic, more source text, or fewer questions. Your allowance was not used.',
  OUTPUT_TRUNCATED:
    'Gemini reached the response token limit. Try fewer questions. Your allowance was not used.',
  OUTPUT_BLOCKED:
    'Gemini could not return this content. Review the topic or material. Your allowance was not used.',
  EMPTY_OUTPUT:
    'Gemini returned no questions. Try a narrower topic. Your allowance was not used.',
  MODEL_UNAVAILABLE:
    'The configured model is unavailable or does not support this request. Ask the operator to check GEMINI_MODEL in AI Studio.',
  PROVIDER_CONFIGURATION:
    'Gemini access is unavailable. Ask the operator to check the API key and project permissions.',
  PROVIDER_QUOTA:
    'Google’s project quota is exhausted or temporarily limited. Try later. Your generation allowance was not used.',
  PROVIDER_TEMPORARY:
    'Gemini is temporarily unavailable. Please try later. Your allowance was not used.',
  PROVIDER_CONNECTION:
    'The connection to Gemini failed. Please try again later. Your allowance was not used.',
  PROJECT_LIMIT:
    'The application’s daily AI call limit has been reached. Your allowance was not used.',
  ACCOUNT_INELIGIBLE: 'This account is no longer eligible for AI generation.',
};
export function generationDto(job: AiGeneration) {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    providerAttempts: job.providerAttempts,
    summary:
      job.summaryExpiresAt && job.summaryExpiresAt > new Date()
        ? job.summary
        : null,
    diagnostics: job.diagnostics,
    createdAt: job.createdAt.toISOString(),
    deadlineAt: job.deadlineAt.toISOString(),
    expiresAt: job.resultExpiresAt?.toISOString() ?? null,
    result: job.status === 'READY' ? job.result : null,
    acceptance: job.acceptance,
    failure: job.failureCode
      ? {
          code: job.failureCode,
          message:
            failureMessages[job.failureCode] ??
            'Generation was stopped. Your allowance was not used.',
        }
      : null,
  };
}
export const isAiConfigured = (config: Config) =>
  !!config.GEMINI_API_KEY && !!config.GEMINI_MODEL;
export async function requireAiEligible(db: Database, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true, adultConfirmedAt: true },
  });
  if (!user || user.status !== 'ACTIVE' || !user.adultConfirmedAt)
    throw new HttpError(
      403,
      'AGE_CONFIRMATION_REQUIRED',
      'Confirm you are at least 18 years old before using AI generation.',
    );
}
export function createAiService(db: Database, config: Config) {
  return {
    async cleanup() {
      const now = await db.$transaction((tx) => databaseNow(tx));
      await db.aiGeneration.updateMany({
        where: { status: { in: [...active] }, deadlineAt: { lte: now } },
        data: {
          status: 'FAILED',
          failureCode: 'GENERATION_TIMEOUT',
          input: Prisma.DbNull,
          result: Prisma.DbNull,
          completedAt: now,
        },
      });
      await db.aiGeneration.updateMany({
        where: { status: 'READY', resultExpiresAt: { lte: now } },
        data: { status: 'EXPIRED', result: Prisma.DbNull },
      });
      await db.aiGeneration.updateMany({
        where: { summaryExpiresAt: { lte: now } },
        data: { summary: Prisma.DbNull, summaryExpiresAt: null },
      });
      await db.aiGeneration.deleteMany({
        where: {
          status: { notIn: [...active] },
          createdAt: { lt: new Date(now.getTime() - 30 * 86400000) },
        },
      });
      await db.aiUsageBucket.deleteMany({
        where: {
          day: {
            lt: new Date(now.getTime() - 30 * 86400000)
              .toISOString()
              .slice(0, 10),
          },
        },
      });
    },
    async capabilities(userId: string) {
      const now = await db.$transaction((tx) => databaseNow(tx));
      const day = now.toISOString().slice(0, 10);
      const [used, reserved, current, user] = await Promise.all([
        db.aiGeneration.count({
          where: { userId, quotaDay: day, charged: true },
        }),
        db.aiGeneration.count({
          where: {
            userId,
            quotaDay: day,
            status: { in: [...active] },
            deadlineAt: { gt: now },
          },
        }),
        db.aiGeneration.findFirst({
          where: {
            userId,
            status: { in: [...active] },
            deadlineAt: { gt: now },
          },
        }),
        db.user.findUnique({
          where: { id: userId },
          select: { adultConfirmedAt: true },
        }),
      ]);
      return {
        available: isAiConfigured(config),
        ageConfirmed: !!user?.adultConfirmedAt,
        used,
        reserved,
        remaining: Math.max(0, config.AI_DAILY_USER_LIMIT - used - reserved),
        dailyLimit: config.AI_DAILY_USER_LIMIT,
        resetsAt: new Date(
          Date.parse(day + 'T00:00:00Z') + 86400000,
        ).toISOString(),
        currentJobId: current?.id ?? null,
        recentJobId:
          (
            await db.aiGeneration.findFirst({
              where: {
                userId,
                status: { in: ['READY', 'FAILED'] },
                summaryExpiresAt: { gt: now },
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            })
          )?.id ?? null,
        limits: {
          fileBytes: config.AI_DOCUMENT_MAX_BYTES,
          characters: config.AI_DOCUMENT_MAX_CHARACTERS,
          pages: config.AI_DOCUMENT_MAX_PAGES,
        },
      };
    },
    async eligibility(userId: string) {
      await db.user.update({
        where: { id: userId },
        data: { adultConfirmedAt: new Date() },
      });
      return { ageConfirmed: true };
    },
    async create(userId: string, raw: GenerationInput) {
      if (!isAiConfigured(config))
        throw new HttpError(
          503,
          'AI_UNAVAILABLE',
          'AI generation is unavailable until the operator configures a Gemini key and a project-verified model.',
        );
      await requireAiEligible(db, userId);
      const input = generationInputSchema.parse(raw);
      if (
        input.segments.reduce((n, s) => n + s.text.length, 0) >
        config.AI_DOCUMENT_MAX_CHARACTERS
      )
        throw new HttpError(
          400,
          'SOURCE_TOO_LONG',
          'The reviewed text exceeds the configured text limit.',
        );
      return db.$transaction(async (tx) => {
        await lock(tx, `ai-user:${userId}`);
        const now = await databaseNow(tx);
        const existing = await tx.aiGeneration.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        const requestHash = hash(input);
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new HttpError(
              409,
              'REQUEST_CHANGED',
              'This request identifier was already used for different content. Start a new generation.',
            );
          // Reconnect retries must honor the same expiry rules as GET, even before cleanup.
          if (
            existing.status === 'READY' &&
            existing.resultExpiresAt &&
            existing.resultExpiresAt <= now
          )
            await tx.aiGeneration.updateMany({
              where: {
                id: existing.id,
                status: 'READY',
                resultExpiresAt: { lte: now },
              },
              data: { status: 'EXPIRED', result: Prisma.DbNull },
            });
          if (
            (active as readonly string[]).includes(existing.status) &&
            existing.deadlineAt <= now
          )
            await tx.aiGeneration.updateMany({
              where: {
                id: existing.id,
                status: { in: [...active] },
                deadlineAt: { lte: now },
              },
              data: {
                status: 'FAILED',
                input: Prisma.DbNull,
                result: Prisma.DbNull,
                failureCode: 'GENERATION_TIMEOUT',
                completedAt: now,
              },
            });
          return generationDto(
            await tx.aiGeneration.findUniqueOrThrow({
              where: { id: existing.id },
            }),
          );
        }
        const day = now.toISOString().slice(0, 10);
        // Expired reservations are released atomically before allocating another one.
        await tx.aiGeneration.updateMany({
          where: {
            userId,
            status: { in: [...active] },
            deadlineAt: { lte: now },
          },
          data: {
            status: 'FAILED',
            input: Prisma.DbNull,
            failureCode: 'GENERATION_TIMEOUT',
            completedAt: now,
          },
        });
        if (
          await tx.aiGeneration.count({
            where: { userId, status: { in: [...active] } },
          })
        )
          throw new HttpError(
            409,
            'GENERATION_ACTIVE',
            'You already have an active generation. Resume it before starting another.',
          );
        const count = await tx.aiGeneration.count({
          where: {
            userId,
            quotaDay: day,
            OR: [{ charged: true }, { status: { in: [...active] } }],
          },
        });
        if (count >= config.AI_DAILY_USER_LIMIT)
          throw new HttpError(
            429,
            'USER_AI_LIMIT',
            'Your daily generation allowance has been reached. It resets at midnight UTC.',
          );
        await lock(tx, 'ai-dispatch');
        const budget = await tx.aiUsageBucket.findUnique({ where: { day } });
        const queued = await tx.aiGeneration.count({
          where: { status: { in: [...active] } },
        });
        if (
          (budget?.providerCalls ?? 0) + queued >=
          config.AI_DAILY_PROJECT_CALL_LIMIT
        )
          throw new HttpError(
            429,
            'PROJECT_AI_LIMIT',
            'The application’s AI call allowance is reserved or exhausted. Try later.',
          );
        return generationDto(
          await tx.aiGeneration.create({
            data: {
              userId,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              input: input as Prisma.InputJsonValue,
              summary: {
                kind: input.kind,
                topic: input.kind === 'TOPIC' ? input.topic : '',
                difficulty: input.difficulty,
                count: input.count,
              },
              summaryExpiresAt: new Date(now.getTime() + 86400000),
              model: config.GEMINI_MODEL,
              quotaDay: day,
              deadlineAt: new Date(
                now.getTime() + config.AI_JOB_TIMEOUT_SECONDS * 1000,
              ),
            },
          }),
        );
      });
    },
    async get(userId: string, id: string) {
      const job = await db.aiGeneration.findFirst({ where: { id, userId } });
      if (!job)
        throw new HttpError(
          404,
          'GENERATION_NOT_FOUND',
          'This generation was not found.',
        );
      const now = await db.$transaction((tx) => databaseNow(tx));
      if (
        (active as readonly string[]).includes(job.status) &&
        job.deadlineAt <= now
      ) {
        await db.aiGeneration.updateMany({
          where: {
            id,
            userId,
            status: { in: [...active] },
            deadlineAt: { lte: now },
          },
          data: {
            status: 'FAILED',
            input: Prisma.DbNull,
            failureCode: 'GENERATION_TIMEOUT',
            completedAt: now,
          },
        });
        return generationDto(
          await db.aiGeneration.findUniqueOrThrow({ where: { id } }),
        );
      }
      if (
        job.status === 'READY' &&
        job.resultExpiresAt &&
        job.resultExpiresAt <= now
      ) {
        await db.aiGeneration.updateMany({
          where: { id, userId, status: 'READY', resultExpiresAt: { lte: now } },
          data: { status: 'EXPIRED', result: Prisma.DbNull },
        });
        return generationDto(
          await db.aiGeneration.findUniqueOrThrow({ where: { id } }),
        );
      }
      return generationDto(job);
    },
    async discard(userId: string, id: string) {
      const result = await db.aiGeneration.updateMany({
        where: { id, userId },
        data: {
          status: 'DELETED',
          summary: Prisma.DbNull,
          summaryExpiresAt: null,
          diagnostics: Prisma.DbNull,
          failureCode: null,
          input: Prisma.DbNull,
          result: Prisma.DbNull,
        },
      });
      if (!result.count)
        throw new HttpError(
          404,
          'GENERATION_NOT_FOUND',
          'This generation was not found.',
        );
    },
    async review(
      userId: string,
      id: string,
      raw: z.infer<typeof reviewSchema>,
    ) {
      const input = reviewSchema.parse(raw);
      const job = await db.aiGeneration.findFirst({ where: { id, userId } });
      if (!job)
        throw new HttpError(
          404,
          'GENERATION_NOT_FOUND',
          'This generation was not found.',
        );
      const now = await db.$transaction((tx) => databaseNow(tx));
      if (
        job.status !== 'READY' ||
        !job.resultExpiresAt ||
        job.resultExpiresAt <= now
      )
        throw new HttpError(
          409,
          'REVIEW_EXPIRED',
          'This review is unavailable or expired.',
        );
      return input;
    },
    async accept(
      userId: string,
      id: string,
      raw: z.infer<typeof acceptSchema>,
    ) {
      const input = acceptSchema.parse(raw);
      return db.$transaction(async (tx) => {
        await lock(tx, `ai-job:${id}`);
        // A schema-aware no-op update locks the row against expiry/deletion.
        await tx.aiGeneration.updateMany({
          where: { id, userId },
          data: { id },
        });
        const job = await tx.aiGeneration.findFirst({ where: { id, userId } });
        if (!job)
          throw new HttpError(
            404,
            'GENERATION_NOT_FOUND',
            'This generation was not found.',
          );
        const requestHash = hash(input);
        if (job.acceptance) {
          const previous = job.acceptance as {
            requestHash: string;
            bankId: string;
            savedCount: number;
          };
          if (previous.requestHash !== requestHash)
            throw new HttpError(
              409,
              'ALREADY_ACCEPTED',
              'This generation was already saved. Use your bank to copy or edit those questions.',
            );
          return { bankId: previous.bankId, savedCount: previous.savedCount };
        }
        const now = await databaseNow(tx);
        if (
          job.status !== 'READY' ||
          !job.resultExpiresAt ||
          job.resultExpiresAt <= now
        )
          throw new HttpError(
            409,
            'GENERATION_NOT_READY',
            'This generation is not ready or its review expired.',
          );
        const saved = await saveAcceptedQuestions(tx, userId, input);
        await tx.aiGeneration.update({
          where: { id },
          data: { acceptance: { ...saved, requestHash } },
        });
        return saved;
      });
    },
  };
}
