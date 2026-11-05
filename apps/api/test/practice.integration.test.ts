import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database.js';
import { createApp } from '../src/app.js';
import { createQuizService } from '../src/modules/quizzes/service.js';
import { createAttemptEngine } from '../src/modules/attempts/engine.js';

const config = loadConfig();
if (
  !/^auth_test_[a-f0-9]{16}$/.test(process.env.TEST_SCHEMA ?? '') ||
  new URL(config.DATABASE_URL).searchParams.get('schema') !==
    process.env.TEST_SCHEMA
)
  throw new Error(
    'Use npm run test:integration for an isolated PostgreSQL schema.',
  );
const db = createDatabase(config.DATABASE_URL);
const { app, ready } = createApp(db, config);
const quizzes = createQuizService(db);
const engine = createAttemptEngine(db);
const question = {
  prompt: 'Which number is prime?',
  options: ['2', '4', '6', '8'] as [string, string, string, string],
  correctOption: 0,
  explanation: 'Only 2 has exactly two positive factors.',
};
const input = {
  title: 'Number theory',
  description: 'A short practice set.',
  timeLimitSeconds: null,
  questions: [
    question,
    {
      ...question,
      prompt: 'Select another prime.',
      options: ['9', '11', '12', '15'] as [string, string, string, string],
      correctOption: 1,
    },
  ],
};
let owner: { id: string; cookies: string[] };
let stranger: { id: string; cookies: string[] };
let lecturer: { id: string; cookies: string[] };

function mutate(
  method: 'post' | 'put',
  path: string,
  body: object,
  cookies = owner.cookies,
) {
  const response = request(app)[method]('/api/v1' + path);
  return response
    .set('Origin', config.APP_ORIGIN)
    .set('X-CSRF-Protection', '1')
    .set('Cookie', cookies)
    .send(body);
}
const get = (path: string, cookies = owner.cookies) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', cookies);
async function published(timeLimitSeconds: number | null = null) {
  const quiz = await quizzes.create(owner.id, { ...input, timeLimitSeconds });
  await quizzes.publish(owner.id, quiz.id, quiz.revision);
  return quiz;
}
function assertPrivate(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    expect([
      'isCorrect',
      'correctOption',
      'correctOptionId',
      'explanation',
      'passwordHash',
    ]).not.toContain(key);
    assertPrivate(item);
  }
}
async function expire(id: string) {
  await db.attempt.update({
    where: { id },
    data: {
      startedAt: new Date(Date.now() - 61_000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
}

beforeAll(async () => {
  await db.$connect();
  await ready;
  async function register(role: 'STUDENT' | 'LECTURER') {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-CSRF-Protection', '1')
      .send({
        email: `${randomUUID()}@example.edu`,
        displayName: 'Practice Tester',
        role,
        ageConfirmed: true,
        password: 'safe-test-passphrase',
      });
    expect(response.status).toBe(201);
    return {
      id: response.body.user.id as string,
      cookies: (response.headers['set-cookie'] as unknown as string[]).map(
        (value) => value.split(';')[0]!,
      ),
    };
  }
  owner = await register('STUDENT');
  stranger = await register('STUDENT');
  lecturer = await register('LECTURER');
});
afterAll(async () => {
  await db.$disconnect();
});

describe.sequential('personal practice and shared engine on PostgreSQL', () => {
  it('creates private drafts and validates all question fields and mode assignment', async () => {
    const response = await mutate('post', '/quizzes', input);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'DRAFT',
      mode: 'PRACTICE',
      questionCount: 2,
    });
    for (const patch of [
      { title: ' ' },
      { mode: 'ASSESSMENT' },
      { timeLimitSeconds: 0 },
      { questions: [{ ...question, options: ['2', '2', '3', '4'] }] },
      { questions: [{ ...question, correctOption: 4 }] },
      { questions: [{ ...question, options: ['1', '2', '3'] }] },
      { questions: Array.from({ length: 51 }, () => question) },
    ])
      expect(
        (await mutate('post', '/quizzes', { ...input, ...patch })).status,
      ).toBe(400);
  });

  it('adds, edits and deletes questions atomically with draft revision checks', async () => {
    const created = await quizzes.create(owner.id, { ...input, questions: [] });
    expect(
      (await mutate('post', `/quizzes/${created.id}/publish`, { revision: 0 }))
        .status,
    ).toBe(400);
    const updated = await mutate('put', `/quizzes/${created.id}`, {
      ...input,
      revision: 0,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.questionCount).toBe(2);
    expect(
      (
        await mutate('put', `/quizzes/${created.id}`, {
          ...input,
          questions: [],
          revision: 0,
        })
      ).status,
    ).toBe(409);
    const edited = await mutate('put', `/quizzes/${created.id}`, {
      ...input,
      revision: 1,
      questions: [{ ...question, prompt: 'Edited question' }],
    });
    expect(edited.body.questions).toHaveLength(1);
    expect(edited.body.questions[0].prompt).toBe('Edited question');
    expect((await get(`/quizzes/${created.id}/draft`)).body.revision).toBe(2);
  });

  it('requires student authentication and prevents access to another owner', async () => {
    const quiz = await quizzes.create(owner.id, input);
    expect((await request(app).get('/api/v1/quizzes')).status).toBe(401);
    expect(
      (await mutate('post', '/quizzes', input, lecturer.cookies)).status,
    ).toBe(403);
    expect(
      (await get(`/quizzes/${quiz.id}/draft`, stranger.cookies)).status,
    ).toBe(404);
    expect(
      (
        await mutate(
          'put',
          `/quizzes/${quiz.id}`,
          { ...input, revision: 0 },
          stranger.cookies,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate(
          'post',
          `/quizzes/${quiz.id}/publish`,
          { revision: 0 },
          stranger.cookies,
        )
      ).status,
    ).toBe(404);
    expect((await get('/quizzes', stranger.cookies)).body.quizzes).toHaveLength(
      0,
    );
    expect((await get('/quizzes/not-a-uuid')).status).toBe(400);
  });

  it('publishes once and locks question, option and settings changes in the API and database', async () => {
    const quiz = await published();
    expect(
      (await mutate('post', `/quizzes/${quiz.id}/publish`, { revision: 0 }))
        .status,
    ).toBe(200);
    expect(
      (await mutate('put', `/quizzes/${quiz.id}`, { ...input, revision: 1 }))
        .status,
    ).toBe(409);
    expect((await get(`/quizzes/${quiz.id}/draft`)).status).toBe(409);
    const row = await db.quizQuestion.findFirstOrThrow({
      where: { quizId: quiz.id },
      include: { options: true },
    });
    await expect(
      db.quiz.update({ where: { id: quiz.id }, data: { title: 'Changed' } }),
    ).rejects.toThrow();
    await expect(
      db.quizQuestion.update({
        where: { id: row.id },
        data: { prompt: 'Changed' },
      }),
    ).rejects.toThrow();
    await expect(
      db.quizQuestionOption.update({
        where: { id: row.options[0]!.id },
        data: { text: 'Changed' },
      }),
    ).rejects.toThrow();
    await expect(
      db.quizQuestion.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    assertPrivate((await get(`/quizzes/${quiz.id}`)).body);
  });

  it('serializes publishing against draft changes without publishing stale content', async () => {
    const quiz = await quizzes.create(owner.id, input);
    const results = await Promise.all([
      mutate('put', `/quizzes/${quiz.id}`, {
        ...input,
        title: 'Changed draft',
        revision: 0,
      }),
      mutate('post', `/quizzes/${quiz.id}/publish`, { revision: 0 }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
  });

  it('rejects drafts, other owners, and converting practice into a challenge', async () => {
    const draft = await quizzes.create(owner.id, input);
    expect(
      (await mutate('post', `/quizzes/${draft.id}/attempts`, {})).status,
    ).toBe(404);
    const quiz = await published();
    expect(
      (
        await mutate(
          'post',
          `/quizzes/${quiz.id}/attempts`,
          {},
          stranger.cookies,
        )
      ).status,
    ).toBe(404);
    const future = await quizzes.create(owner.id, input);
    await expect(
      db.quiz.update({ where: { id: future.id }, data: { mode: 'CHALLENGE' } }),
    ).rejects.toThrow();
  });

  it('starts and resumes exactly one active attempt under concurrent requests', async () => {
    const quiz = await published(60);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        mutate('post', `/quizzes/${quiz.id}/attempts`, {}),
      ),
    );
    expect(results.map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(new Set(results.map((response) => response.body.id)).size).toBe(1);
    const first = results[0]!.body;
    expect(Date.parse(first.expiresAt) - Date.parse(first.startedAt)).toBe(
      60_000,
    );
    expect((await get(`/attempts/${first.id}`)).body.startedAt).toBe(
      first.startedAt,
    );
    expect(await db.attempt.count({ where: { quizId: quiz.id } })).toBe(1);
    await expect(
      db.attempt.create({
        data: {
          quizId: quiz.id,
          userId: owner.id,
          attemptNumber: 2,
          totalQuestions: 2,
        },
      }),
    ).rejects.toThrow();
    assertPrivate(first);
  });

  it('autosaves, clears and restores answers; lost-response retries are idempotent', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    const q = attempt.questions[0]!;
    const path = `/attempts/${attempt.id}/answers/${q.id}`;
    const body = { selectedOptionId: q.options[0]!.id, revision: 0 };
    expect((await mutate('put', path, body)).body.revision).toBe(1);
    expect((await mutate('put', path, body)).body.revision).toBe(1);
    expect(
      (await get(`/attempts/${attempt.id}`)).body.answers[0].selectedOptionId,
    ).toBe(body.selectedOptionId);
    expect(
      (await mutate('put', path, { selectedOptionId: null, revision: 1 })).body
        .revision,
    ).toBe(2);
    expect((await mutate('put', path, { ...body, revision: 0 })).status).toBe(
      409,
    );
  });

  it('rejects cross-question answers and unauthorized attempts/results', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    const q = attempt.questions[0]!;
    expect(
      (
        await mutate('put', `/attempts/${attempt.id}/answers/${q.id}`, {
          selectedOptionId: attempt.questions[1]!.options[0]!.id,
          revision: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate('put', `/attempts/${attempt.id}/answers/${randomUUID()}`, {
          selectedOptionId: null,
          revision: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (await get(`/attempts/${attempt.id}`, stranger.cookies)).status,
    ).toBe(404);
    expect(
      (await get(`/attempts/${attempt.id}/result`, stranger.cookies)).status,
    ).toBe(404);
    expect(
      (
        await mutate(
          'post',
          `/attempts/${attempt.id}/submit`,
          {},
          stranger.cookies,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate(
          'put',
          `/attempts/${attempt.id}/answers/${q.id}`,
          { selectedOptionId: q.options[0]!.id, revision: 0 },
          stranger.cookies,
        )
      ).status,
    ).toBe(404);
  });

  it('keeps answer keys private until finalization and grades correct, wrong, and blank selections', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    expect((await get(`/attempts/${attempt.id}/result`)).status).toBe(403);
    assertPrivate((await get(`/attempts/${attempt.id}`)).body);
    await engine.save(owner.id, attempt.id, attempt.questions[0]!.id, {
      selectedOptionId: attempt.questions[0]!.options[0]!.id,
      revision: 0,
    });
    await mutate('post', `/attempts/${attempt.id}/submit`, {});
    const result = await get(`/attempts/${attempt.id}/result`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      totalQuestions: 2,
      correctAnswers: 1,
      incorrectAnswers: 1,
      percentage: 50,
    });
    expect(result.body.questions[0].explanation).toBe(question.explanation);
    expect(result.body.questions[1].selectedOptionId).toBeNull();
    expect(result.body.questions[0].correctOptionId).toBe(
      attempt.questions[0]!.options[0]!.id,
    );
  });

  it('makes concurrent and repeated submissions safe and preserves final answers', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        mutate('post', `/attempts/${attempt.id}/submit`, {}),
      ),
    );
    expect(results.map((response) => response.status)).toEqual([200, 200, 200]);
    const before = (await get(`/attempts/${attempt.id}/result`)).body;
    expect(
      (
        await mutate(
          'put',
          `/attempts/${attempt.id}/answers/${attempt.questions[0]!.id}`,
          {
            selectedOptionId: attempt.questions[0]!.options[0]!.id,
            revision: 0,
          },
        )
      ).status,
    ).toBe(409);
    await mutate('post', `/attempts/${attempt.id}/submit`, {});
    expect((await get(`/attempts/${attempt.id}/result`)).body).toEqual(before);
    await expect(
      db.attempt.update({ where: { id: attempt.id }, data: { score: 2 } }),
    ).rejects.toThrow();
  });

  it('serializes competing answer updates using revisions', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    const q = attempt.questions[0]!;
    const results = await Promise.all(
      [0, 1].map((index) =>
        mutate('put', `/attempts/${attempt.id}/answers/${q.id}`, {
          selectedOptionId: q.options[index]!.id,
          revision: 0,
        }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      await db.attemptAnswer.count({ where: { attemptId: attempt.id } }),
    ).toBe(1);
  });

  it('grades the committed saved state when autosaving races submission', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    const q = attempt.questions[0]!;
    const [save, submit] = await Promise.all([
      mutate('put', `/attempts/${attempt.id}/answers/${q.id}`, {
        selectedOptionId: q.options[0]!.id,
        revision: 0,
      }),
      mutate('post', `/attempts/${attempt.id}/submit`, {}),
    ]);
    expect(submit.status).toBe(200);
    expect([200, 409]).toContain(save.status);
    expect((await engine.result(owner.id, attempt.id)).correctAnswers).toBe(
      save.status === 200 ? 1 : 0,
    );
  });

  it('enforces server expiry, rejects late saves, and commits expiry on rejected requests', async () => {
    const quiz = await published(60);
    const attempt = await engine.start(owner.id, quiz.id);
    const q = attempt.questions[0]!;
    await engine.save(owner.id, attempt.id, q.id, {
      selectedOptionId: q.options[0]!.id,
      revision: 0,
    });
    await expire(attempt.id);
    const response = await mutate(
      'put',
      `/attempts/${attempt.id}/answers/${q.id}`,
      { selectedOptionId: q.options[1]!.id, revision: 1 },
    );
    expect(response.status).toBe(409);
    expect(
      (await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } }))
        .status,
    ).toBe('EXPIRED');
    const result = await engine.result(owner.id, attempt.id);
    expect(result).toMatchObject({
      correctAnswers: 1,
      durationSeconds: 60,
      status: 'EXPIRED',
    });
    expect((await engine.get(owner.id, attempt.id)).status).toBe('EXPIRED');
  });

  it('returns a closed-attempt response when the deadline crosses during a database write', async () => {
    const quiz = await published(60);
    const attempt = await engine.start(owner.id, quiz.id);
    const schema = process.env.TEST_SCHEMA!; // Validated generated identifier above.
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".test_delay_answer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER "0_test_delay" BEFORE INSERT ON "${schema}"."AttemptAnswer" FOR EACH ROW EXECUTE FUNCTION "${schema}".test_delay_answer()`,
    );
    try {
      await db.attempt.update({
        where: { id: attempt.id },
        data: {
          startedAt: new Date(Date.now() - 59_000),
          expiresAt: new Date(Date.now() + 75),
        },
      });
      await expect(
        engine.save(owner.id, attempt.id, attempt.questions[0]!.id, {
          selectedOptionId: attempt.questions[0]!.options[0]!.id,
          revision: 0,
        }),
      ).rejects.toMatchObject({ status: 409, code: 'ATTEMPT_CLOSED' });
      expect(
        (await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } }))
          .status,
      ).toBe('EXPIRED');
      expect(
        await db.attemptAnswer.count({ where: { attemptId: attempt.id } }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER "0_test_delay" ON "${schema}"."AttemptAnswer"`,
      );
      await db.$executeRawUnsafe(
        `DROP FUNCTION "${schema}".test_delay_answer()`,
      );
    }
  });

  it('finalizes expired attempts through the sweep and history after interruption', async () => {
    const quiz = await published(60);
    const attempt = await engine.start(owner.id, quiz.id);
    await expire(attempt.id);
    await engine.expire();
    expect((await engine.result(owner.id, attempt.id)).status).toBe('EXPIRED');
    const second = await engine.start(owner.id, quiz.id);
    expect(second.id).not.toBe(attempt.id);
    await expire(second.id);
    const history = await get('/practice/history');
    expect(history.status).toBe(200);
    expect(
      history.body.attempts.some(
        (item: { id: string }) => item.id === second.id,
      ),
    ).toBe(true);
  });

  it('retakes create new attempts while preserving earlier results', async () => {
    const quiz = await published();
    const first = await engine.start(owner.id, quiz.id);
    await engine.submit(owner.id, first.id);
    const result = await engine.result(owner.id, first.id);
    const second = await engine.start(owner.id, quiz.id);
    expect(second.id).not.toBe(first.id);
    expect(second.attemptNumber).toBe(2);
    await engine.submit(owner.id, second.id);
    expect(await engine.result(owner.id, first.id)).toEqual(result);
    expect(
      (await get('/practice/history', stranger.cookies)).body.attempts,
    ).toHaveLength(0);
  });

  it('creates an editable incorrect-question draft with independent question identities', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    await engine.save(owner.id, attempt.id, attempt.questions[0]!.id, {
      selectedOptionId: attempt.questions[0]!.options[0]!.id,
      revision: 0,
    });
    expect(
      (await mutate('post', `/attempts/${attempt.id}/retry-incorrect`, {}))
        .status,
    ).toBe(403);
    await engine.submit(owner.id, attempt.id);
    const retry = await mutate(
      'post',
      `/attempts/${attempt.id}/retry-incorrect`,
      {},
    );
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ status: 'DRAFT', questionCount: 1 });
    const draft = await get(`/quizzes/${retry.body.id}/draft`);
    expect(draft.body.questions[0].prompt).toBe(input.questions[1]!.prompt);
    const copied = await db.quizQuestion.findFirstOrThrow({
      where: { quizId: retry.body.id },
    });
    expect(attempt.questions.map((q) => q.id)).not.toContain(copied.id);
    expect(
      (
        await mutate(
          'post',
          `/attempts/${attempt.id}/retry-incorrect`,
          {},
          stranger.cookies,
        )
      ).status,
    ).toBe(404);
  });

  it('refuses retry-incorrect when every answer is correct', async () => {
    const quiz = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    for (const [index, q] of attempt.questions.entries())
      await engine.save(owner.id, attempt.id, q.id, {
        selectedOptionId: q.options[index]!.id,
        revision: 0,
      });
    await engine.submit(owner.id, attempt.id);
    expect(
      (await mutate('post', `/attempts/${attempt.id}/retry-incorrect`, {}))
        .status,
    ).toBe(400);
  });

  it('enforces composite database references and finalized answer immutability', async () => {
    const quiz = await published();
    const other = await published();
    const attempt = await engine.start(owner.id, quiz.id);
    const wrong = await db.quizQuestion.findFirstOrThrow({
      where: { quizId: other.id },
      include: { options: true },
    });
    await expect(
      db.attemptAnswer.create({
        data: {
          attemptId: attempt.id,
          quizId: quiz.id,
          questionId: wrong.id,
          selectedOptionId: wrong.options[0]!.id,
        },
      }),
    ).rejects.toThrow();
    await engine.save(owner.id, attempt.id, attempt.questions[0]!.id, {
      selectedOptionId: attempt.questions[0]!.options[0]!.id,
      revision: 0,
    });
    await engine.submit(owner.id, attempt.id);
    await expect(
      db.attemptAnswer.update({
        where: {
          attemptId_questionId: {
            attemptId: attempt.id,
            questionId: attempt.questions[0]!.id,
          },
        },
        data: { selectedOptionId: null },
      }),
    ).rejects.toThrow();
  });
});
