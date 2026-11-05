import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database.js';
import { createApp } from '../src/app.js';
import { createChallengeService } from '../src/modules/challenges/service.js';
import { createAttemptEngine } from '../src/modules/attempts/engine.js';
import { createBankService } from '../src/modules/banks/service.js';
import { databaseNow } from '../src/modules/quizzes/data.js';
const config = { ...loadConfig(), CHALLENGE_INVITE_KEY: 'a'.repeat(64) };
if (
  !/^auth_test_[a-f0-9]{16}$/.test(process.env.TEST_SCHEMA ?? '') ||
  new URL(config.DATABASE_URL).searchParams.get('schema') !==
    process.env.TEST_SCHEMA
)
  throw Error('Use the isolated PostgreSQL runner');
const db = createDatabase(config.DATABASE_URL),
  { app, ready } = createApp(db, config),
  service = createChallengeService(db, config),
  engine = createAttemptEngine(db);
type Account = { id: string; cookies: string[] };
let owner: Account,
  alice: Account,
  bob: Account,
  outsider: Account,
  lecturer: Account;
const question = {
  prompt: 'Which number is prime?',
  options: ['2', '4', '6', '8'] as [string, string, string, string],
  correctOption: 0,
  explanation: 'Only 2 is prime. Source: Paragraph 1 - "Two is prime."',
};
const input = (extra = {}) => ({
  title: 'Friends numbers',
  description: 'One attempt each.',
  timeLimitSeconds: null,
  closesAt: null,
  questions: [question],
  ...extra,
});
const get = (path: string, user = owner) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', user.cookies);
const post = (path: string, body: object = {}, user = owner) =>
  request(app)
    .post('/api/v1' + path)
    .set('Cookie', user.cookies)
    .set('Origin', config.APP_ORIGIN)
    .set('X-CSRF-Protection', '1')
    .send(body);
async function register(role = 'STUDENT') {
  const result = await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', config.APP_ORIGIN)
    .set('X-CSRF-Protection', '1')
    .send({
      email: randomUUID() + '@example.edu',
      password: 'secure-test-passphrase',
      displayName: 'Challenge student',
      role,
      ageConfirmed: true,
    });
  expect(result.status).toBe(201);
  return {
    id: result.body.user.id as string,
    cookies: (result.headers['set-cookie'] as unknown as string[]).map(
      (value) => value.split(';')[0]!,
    ),
  };
}
async function published(extra = {}) {
  const quiz = await service.author.create(owner.id, input(extra));
  await service.publish(owner.id, quiz.id, quiz.revision);
  const invitation = await service.invitation(owner.id, quiz.id);
  return { ...quiz, invitation };
}
async function joined(extra = {}) {
  const quiz = await published(extra);
  await Promise.all([
    service.join(alice.id, quiz.invitation.code),
    service.join(bob.id, quiz.invitation.code),
  ]);
  return quiz;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
beforeAll(async () => {
  await ready;
  owner = await register();
  alice = await register();
  bob = await register();
  outsider = await register();
  lecturer = await register('LECTURER');
});
afterAll(async () => {
  await db.$disconnect();
});
describe('challenge security, engine and PostgreSQL concurrency', () => {
  it('requires active students and CSRF and validates strict draft input', async () => {
    expect((await request(app).get('/api/v1/challenges')).status).toBe(401);
    expect((await post('/challenges', input(), lecturer)).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/challenges')
          .set('Cookie', owner.cookies)
          .send(input())
      ).status,
    ).toBe(403);
    expect(
      (await post('/challenges', input({ mode: 'ASSESSMENT' }))).status,
    ).toBe(400);
    expect(
      (
        await post(
          '/challenges',
          input({
            questions: [{ ...question, options: ['a', 'a', 'b', 'c'] }],
          }),
        )
      ).status,
    ).toBe(400);
  });
  it('saves scheduled drafts with revisions, freezes publication and keeps invitation material private', async () => {
    const draft = await service.author.create(owner.id, input());
    const saved = await service.author.update(owner.id, draft.id, {
      ...input({ closesAt: new Date(Date.now() + 60000).toISOString() }),
      revision: draft.revision,
    });
    await expect(
      service.author.update(owner.id, draft.id, { ...input(), revision: 0 }),
    ).rejects.toMatchObject({ code: 'DRAFT_CHANGED' });
    await Promise.all([
      service.publish(owner.id, draft.id, saved.revision),
      service.publish(owner.id, draft.id, saved.revision),
    ]);
    const invitation = await service.invitation(owner.id, draft.id),
      stored = await db.challenge.findUniqueOrThrow({
        where: { quizId: draft.id },
      });
    expect(stored.inviteCodeSealed).not.toContain(invitation.code);
    expect(stored.inviteCodeHash).not.toBe(invitation.code);
    expect((await service.invitation(owner.id, draft.id)).code).toBe(
      invitation.code,
    );
    expect(invitation.link).toContain('/challenges/join#code=');
    expect(
      JSON.stringify(await service.list(owner.id, 'created', 1)),
    ).not.toContain(invitation.code);
    expect(
      JSON.stringify(await service.details(owner.id, draft.id, true)),
    ).not.toContain('inviteCode');
    await expect(
      service.author.update(owner.id, draft.id, {
        ...input(),
        revision: saved.revision,
      }),
    ).rejects.toMatchObject({ code: 'QUIZ_PUBLISHED' });
    await expect(
      db.challenge.update({
        where: { quizId: draft.id },
        data: { closesAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.quizQuestion.updateMany({
        where: { quizId: draft.id },
        data: { prompt: 'Changed' },
      }),
    ).rejects.toThrow();
  });
  it('leaves drafts functional without a key and rejects expired schedules and missing publication questions', async () => {
    const unavailable = createChallengeService(db, {
      ...config,
      CHALLENGE_INVITE_KEY: '',
    });
    const draft = await unavailable.author.create(owner.id, input());
    await expect(
      unavailable.publish(owner.id, draft.id, 0),
    ).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' });
    const expired = await service.author.create(
      owner.id,
      input({ closesAt: new Date(Date.now() - 1000).toISOString() }),
    );
    await expect(
      service.publish(owner.id, expired.id, 0),
    ).rejects.toMatchObject({ code: 'INVALID_SCHEDULE' });
    const empty = await service.author.create(
      owner.id,
      input({ questions: [] }),
    );
    await expect(service.publish(owner.id, empty.id, 0)).rejects.toMatchObject({
      code: 'EMPTY_QUIZ',
    });
  });
  it('enforces ownership on management, drafts, invitation retrieval, publication and closure', async () => {
    const quiz = await published();
    for (const suffix of [
      '',
      '/manage',
      '/draft',
      '/invitation',
      '/leaderboard',
    ])
      expect(
        (await get('/challenges/' + quiz.id + suffix, outsider)).status,
      ).toBe(404);
    expect(
      (await post('/challenges/' + quiz.id + '/close', {}, outsider)).status,
    ).toBe(404);
    expect(
      (
        await post(
          '/challenges/' + quiz.id + '/publish',
          { revision: 0 },
          outsider,
        )
      ).status,
    ).toBe(404);
    expect(
      (await post('/quizzes/' + quiz.id + '/attempts', {}, outsider)).status,
    ).toBe(404);
    await expect(
      service.join(outsider.id, '0'.repeat(24)),
    ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
  });
  it('serializes duplicate joins without starting the timer and excludes creators', async () => {
    const quiz = await published();
    const results = await Promise.all([
      service.join(alice.id, quiz.invitation.code),
      service.join(alice.id, quiz.invitation.code),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      await db.challengeParticipant.count({ where: { quizId: quiz.id } }),
    ).toBe(1);
    expect(await db.attempt.count({ where: { quizId: quiz.id } })).toBe(0);
    await expect(
      service.join(owner.id, quiz.invitation.code),
    ).rejects.toMatchObject({ code: 'CREATOR_EXCLUDED' });
    await expect(engine.start(owner.id, quiz.id)).rejects.toThrow();
    await expect(
      db.challengeParticipant.create({
        data: { quizId: quiz.id, studentId: owner.id },
      }),
    ).rejects.toThrow();
  });
  it('allocates one attempt under concurrent starts and resumes identical questions without keys', async () => {
    const quiz = await joined({ timeLimitSeconds: 60 });
    const starts = await Promise.all([
      engine.start(alice.id, quiz.id),
      engine.start(alice.id, quiz.id),
    ]);
    expect(starts[0].id).toBe(starts[1].id);
    expect(
      await db.attempt.count({ where: { quizId: quiz.id, userId: alice.id } }),
    ).toBe(1);
    const other = await engine.start(bob.id, quiz.id);
    expect(other.questions).toEqual(starts[0].questions);
    expect(JSON.stringify(starts[0])).not.toMatch(
      /isCorrect|correctOption|explanation/,
    );
    expect(
      Date.parse(starts[0].expiresAt!) - Date.parse(starts[0].startedAt),
    ).toBe(60000);
    const first = starts[0].questions[0]!,
      option = first.options[0]!;
    const saved = await engine.save(alice.id, starts[0].id, first.id, {
      selectedOptionId: option.id,
      revision: 0,
    });
    expect(
      await engine.save(alice.id, starts[0].id, first.id, {
        selectedOptionId: option.id,
        revision: 0,
      }),
    ).toEqual(saved);
    await expect(
      engine.save(alice.id, starts[0].id, first.id, {
        selectedOptionId: first.options[1]!.id,
        revision: 0,
      }),
    ).rejects.toMatchObject({ code: 'ANSWER_CHANGED' });
    expect(
      (await engine.get(alice.id, starts[0].id)).answers[0]!.selectedOptionId,
    ).toBe(option.id);
    await expect(engine.get(bob.id, starts[0].id)).rejects.toMatchObject({
      code: 'ATTEMPT_NOT_FOUND',
    });
  });
  it('grades once, makes submission idempotent, hides review and denies premature leaderboard access', async () => {
    const quiz = await joined();
    const attempt = await engine.start(alice.id, quiz.id),
      q = attempt.questions[0]!;
    await engine.save(alice.id, attempt.id, q.id, {
      selectedOptionId: q.options[0]!.id,
      revision: 0,
    });
    const submitted = await Promise.all([
      engine.submit(alice.id, attempt.id),
      engine.submit(alice.id, attempt.id),
    ]);
    expect(
      submitted.map((item) => ({
        id: item.id,
        status: item.status,
        answers: item.answers,
      })),
    ).toEqual([
      expect.objectContaining({ id: attempt.id, status: 'SUBMITTED' }),
      expect.objectContaining({ id: attempt.id, status: 'SUBMITTED' }),
    ]);
    const result = await engine.result(alice.id, attempt.id);
    expect(result.correctAnswers).toBe(1);
    expect(result.reviewAvailable).toBe(false);
    expect(result.questions).toEqual([]);
    expect((await engine.start(alice.id, quiz.id)).id).toBe(attempt.id);
    await expect(
      engine.save(alice.id, attempt.id, q.id, {
        selectedOptionId: null,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_CLOSED' });
    await expect(
      engine.retryIncorrect(alice.id, attempt.id),
    ).rejects.toMatchObject({ code: 'PRACTICE_ONLY' });
    expect(
      (await service.leaderboard(owner.id, quiz.id, 1)).entries,
    ).toHaveLength(1);
    expect(
      (await service.leaderboard(alice.id, quiz.id, 1)).entries,
    ).toHaveLength(1);
    await expect(service.leaderboard(bob.id, quiz.id, 1)).rejects.toMatchObject(
      { code: 'LEADERBOARD_LOCKED' },
    );
  });
  it('closes permanently, ends untimed attempts at the cutoff and unlocks review', async () => {
    const quiz = await joined();
    const attempt = await engine.start(alice.id, quiz.id),
      q = attempt.questions[0]!;
    await engine.save(alice.id, attempt.id, q.id, {
      selectedOptionId: q.options[0]!.id,
      revision: 0,
    });
    const closed = await service.close(owner.id, quiz.id);
    expect(await service.close(owner.id, quiz.id)).toEqual(closed);
    const result = await engine.result(alice.id, attempt.id);
    expect(result.status).toBe('EXPIRED');
    expect(result.finalizedAt).toBe(closed.closedAt);
    expect(result.correctAnswers).toBe(1);
    expect(result.reviewAvailable).toBe(true);
    expect(result.questions[0]!.explanation).toContain('Source: Paragraph 1');
    await expect(
      service.join(outsider.id, quiz.invitation.code),
    ).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    await expect(engine.start(bob.id, quiz.id)).rejects.toMatchObject({
      code: 'CHALLENGE_CLOSED',
    });
    expect((await service.leaderboard(bob.id, quiz.id, 1)).closed).toBe(true);
    await expect(
      db.challenge.update({
        where: { quizId: quiz.id },
        data: { closedAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.attemptAnswer.updateMany({
        where: { attemptId: attempt.id },
        data: { selectedOptionId: null },
      }),
    ).rejects.toThrow();
  });
  it('enforces scheduled closure on reads, starts, direct writes and late saves without a scheduler', async () => {
    const closing = new Date(Date.now() + 1500),
      quiz = await joined({ closesAt: closing.toISOString() });
    const attempt = await engine.start(alice.id, quiz.id),
      q = attempt.questions[0]!;
    expect(attempt.expiresAt).toBe(closing.toISOString());
    await engine.save(alice.id, attempt.id, q.id, {
      selectedOptionId: q.options[0]!.id,
      revision: 0,
    });
    await pause(Math.max(0, closing.getTime() - Date.now() + 25));
    await expect(
      db.attemptAnswer.updateMany({
        where: { attemptId: attempt.id },
        data: { selectedOptionId: null },
      }),
    ).rejects.toThrow();
    await expect(
      engine.save(alice.id, attempt.id, q.id, {
        selectedOptionId: null,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_CLOSED' });
    const result = await engine.result(alice.id, attempt.id);
    expect(result.finalizedAt).toBe(closing.toISOString());
    expect(result.reviewAvailable).toBe(true);
    expect(result.correctAnswers).toBe(1);
    await expect(engine.start(bob.id, quiz.id)).rejects.toMatchObject({
      code: 'CHALLENGE_CLOSED',
    });
    await expect(
      service.join(outsider.id, quiz.invitation.code),
    ).rejects.toThrow();
  });
  it('handles concurrent save, submission and closure without changing a finalized result', async () => {
    const quiz = await joined(),
      attempt = await engine.start(alice.id, quiz.id),
      q = attempt.questions[0]!;
    const outcomes = await Promise.allSettled([
      engine.save(alice.id, attempt.id, q.id, {
        selectedOptionId: q.options[0]!.id,
        revision: 0,
      }),
      engine.submit(alice.id, attempt.id),
      service.close(owner.id, quiz.id),
    ]);
    expect(outcomes[1]!.status).toBe('fulfilled');
    expect(outcomes[2]!.status).toBe('fulfilled');
    const result = await engine.result(alice.id, attempt.id),
      again = await engine.result(alice.id, attempt.id);
    expect(again).toEqual(result);
    expect(result.correctAnswers).toBe(
      outcomes[0]!.status === 'fulfilled' ? 1 : 0,
    );
    await expect(
      engine.save(alice.id, attempt.id, q.id, {
        selectedOptionId: null,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_CLOSED' });
  });
  it('enforces database one-attempt and membership rules without API checks', async () => {
    const quiz = await joined();
    await engine.start(alice.id, quiz.id);
    const now = await databaseNow(db);
    for (const [userId, attemptNumber] of [
      [alice.id, 1],
      [alice.id, 2],
      [outsider.id, 1],
      [owner.id, 1],
    ] as const)
      await expect(
        db.attempt.create({
          data: {
            quizId: quiz.id,
            userId,
            attemptNumber,
            totalQuestions: 1,
            startedAt: now,
          },
        }),
      ).rejects.toThrow();
    await expect(
      db.challengeParticipant.deleteMany({ where: { quizId: quiz.id } }),
    ).rejects.toThrow();
  });
  it('ranks score then milliseconds with competition ties across page boundaries and no private DTOs', async () => {
    const quiz = await published(),
      ids = Array.from({ length: 22 }, () => randomUUID());
    await db.user.createMany({
      data: ids.map((id, index) => ({
        id,
        email: id + '@example.edu',
        displayName: 'Rank student ' + index,
        passwordHash: 'unused-test-hash',
        role: 'STUDENT',
        status: 'ACTIVE',
      })),
    });
    for (const id of ids) await service.join(id, quiz.invitation.code);
    const start = new Date(Date.now() - 10000);
    await db.attempt.createMany({
      data: ids.map((userId, index) => ({
        quizId: quiz.id,
        userId,
        attemptNumber: 1,
        status: 'SUBMITTED',
        startedAt: start,
        finalizedAt: new Date(
          start.getTime() + (index < 2 ? 1001 : index === 2 ? 1002 : 2000),
        ),
        durationSeconds: index < 3 ? 1 : 2,
        score: index < 3 ? 1 : 0,
        totalQuestions: 1,
      })),
    });
    const page1 = await service.leaderboard(owner.id, quiz.id, 1),
      page2 = await service.leaderboard(owner.id, quiz.id, 2);
    expect(page1.entries.slice(0, 4).map((row) => row.rank)).toEqual([
      1, 1, 3, 4,
    ]);
    expect(page1.entries[2]!.durationMilliseconds).toBe(1002);
    expect(page2.entries.map((row) => row.rank)).toEqual([4, 4]);
    expect(JSON.stringify(page1)).not.toMatch(
      /studentId|userId|email|selectedOption|correctOption|explanation|inviteCode/,
    );
  });
  it('retains created, joined and finalized history and bank-derived explanations independently', async () => {
    const bank = await createBankService(db, config.JWT_SECRET).create(
      owner.id,
      { title: 'Private source bank', description: '', courseId: null },
    );
    const bankQuestion = await createBankService(db, config.JWT_SECRET).add(
      owner.id,
      bank.id,
      { ...question, difficulty: 'MEDIUM', topic: 'Numbers' },
    );
    const selected = await createBankService(db, config.JWT_SECRET).select(
      owner.id,
      [bankQuestion.id],
    );
    const draft = await service.author.create(
      owner.id,
      input({ questions: selected.questions }),
    );
    await service.publish(owner.id, draft.id, draft.revision);
    await service.join(
      alice.id,
      (await service.invitation(owner.id, draft.id)).code,
    );
    const attempt = await engine.start(alice.id, draft.id);
    await engine.submit(alice.id, attempt.id);
    expect(
      (await service.list(owner.id, 'created', 1)).quizzes.some(
        (q) => q.id === draft.id,
      ),
    ).toBe(true);
    expect(
      (await service.list(alice.id, 'joined', 1)).quizzes.some(
        (q) => q.id === draft.id,
      ),
    ).toBe(true);
    expect(
      (await service.list(alice.id, 'history', 1)).quizzes.some(
        (q) => q.id === draft.id,
      ),
    ).toBe(true);
    await service.close(owner.id, draft.id);
    expect(
      (await engine.result(alice.id, attempt.id)).questions[0]!.explanation,
    ).toBe(question.explanation);
  });
  it('serializes joining and starting against permanent closure', async () => {
    const quiz = await published();
    const joining = await Promise.allSettled([
      service.join(alice.id, quiz.invitation.code),
      service.close(owner.id, quiz.id),
    ]);
    expect(joining[1]!.status).toBe('fulfilled');
    expect(
      await db.challengeParticipant.count({ where: { quizId: quiz.id } }),
    ).toBe(joining[0]!.status === 'fulfilled' ? 1 : 0);
    await expect(engine.start(alice.id, quiz.id)).rejects.toThrow();
    const other = await joined();
    const starting = await Promise.allSettled([
      engine.start(alice.id, other.id),
      service.close(owner.id, other.id),
    ]);
    expect(starting[1]!.status).toBe('fulfilled');
    if (starting[0]!.status === 'fulfilled')
      expect((await engine.get(alice.id, starting[0]!.value.id)).status).toBe(
        'EXPIRED',
      );
    else
      expect(await db.attempt.count({ where: { quizId: other.id } })).toBe(0);
  });
  it('caps timers by the earliest deadline and never extends an earlier manual close', async () => {
    const quiz = await joined({
      timeLimitSeconds: 60,
      closesAt: new Date(Date.now() + 120000).toISOString(),
    });
    const attempt = await engine.start(alice.id, quiz.id);
    expect(Date.parse(attempt.expiresAt!) - Date.parse(attempt.startedAt)).toBe(
      60000,
    );
    const closed = await service.close(owner.id, quiz.id);
    expect(Date.parse(closed.closedAt)).toBeLessThan(
      Date.parse(attempt.expiresAt!),
    );
    expect((await engine.result(alice.id, attempt.id)).finalizedAt).toBe(
      closed.closedAt,
    );
  });
  it('keeps rankings in an updating state until bounded closure finalization finishes', async () => {
    const quiz = await published(),
      ids = Array.from({ length: 201 }, () => randomUUID());
    await db.user.createMany({
      data: ids.map((id) => ({
        id,
        email: id + '@example.edu',
        displayName: 'Bulk friend',
        passwordHash: 'unused-test-hash',
        role: 'STUDENT',
      })),
    });
    await db.challengeParticipant.createMany({
      data: ids.map((studentId) => ({ quizId: quiz.id, studentId })),
    });
    await db.attempt.createMany({
      data: ids.map((userId) => ({
        quizId: quiz.id,
        userId,
        attemptNumber: 1,
        totalQuestions: 1,
        startedAt: new Date(Date.now() - 1000),
      })),
    });
    await service.close(owner.id, quiz.id);
    const first = await service.leaderboard(owner.id, quiz.id, 1);
    expect(first.updating).toBe(true);
    expect(first.entries).toEqual([]);
    const final = await service.leaderboard(owner.id, quiz.id, 1);
    expect(final.updating).toBe(false);
    expect(final.total).toBe(201);
    expect(final.entries).toHaveLength(20);
  }, 15000);
  it('uses canonical UUID identity for invitation encryption and concurrent locks', async () => {
    const quiz = await service.author.create(owner.id, input());
    await service.publish(owner.id, quiz.id.toUpperCase(), quiz.revision);
    const lower = await service.invitation(owner.id, quiz.id),
      upper = await service.invitation(owner.id, quiz.id.toUpperCase());
    expect(lower.code).toBe(upper.code);
    await service.join(alice.id, lower.code);
    const starts = await Promise.all([
      engine.start(alice.id, quiz.id),
      engine.start(alice.id, quiz.id.toUpperCase()),
    ]);
    expect(starts[0]!.id).toBe(starts[1]!.id);
    const q = starts[0]!.questions[0]!;
    await Promise.allSettled([
      engine.save(alice.id, starts[0]!.id, q.id, {
        selectedOptionId: q.options[0]!.id,
        revision: 0,
      }),
      service.close(owner.id, quiz.id.toUpperCase()),
    ]);
    const result = await engine.result(alice.id, starts[0]!.id);
    expect(result.status).toBe('EXPIRED');
    expect(result.reviewAvailable).toBe(true);
  });
});
