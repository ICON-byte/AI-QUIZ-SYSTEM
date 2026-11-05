import { randomUUID } from 'node:crypto';
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database.js';
import { createApp } from '../src/app.js';
import { createAiService } from '../src/modules/ai/service.js';
import { createAiWorker } from '../src/modules/ai/worker.js';
import {
  ProviderFailure,
  type QuestionProvider,
} from '../src/modules/ai/provider.js';
import { generationInputSchema } from '../src/modules/ai/validation.js';
import { createBankService } from '../src/modules/banks/service.js';
import { createQuizService } from '../src/modules/quizzes/service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { educationalText, mockQuestions } from './ai-fixtures.js';

const config = {
  ...loadConfig(),
  GEMINI_API_KEY: 'mock-only-key',
  GEMINI_MODEL: 'mock-model',
  AI_CALL_INTERVAL_SECONDS: 1,
};
if (
  !/^auth_test_[a-f0-9]{16}$/.test(process.env.TEST_SCHEMA ?? '') ||
  new URL(config.DATABASE_URL).searchParams.get('schema') !==
    process.env.TEST_SCHEMA
)
  throw new Error('Use the isolated PostgreSQL integration runner.');
const db = createDatabase(config.DATABASE_URL);
const { app, ready } = createApp(db, config);
const service = createAiService(db, config);
type Account = { id: string; cookies: string[] };
let owner: Account;
let stranger: Account;
const input = () =>
  generationInputSchema.parse({
    idempotencyKey: randomUUID(),
    kind: 'TOPIC',
    topic: 'Cell biology',
    difficulty: 'MEDIUM',
    count: 5,
    nonSensitiveConfirmed: true,
  });
const provider: QuestionProvider = {
  generate: async (request) => JSON.stringify(mockQuestions(request)),
};
const mutate = (path: string, body: object, account = owner) =>
  request(app)
    .post('/api/v1' + path)
    .set('Cookie', account.cookies)
    .set('Origin', config.APP_ORIGIN)
    .set('X-CSRF-Protection', '1')
    .send(body);
const get = (path: string, account = owner) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', account.cookies);
async function readyJob() {
  const job = await service.create(owner.id, input());
  await createAiWorker(db, config, provider).tick();
  return service.get(owner.id, job.id);
}
beforeAll(async () => {
  await ready;
  async function register() {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-CSRF-Protection', '1')
      .send({
        email: randomUUID() + '@example.edu',
        displayName: 'Ada Okoro',
        password: 'safe-test-passphrase-2026',
        role: 'STUDENT',
        ageConfirmed: true,
      });
    expect(response.status).toBe(201);
    return {
      id: response.body.user.id as string,
      cookies: (response.headers['set-cookie'] as unknown as string[]).map(
        (v) => v.split(';')[0]!,
      ),
    };
  }
  owner = await register();
  stranger = await register();
});
beforeEach(async () => {
  await db.aiGeneration.deleteMany();
  await db.aiUsageBucket.deleteMany();
  await db.aiDispatch.deleteMany();
});
afterAll(async () => {
  await db.$disconnect();
});
describe.sequential(
  'PostgreSQL AI jobs, ownership and quota accounting',
  () => {
    it('requires age eligibility and explicit privacy consent without weakening CSRF', async () => {
      expect((await request(app).get('/api/v1/ai/capabilities')).status).toBe(
        401,
      );
      expect(
        (
          await request(app)
            .post('/api/v1/ai/generations')
            .set('Cookie', owner.cookies)
            .send(input())
        ).status,
      ).toBe(403);
      expect(
        (
          await mutate('/ai/generations', {
            ...input(),
            nonSensitiveConfirmed: false,
          })
        ).status,
      ).toBe(400);
      await db.user.update({
        where: { id: owner.id },
        data: { adultConfirmedAt: null },
      });
      expect((await mutate('/ai/generations', input())).status).toBe(403);
      expect(
        (await mutate('/ai/eligibility', { ageConfirmed: true })).status,
      ).toBe(200);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .adultConfirmedAt,
      ).not.toBeNull();
    });
    it('keeps manual functionality available when AI keys or models are missing', async () => {
      const disabled = { ...config, GEMINI_API_KEY: '' };
      const s = createAiService(db, disabled);
      expect((await s.capabilities(owner.id)).available).toBe(false);
      await expect(s.create(owner.id, input())).rejects.toMatchObject({
        code: 'AI_UNAVAILABLE',
      });
      expect(
        (
          await createAiService(db, {
            ...config,
            GEMINI_MODEL: '',
          }).capabilities(owner.id)
        ).available,
      ).toBe(false);
      expect((await get('/question-banks')).status).toBe(200);
    });
    it('makes repeated and concurrent submissions idempotent', async () => {
      const body = input();
      const results = await Promise.all([
        service.create(owner.id, body),
        service.create(owner.id, body),
      ]);
      expect(results[0]!.id).toBe(results[1]!.id);
      expect(await db.aiGeneration.count()).toBe(1);
      await expect(
        service.create(owner.id, { ...body, topic: 'Changed topic' }),
      ).rejects.toMatchObject({ code: 'REQUEST_CHANGED' });
      await expect(service.create(owner.id, input())).rejects.toMatchObject({
        code: 'GENERATION_ACTIVE',
      });
    });
    it('serializes distinct concurrent requests to one active reservation', async () => {
      const results = await Promise.allSettled([
        service.create(owner.id, input()),
        service.create(owner.id, input()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await service.capabilities(owner.id)).reserved).toBe(1);
    });
    it('validates successful topic output, charges once and immediately purges source input', async () => {
      const job = await readyJob();
      expect(job.status).toBe('READY');
      expect((job.result as { questions: unknown[] }).questions).toHaveLength(
        5,
      );
      const stored = await db.aiGeneration.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(stored.input).toBeNull();
      expect(stored.charged).toBe(true);
      expect(stored.providerAttempts).toBe(1);
      expect((await service.capabilities(owner.id)).remaining).toBe(4);
    });
    it('generates document questions only from the reviewed text with checked source references', async () => {
      const reviewed =
        'Reviewed public educational material: ' + educationalText;
      const job = await service.create(owner.id, {
        ...input(),
        kind: 'DOCUMENT',
        textReviewed: true,
        topic: '',
        segments: [{ label: 'Page 1', text: reviewed }],
      });
      const spy = vi.fn(provider.generate);
      await createAiWorker(db, config, { generate: spy }).tick();
      expect(spy.mock.calls[0]![0].segments[0]!.text).toBe(reviewed);
      expect((await service.get(owner.id, job.id)).status).toBe('READY');
      expect(
        (await db.aiGeneration.findUniqueOrThrow({ where: { id: job.id } }))
          .input,
      ).toBeNull();
    });
    it('rejects unreviewed document submissions before reserving quota', async () => {
      await expect(
        service.create(owner.id, {
          ...input(),
          kind: 'DOCUMENT',
          topic: '',
          segments: [{ label: 'Paragraph 1', text: educationalText }],
          textReviewed: false,
        }),
      ).rejects.toThrow();
      expect(await db.aiGeneration.count()).toBe(0);
      expect((await service.capabilities(owner.id)).remaining).toBe(5);
    });
    it('rejects malformed responses and returns reservations without refunding actual provider calls', async () => {
      const job = await service.create(owner.id, input());
      await createAiWorker(db, config, {
        generate: async () => '{broken',
      }).tick();
      const result = await service.get(owner.id, job.id);
      expect(result.status).toBe('FAILED');
      expect(result.failure?.code).toBe('INVALID_AI_OUTPUT');
      expect((await service.capabilities(owner.id)).remaining).toBe(5);
      expect((await db.aiUsageBucket.findFirstOrThrow()).providerCalls).toBe(2);
    });
    it('bounds transient retries and exposes only sanitized errors', async () => {
      const job = await service.create(owner.id, input());
      const generate = vi
        .fn()
        .mockRejectedValue(new ProviderFailure('PROVIDER_TEMPORARY', true, 1));
      await createAiWorker(db, config, { generate }).tick();
      expect(generate).toHaveBeenCalledTimes(2);
      expect((await db.aiUsageBucket.findFirstOrThrow()).providerCalls).toBe(2);
      expect((await service.get(owner.id, job.id)).failure?.code).toBe(
        'PROVIDER_TEMPORARY',
      );
      expect((await service.capabilities(owner.id)).remaining).toBe(5);
    });
    it('does not retry ambiguous connection failures or unavailable models', async () => {
      const job = await service.create(owner.id, input());
      const generate = vi
        .fn()
        .mockRejectedValue(new ProviderFailure('MODEL_UNAVAILABLE'));
      await createAiWorker(db, config, { generate }).tick();
      expect(generate).toHaveBeenCalledTimes(1);
      expect((await service.get(owner.id, job.id)).failure?.message).toContain(
        'configured model',
      );
    });
    it('enforces daily user allowance under concurrent allocation at the final slot', async () => {
      const now = new Date();
      const quotaDay = now.toISOString().slice(0, 10);
      await db.aiGeneration.createMany({
        data: Array.from({ length: 4 }, () => ({
          userId: owner.id,
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          status: 'EXPIRED' as const,
          model: 'mock',
          charged: true,
          quotaDay,
          deadlineAt: now,
        })),
      });
      const results = await Promise.allSettled([
        service.create(owner.id, input()),
        service.create(owner.id, input()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await service.capabilities(owner.id)).remaining).toBe(0);
    });
    it('enforces project capacity across users without quota races', async () => {
      const limited = createAiService(db, {
        ...config,
        AI_DAILY_PROJECT_CALL_LIMIT: 1,
      });
      const results = await Promise.allSettled([
        limited.create(owner.id, input()),
        limited.create(stranger.id, input()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.aiGeneration.count()).toBe(1);
    });
    it('prevents multiple workers from processing the same request or exceeding global concurrency', async () => {
      await service.create(owner.id, input());
      await service.create(stranger.id, input());
      const generate = vi.fn(
        async (...args: Parameters<QuestionProvider['generate']>) => {
          await new Promise((r) => setTimeout(r, 100));
          return provider.generate(...args);
        },
      );
      await Promise.all([
        createAiWorker(db, config, { generate }).tick(),
        createAiWorker(db, config, { generate }).tick(),
      ]);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(await db.aiGeneration.count({ where: { status: 'READY' } })).toBe(
        1,
      );
    });
    it('expires abandoned jobs on request and never resends an expired running request', async () => {
      const job = await service.create(owner.id, input());
      await db.aiGeneration.update({
        where: { id: job.id },
        data: { status: 'RUNNING', deadlineAt: new Date(Date.now() - 1000) },
      });
      const generate = vi.fn(provider.generate);
      await createAiWorker(db, config, { generate }).tick();
      expect(generate).not.toHaveBeenCalled();
      expect((await service.get(owner.id, job.id)).status).toBe('FAILED');
      expect((await service.capabilities(owner.id)).remaining).toBe(5);
    });
    it('keeps jobs and generated answers private from other accounts', async () => {
      const job = await readyJob();
      expect((await get(`/ai/generations/${job.id}`, stranger)).status).toBe(
        404,
      );
      expect(
        (await mutate(`/ai/generations/${job.id}/discard`, {}, stranger))
          .status,
      ).toBe(404);
      expect(
        (
          await mutate(
            `/ai/generations/${job.id}/review`,
            {
              questions: mockQuestions(input()).questions.map(
                ({ source: _source, ...q }) => q,
              ),
            },
            stranger,
          )
        ).status,
      ).toBe(404);
    });
    it('accepts edited questions once into an existing bank under concurrent retries', async () => {
      const job = await readyJob();
      const bank = await createBankService(db, config.JWT_SECRET).create(
        owner.id,
        { title: 'AI review', description: '', courseId: null },
      );
      const questions = mockQuestions(input()).questions.map(
        ({ source: _source, ...q }) => ({ ...q, prompt: q.prompt + ' edited' }),
      );
      const body = { questions, bankId: bank.id };
      const results = await Promise.all([
        service.accept(owner.id, job.id, body),
        service.accept(owner.id, job.id, body),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(await db.question.count({ where: { bankId: bank.id } })).toBe(5);
      await expect(
        service.accept(owner.id, job.id, {
          ...body,
          questions: questions.slice(1),
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_ACCEPTED' });
      const copy = await createBankService(db, config.JWT_SECRET).select(
        owner.id,
        (await db.question.findMany({ where: { bankId: bank.id } })).map(
          (q) => q.id,
        ),
      );
      const quiz = await createQuizService(db).create(owner.id, {
        title: 'Reviewed AI practice',
        description: '',
        timeLimitSeconds: null,
        questions: copy.questions as typeof questions,
      });
      expect(quiz.questions).toHaveLength(5);
    });
    it('creates a new bank atomically and validates edited questions and ownership before acceptance', async () => {
      const job = await readyJob();
      const questions = mockQuestions(input()).questions.map(
        ({ source: _source, ...q }) => q,
      );
      const foreign = await createBankService(db, config.JWT_SECRET).create(
        stranger.id,
        { title: 'Private', description: '', courseId: null },
      );
      await expect(
        service.accept(owner.id, job.id, { bankId: foreign.id, questions }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.accept(owner.id, job.id, {
          newBank: { title: 'Invalid', description: '', courseId: null },
          questions: [{ ...questions[0]!, options: ['a', 'a', 'b', 'c'] }],
        }),
      ).rejects.toThrow();
      const saved = await service.accept(owner.id, job.id, {
        newBank: {
          title: 'Accepted AI questions',
          description: '',
          courseId: null,
        },
        questions,
      });
      expect(await db.question.count({ where: { bankId: saved.bankId } })).toBe(
        5,
      );
    });
    it('deletes source/results without erasing quota history and purges review payloads after 24 hours', async () => {
      const job = await readyJob();
      await db.aiGeneration.update({
        where: { id: job.id },
        data: { resultExpiresAt: new Date(Date.now() - 1000) },
      });
      const stored = await db.aiGeneration.findUniqueOrThrow({
        where: { id: job.id },
      });
      const replay = await service.create(owner.id, {
        ...input(),
        idempotencyKey: stored.idempotencyKey,
      });
      expect(replay.status).toBe('EXPIRED');
      expect(replay.result).toBeNull();
      expect((await service.get(owner.id, job.id)).status).toBe('EXPIRED');
      expect(
        (await db.aiGeneration.findUniqueOrThrow({ where: { id: job.id } }))
          .result,
      ).toBeNull();
      expect((await service.capabilities(owner.id)).used).toBe(1);
      await service.discard(owner.id, job.id);
      expect((await service.get(owner.id, job.id)).status).toBe('DELETED');
      expect((await service.capabilities(owner.id)).used).toBe(1);
      await db.aiGeneration.update({
        where: { id: job.id },
        data: { createdAt: new Date(Date.now() - 31 * 86400000) },
      });
      await service.cleanup();
      expect(await db.aiGeneration.count()).toBe(0);
    });
    it('authenticates uploads and preserves multipart CSRF boundaries', async () => {
      expect(
        (
          await request(app)
            .post('/api/v1/ai/documents/extract')
            .set('Origin', config.APP_ORIGIN)
            .set('X-CSRF-Protection', '1')
            .attach('document', Buffer.from(educationalText), 'notes.txt')
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .post('/api/v1/ai/documents/extract')
            .set('Cookie', owner.cookies)
            .attach('document', Buffer.from(educationalText), 'notes.txt')
        ).status,
      ).toBe(403);
      const response = await request(app)
        .post('/api/v1/ai/documents/extract')
        .set('Cookie', owner.cookies)
        .set('Origin', config.APP_ORIGIN)
        .set('X-CSRF-Protection', '1')
        .field('nonSensitiveConfirmed', 'true')
        .attach('document', Buffer.from(educationalText), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        });
      expect(response.status).toBe(200);
      expect(response.body.segments[0].text).toBe(educationalText);
      expect(await db.aiGeneration.count()).toBe(0);
    }, 20000);
    it('rejects oversized, unsupported and unconfirmed document uploads', async () => {
      const small = { ...config, AI_DOCUMENT_MAX_BYTES: 1024 };
      const isolated = createApp(db, small);
      await isolated.ready;
      const upload = (name: string, bytes: Buffer, confirmed = true) =>
        request(isolated.app)
          .post('/api/v1/ai/documents/extract')
          .set('Cookie', owner.cookies)
          .set('Origin', small.APP_ORIGIN)
          .set('X-CSRF-Protection', '1')
          .field('nonSensitiveConfirmed', String(confirmed))
          .attach('document', bytes, {
            filename: name,
            contentType: 'text/plain',
          });
      expect((await upload('notes.txt', Buffer.alloc(1025, 65))).status).toBe(
        400,
      );
      expect(
        (await upload('notes.exe', Buffer.from(educationalText))).status,
      ).toBe(400);
      expect(
        (await upload('notes.txt', Buffer.from(educationalText), false)).status,
      ).toBe(400);
      expect(await db.aiGeneration.count()).toBe(0);
    });
    it('enforces the runtime deadline even if a provider ignores abort', async () => {
      const job = await service.create(owner.id, input());
      await db.aiGeneration.update({
        where: { id: job.id },
        data: { deadlineAt: new Date(Date.now() + 200) },
      });
      await createAiWorker(db, config, {
        generate: () => new Promise(() => {}),
      }).tick();
      expect((await service.get(owner.id, job.id)).status).toBe('FAILED');
      expect(
        (await db.aiGeneration.findUniqueOrThrow({ where: { id: job.id } }))
          .input,
      ).toBeNull();
    });
    it('retains no source payload in terminal database rows', async () => {
      await expect(
        db.aiGeneration.create({
          data: {
            userId: owner.id,
            idempotencyKey: randomUUID(),
            requestHash: 'b'.repeat(64),
            status: 'FAILED',
            model: 'mock',
            input: { private: 'must not remain' },
            quotaDay: new Date().toISOString().slice(0, 10),
            deadlineAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      expect(Prisma.DbNull).toBeDefined();
    });
  },
);

describe('AI recovery reliability', () => {
  it('recovers one invalid response, records tokens per call and charges success exactly once', async () => {
    const job = await service.create(owner.id, input());
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        text: '{private-content',
        metadata: {
          finishReason: 'STOP',
          inputTokens: 11,
          outputTokens: 5,
          totalTokens: 16,
        },
      })
      .mockImplementationOnce(async (request) => ({
        text: JSON.stringify(mockQuestions(request)),
        metadata: {
          finishReason: 'STOP',
          inputTokens: 12,
          outputTokens: 150,
          totalTokens: 162,
        },
      }));
    await createAiWorker(db, config, { generate }).tick();
    const result = await service.get(owner.id, job.id);
    expect(result.status).toBe('READY');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![3]).toEqual({
      category: 'MALFORMED_JSON',
      fields: [],
    });
    expect(result.diagnostics).toEqual([
      {
        attempt: 1,
        category: 'MALFORMED_JSON',
        fields: [],
        finishReason: 'STOP',
        inputTokens: 11,
        outputTokens: 5,
        totalTokens: 16,
        requestedCount: 5,
        sourceCount: 0,
        sourceCharacters: 0,
      },
      {
        attempt: 2,
        category: 'VALID',
        finishReason: 'STOP',
        inputTokens: 12,
        outputTokens: 150,
        totalTokens: 162,
        requestedCount: 5,
        returnedCount: 5,
        sourceCount: 0,
        sourceCharacters: 0,
      },
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-content');
    expect((await service.capabilities(owner.id)).remaining).toBe(4);
    expect((await db.aiUsageBucket.findFirstOrThrow()).providerCalls).toBe(2);
    expect(
      (await db.aiGeneration.findUniqueOrThrow({ where: { id: job.id } }))
        .input,
    ).toBeNull();
  });
  it.each([
    'PROVIDER_QUOTA',
    'PROVIDER_CONFIGURATION',
    'MODEL_UNAVAILABLE',
    'OUTPUT_BLOCKED',
    'PROVIDER_CONNECTION',
  ])(
    'never retries permanent or ambiguous %s even if flagged retryable',
    async (code) => {
      const job = await service.create(owner.id, input());
      const generate = vi
        .fn()
        .mockRejectedValue(new ProviderFailure(code, true, 1));
      await createAiWorker(db, config, { generate }).tick();
      expect(generate).toHaveBeenCalledTimes(1);
      expect((await service.get(owner.id, job.id)).failure?.code).toBe(code);
      expect((await service.capabilities(owner.id)).remaining).toBe(5);
    },
  );
  it('shares two calls across transient failure and validation recovery', async () => {
    const job = await service.create(owner.id, input());
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ProviderFailure('PROVIDER_TEMPORARY', true, 1))
      .mockResolvedValue('{broken');
    await createAiWorker(db, config, { generate }).tick();
    expect(generate).toHaveBeenCalledTimes(2);
    expect((await service.get(owner.id, job.id)).status).toBe('FAILED');
    expect((await db.aiUsageBucket.findFirstOrThrow()).providerCalls).toBe(2);
  });
  it('does not spend a recovery call when the project budget is exhausted', async () => {
    const limited = { ...config, AI_DAILY_PROJECT_CALL_LIMIT: 1 };
    const job = await createAiService(db, limited).create(owner.id, input());
    const generate = vi.fn().mockResolvedValue('{broken');
    await createAiWorker(db, limited, { generate }).tick();
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await service.get(owner.id, job.id)).failure?.code).toBe(
      'PROJECT_LIMIT',
    );
    expect((await service.capabilities(owner.id)).remaining).toBe(5);
  });
  it('restores owner settings for 24 hours without retaining document text and clears summaries on deletion/expiry', async () => {
    const request = {
      ...input(),
      kind: 'DOCUMENT' as const,
      topic: '',
      textReviewed: true,
      segments: [{ label: 'Private label', text: educationalText }],
    };
    const job = await service.create(owner.id, request);
    await createAiWorker(db, config, provider).tick();
    const restored = await service.get(owner.id, job.id);
    expect(restored.summary).toEqual({
      kind: 'DOCUMENT',
      topic: '',
      difficulty: 'MEDIUM',
      count: 5,
    });
    expect(JSON.stringify(restored.summary)).not.toContain(educationalText);
    expect((await service.capabilities(owner.id)).recentJobId).toBe(job.id);
    expect((await get('/ai/generations/' + job.id, stranger)).status).toBe(404);
    await db.aiGeneration.update({
      where: { id: job.id },
      data: { summaryExpiresAt: new Date(Date.now() - 1000) },
    });
    await service.cleanup();
    expect(
      (await db.aiGeneration.findUniqueOrThrow({ where: { id: job.id } }))
        .summary,
    ).toBeNull();
    await service.discard(owner.id, job.id);
    const deleted = await db.aiGeneration.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(deleted.summary).toBeNull();
    expect(deleted.diagnostics).toBeNull();
    expect(deleted.charged).toBe(true);
  });
});

describe('document reference recovery and persistence', () => {
  const document = () =>
    generationInputSchema.parse({
      ...input(),
      kind: 'DOCUMENT',
      topic: '',
      textReviewed: true,
      segments: [
        {
          label: 'Page 3',
          text: 'The cell\r\nmembrane regulates transport. ' + educationalText,
        },
        {
          label: 'Page 7',
          text: 'Photosynthesis converts light energy into chemical energy in chloroplasts.',
        },
      ],
    });
  it('uses stable document IDs during recovery, resolves public references and charges success once', async () => {
    const request = document();
    const job = await service.create(owner.id, request);
    const generate = vi
      .fn()
      .mockImplementation(async (input, _model, _signal, recovery) => {
        const response = mockQuestions(input);
        response.questions[0]!.source = {
          id: recovery ? 1 : 999,
          quote: 'The cell membrane regulates transport.',
        };
        return {
          text: JSON.stringify(response),
          metadata: {
            finishReason: 'STOP',
            inputTokens: 101,
            outputTokens: 202,
            totalTokens: 303,
          },
        };
      });
    await createAiWorker(db, config, { generate }).tick();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]![0]).toEqual(request);
    expect(generate.mock.calls[1]![0]).toEqual(request);
    expect(generate.mock.calls[1]![3]).toEqual({
      category: 'SOURCE_ID_UNKNOWN',
      fields: ['questions.0.source.id'],
    });
    const result = await service.get(owner.id, job.id);
    expect(result.status).toBe('READY');
    expect(result.result).toMatchObject({
      questions: [
        expect.objectContaining({
          source: {
            label: 'Page 3',
            quote: 'The cell membrane regulates transport.',
          },
        }),
        ...Array.from({ length: 4 }, () => expect.any(Object)),
      ],
    });
    expect(result.diagnostics).toMatchObject([
      {
        attempt: 1,
        category: 'SOURCE_ID_UNKNOWN',
        fields: ['questions.0.source.id'],
        requestedCount: 5,
        returnedCount: 5,
        sourceCount: 2,
      },
      {
        attempt: 2,
        category: 'VALID',
        inputTokens: 101,
        outputTokens: 202,
        totalTokens: 303,
      },
    ]);
    expect((await db.aiUsageBucket.findFirstOrThrow()).providerCalls).toBe(2);
    expect((await service.capabilities(owner.id)).remaining).toBe(4);
    expect(
      (await db.aiGeneration.findUniqueOrThrow({ where: { id: job.id } }))
        .input,
    ).toBeNull();
  });
  it.each(['SOURCE_MISSING', 'SOURCE_ID_UNKNOWN', 'SOURCE_EXCERPT_MISMATCH'])(
    'bounds repeated %s failures and preserves provider/user accounting',
    async (code) => {
      const job = await service.create(owner.id, document());
      const generate = vi.fn().mockImplementation(async (request) => {
        const response = mockQuestions(request);
        Object.assign(response.questions[0]!, {
          source:
            code === 'SOURCE_MISSING'
              ? null
              : code === 'SOURCE_ID_UNKNOWN'
                ? { id: 999, quote: 'private-marker' }
                : { id: 2, quote: 'The cell membrane regulates transport.' },
        });
        return JSON.stringify(response);
      });
      await createAiWorker(db, config, { generate }).tick();
      const result = await service.get(owner.id, job.id);
      expect(result.status).toBe('FAILED');
      expect(generate).toHaveBeenCalledTimes(2);
      expect(result.diagnostics).toMatchObject([
        { category: code, requestedCount: 5, returnedCount: 5, sourceCount: 2 },
        { category: code, requestedCount: 5, returnedCount: 5, sourceCount: 2 },
      ]);
      expect(JSON.stringify(result.diagnostics)).not.toContain(
        'private-marker',
      );
      expect((await service.capabilities(owner.id)).remaining).toBe(5);
      expect((await db.aiUsageBucket.findFirstOrThrow()).providerCalls).toBe(2);
      expect(
        (await db.aiGeneration.findUniqueOrThrow({ where: { id: job.id } }))
          .input,
      ).toBeNull();
    },
  );
  it('does not allocate a third call after a transient failure then an excerpt mismatch', async () => {
    const job = await service.create(owner.id, document());
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ProviderFailure('PROVIDER_TEMPORARY', true, 1))
      .mockImplementation(async (request) => {
        const response = mockQuestions(request);
        response.questions[0]!.source = {
          id: 2,
          quote: 'The cell membrane regulates transport.',
        };
        return JSON.stringify(response);
      });
    await createAiWorker(db, config, { generate }).tick();
    expect(generate).toHaveBeenCalledTimes(2);
    const result = await service.get(owner.id, job.id);
    expect(result.status).toBe('FAILED');
    expect(result.diagnostics).toMatchObject([
      { category: 'PROVIDER_TEMPORARY' },
      { category: 'SOURCE_EXCERPT_MISMATCH' },
    ]);
    expect((await service.capabilities(owner.id)).remaining).toBe(5);
  });
  it('preserves resolved source notes through review, idempotent bank acceptance and practice snapshots', async () => {
    const job = await service.create(owner.id, document());
    await createAiWorker(db, config, provider).tick();
    const result = await service.get(owner.id, job.id);
    const generated = result.result as {
      questions: {
        prompt: string;
        options: [string, string, string, string];
        correctOption: number;
        explanation: string;
        difficulty: 'MEDIUM';
        topic: string;
        source: { label: string; quote: string };
      }[];
    };
    const questions = generated.questions.map(({ source, ...q }) => ({
      ...q,
      explanation:
        q.explanation +
        '\n\nSource: ' +
        source.label +
        ' - "' +
        source.quote +
        '"',
    }));
    const reviewed = await service.review(owner.id, job.id, { questions });
    const body = {
      questions: reviewed.questions,
      newBank: {
        title: 'Document source notes',
        description: '',
        courseId: null,
      },
    };
    const [first, retry] = await Promise.all([
      service.accept(owner.id, job.id, body),
      service.accept(owner.id, job.id, body),
    ]);
    expect(first).toEqual(retry);
    const stored = await db.question.findMany({
      where: { bankId: first.bankId },
      orderBy: { createdAt: 'asc' },
    });
    expect(stored).toHaveLength(5);
    expect(stored.map((q) => q.explanation).sort()).toEqual(
      questions.map((q) => q.explanation).sort(),
    );
    const copy = await createBankService(db, config.JWT_SECRET).select(
      owner.id,
      stored.map((q) => q.id),
    );
    const quiz = await createQuizService(db).create(owner.id, {
      title: 'Document-grounded practice',
      description: '',
      timeLimitSeconds: null,
      questions: copy.questions as typeof questions,
    });
    expect(quiz.questions.map((q) => q.explanation).sort()).toEqual(
      questions.map((q) => q.explanation).sort(),
    );
    await service.discard(owner.id, job.id);
    expect(await db.question.count({ where: { bankId: first.bankId } })).toBe(
      5,
    );
    expect((await service.capabilities(owner.id)).remaining).toBe(4);
  });
});
