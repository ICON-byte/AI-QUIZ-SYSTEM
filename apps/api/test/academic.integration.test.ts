import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database.js';
import { verifyLecturer } from '../src/modules/users/verification.js';
import { createCourseService } from '../src/modules/courses/service.js';
import { createQuizService } from '../src/modules/quizzes/service.js';
import { createAttemptEngine } from '../src/modules/attempts/engine.js';
import { createAssessmentService } from '../src/modules/assessments/service.js';
import { tokenHash } from '../src/modules/auth/tokens.js';
import { databaseNow } from '../src/modules/quizzes/data.js';

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
const courses = createCourseService(db);
const engine = createAttemptEngine(db);
const assessments = createAssessmentService(db);
type Account = { id: string; cookies: string[] };
let lecturer: Account;
let otherLecturer: Account;
let pending: Account;
let student: Account;
let outsider: Account;
const courseInput = () => ({
  title: 'Cell biology',
  code: `BIO-${randomUUID().slice(0, 8)}`.toUpperCase(),
  description: 'An introductory course.',
});
const question = {
  prompt: 'Where is most cellular DNA stored?',
  options: ['Nucleus', 'Vacuole', 'Cell wall', 'Membrane'] as [
    string,
    string,
    string,
    string,
  ],
  correctOption: 0,
  explanation: 'The nucleus contains most cellular DNA.',
};
const assessmentInput = (extra = {}) => ({
  title: 'Cells assessment',
  description: 'A short assessment.',
  timeLimitSeconds: 600,
  questions: [
    question,
    {
      ...question,
      prompt: 'Which organelle produces ATP?',
      options: ['Ribosome', 'Mitochondrion', 'Golgi', 'Lysosome'] as [
        string,
        string,
        string,
        string,
      ],
      correctOption: 1,
    },
  ],
  opensAt: null,
  closesAt: new Date(Date.now() + 3600000).toISOString(),
  maxAttempts: 1,
  ...extra,
});
function mutate(
  account: Account,
  method: 'post' | 'put',
  path: string,
  body: object = {},
) {
  const response = request(app)[method]('/api/v1' + path);
  return response
    .set('Cookie', account.cookies)
    .set('Origin', config.APP_ORIGIN)
    .set('X-CSRF-Protection', '1')
    .send(body);
}
const get = (account: Account, path: string) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', account.cookies);
async function course() {
  return courses.create(lecturer.id, courseInput());
}
async function fixture(extra = {}) {
  const c = await course();
  await courses.join(student.id, c.enrollmentCode);
  const service = createQuizService(db, c.id);
  const q = await service.create(lecturer.id, assessmentInput(extra));
  await service.publish(lecturer.id, q.id, 0);
  return { course: c, quiz: q };
}
function assertNoKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    expect([
      'correctOptionId',
      'correctOption',
      'isCorrect',
      'explanation',
      'enrollmentCodeHash',
      'passwordHash',
    ]).not.toContain(key);
    assertNoKeys(item);
  }
}
beforeAll(async () => {
  await db.$connect();
  await ready;
  async function register(role: 'STUDENT' | 'LECTURER', approved = false) {
    const email = `${randomUUID()}@example.edu`;
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.APP_ORIGIN)
      .set('X-CSRF-Protection', '1')
      .send({
        email,
        displayName: role === 'LECTURER' ? 'Nneka Okafor' : 'Ada Okoro',
        password: 'long-safe-test-passphrase',
        role,
      });
    expect(response.status).toBe(201);
    if (approved)
      await verifyLecturer(db, {
        email,
        actor: 'academic-tests',
        decision: 'approve',
        reason: 'Confirmed institutional appointment',
      });
    return {
      id: response.body.user.id as string,
      cookies: (response.headers['set-cookie'] as unknown as string[]).map(
        (value) => value.split(';')[0]!,
      ),
    };
  }
  lecturer = await register('LECTURER', true);
  otherLecturer = await register('LECTURER', true);
  pending = await register('LECTURER');
  student = await register('STUDENT');
  outsider = await register('STUDENT');
});
afterAll(async () => {
  await db.$disconnect();
});

describe.sequential('courses and official assessments on PostgreSQL', () => {
  it('normalizes unfinished legacy clocks without changing finalized history', async () => {
    const migration = await readFile(
      new URL(
        '../prisma/migrations/202611020003_courses_assessments/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const statement = migration.match(
      /WITH corrected AS \([\s\S]*?FROM corrected c WHERE a\."id"=c\."id";/,
    )?.[0];
    expect(statement).toBeTruthy();
    const temporarySchema = `upgrade_${randomUUID().replaceAll('-', '')}`;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${temporarySchema}"`);
      await tx.$executeRawUnsafe(
        `SET LOCAL search_path TO "${temporarySchema}"`,
      );
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Africa/Lagos'`;
      await tx.$executeRawUnsafe(
        'CREATE TABLE "Attempt" ("id" text, "status" text, "startedAt" timestamp(3), "expiresAt" timestamp(3))',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "Attempt" VALUES ('active','IN_PROGRESS','2026-11-02 13:00','2026-11-02 13:10'),('final','SUBMITTED','2026-11-02 13:00','2026-11-02 13:10'),('untimed','IN_PROGRESS','2026-11-02 13:00',NULL)`,
      );
      await tx.$executeRawUnsafe(statement!);
      const rows = await tx.$queryRaw<
        { id: string; started: string; expires: string | null }[]
      >`SELECT "id", "startedAt"::text AS started, "expiresAt"::text AS expires FROM "Attempt" ORDER BY "id"`;
      expect(rows).toEqual([
        {
          id: 'active',
          started: '2026-11-02 12:00:00',
          expires: '2026-11-02 12:10:00',
        },
        {
          id: 'final',
          started: '2026-11-02 13:00:00',
          expires: '2026-11-02 13:10:00',
        },
        { id: 'untimed', started: '2026-11-02 12:00:00', expires: null },
      ]);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${temporarySchema}" CASCADE`);
    });
  });
  it('uses the actual database instant regardless of session timezone', async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Africa/Lagos'`;
      expect(
        Math.abs((await databaseNow(tx)).getTime() - Date.now()),
      ).toBeLessThan(2000);
      await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`;
      expect(
        Math.abs((await databaseNow(tx)).getTime() - Date.now()),
      ).toBeLessThan(2000);
    });
  });
  it('restricts course management to verified lecturers and stores only enrollment-code hashes', async () => {
    expect(
      (await mutate(pending, 'post', '/courses', courseInput())).status,
    ).toBe(403);
    expect(
      (await mutate(student, 'post', '/courses', courseInput())).status,
    ).toBe(403);
    const response = await mutate(lecturer, 'post', '/courses', courseInput());
    expect(response.status).toBe(201);
    expect(response.body.enrollmentCode).toMatch(/^[A-F0-9]{24}$/);
    const row = await db.course.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    expect(row.enrollmentCodeHash).toBe(
      tokenHash(response.body.enrollmentCode),
    );
    assertNoKeys((await get(lecturer, `/courses/${row.id}`)).body);
    await expect(
      db.course.create({ data: { ...courseInput(), ownerId: pending.id } }),
    ).rejects.toThrow();
  });
  it('enforces course ownership, normalized unique codes and revision-controlled editing', async () => {
    const c = await course();
    expect((await get(otherLecturer, `/courses/${c.id}`)).status).toBe(404);
    expect(
      (
        await mutate(otherLecturer, 'put', `/courses/${c.id}`, {
          ...courseInput(),
          revision: 0,
        })
      ).status,
    ).toBe(404);
    const input = courseInput();
    expect(
      (
        await mutate(lecturer, 'put', `/courses/${c.id}`, {
          ...input,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(lecturer, 'put', `/courses/${c.id}`, {
          ...input,
          revision: 0,
        })
      ).status,
    ).toBe(409);
    expect((await mutate(lecturer, 'post', '/courses', input)).status).toBe(
      409,
    );
  });
  it('prevents duplicate enrollment under concurrency and hides course/roster data from outsiders', async () => {
    const c = await course();
    const responses = await Promise.all(
      [1, 2].map(() =>
        mutate(student, 'post', '/courses/join', {
          code: c.enrollmentCode.toLowerCase(),
        }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await db.enrollment.count({
        where: { courseId: c.id, studentId: student.id },
      }),
    ).toBe(1);
    expect((await get(outsider, `/courses/${c.id}`)).status).toBe(404);
    expect((await get(student, `/courses/${c.id}/roster`)).status).toBe(403);
    expect((await get(lecturer, `/courses/${c.id}/roster`)).body.active).toBe(
      1,
    );
    expect(
      (await get(student, '/courses')).body.courses.some(
        (row: { id: string }) => row.id === c.id,
      ),
    ).toBe(true);
  });
  it('revokes and rotates enrollment codes without removing enrolled students', async () => {
    const c = await course();
    await courses.join(student.id, c.enrollmentCode);
    const rotated = await mutate(
      lecturer,
      'post',
      `/courses/${c.id}/enrollment-code`,
    );
    expect(rotated.status).toBe(200);
    expect(rotated.body.enrollmentCode).not.toBe(c.enrollmentCode);
    expect(
      (
        await mutate(outsider, 'post', '/courses/join', {
          code: c.enrollmentCode,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate(outsider, 'post', '/courses/join', {
          code: rotated.body.enrollmentCode,
        })
      ).status,
    ).toBe(200);
    await mutate(lecturer, 'post', `/courses/${c.id}/revoke-code`);
    expect(
      (
        await mutate(outsider, 'post', '/courses/join', {
          code: rotated.body.enrollmentCode,
        })
      ).status,
    ).toBe(404);
    expect((await get(student, `/courses/${c.id}`)).status).toBe(200);
  });
  it('supports leave/rejoin and lecturer removal/restoration while preserving membership records', async () => {
    const c = await course();
    await courses.join(student.id, c.enrollmentCode);
    expect(
      (await mutate(student, 'post', `/courses/${c.id}/leave`)).status,
    ).toBe(200);
    expect((await get(student, `/courses/${c.id}`)).status).toBe(404);
    await courses.join(student.id, c.enrollmentCode);
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/students/${student.id}/remove`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(student, 'post', '/courses/join', {
          code: c.enrollmentCode,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await mutate(
          otherLecturer,
          'post',
          `/courses/${c.id}/students/${student.id}/restore`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/students/${student.id}/restore`,
        )
      ).status,
    ).toBe(200);
    expect((await get(student, `/courses/${c.id}`)).status).toBe(200);
  });
  it('creates and edits official assessment drafts only within owned courses', async () => {
    const c = await course();
    const path = `/courses/${c.id}/assessments`;
    expect(
      (await mutate(student, 'post', path, assessmentInput())).status,
    ).toBe(403);
    expect(
      (await mutate(pending, 'post', path, assessmentInput())).status,
    ).toBe(403);
    expect(
      (await mutate(otherLecturer, 'post', path, assessmentInput())).status,
    ).toBe(404);
    const created = await mutate(lecturer, 'post', path, assessmentInput());
    expect(created.status).toBe(201);
    expect(created.body.mode).toBe('ASSESSMENT');
    const q = created.body;
    expect(
      (
        await mutate(lecturer, 'put', `${path}/${q.id}`, {
          ...assessmentInput(),
          revision: 0,
          questions: [question],
        })
      ).body.questionCount,
    ).toBe(1);
    expect(
      (await get(lecturer, `${path}/${q.id}/draft`)).body.questions,
    ).toHaveLength(1);
    expect(
      (
        await mutate(lecturer, 'post', `${path}/${q.id}/publish`, {
          revision: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(lecturer, 'put', `${path}/${q.id}`, {
          ...assessmentInput(),
          revision: 2,
        })
      ).status,
    ).toBe(409);
    await expect(
      db.quiz.update({ where: { id: q.id }, data: { maxAttempts: 9 } }),
    ).rejects.toThrow();
    await expect(
      db.quiz.update({
        where: { id: q.id },
        data: { closesAt: new Date(Date.now() + 7200000) },
      }),
    ).rejects.toThrow();
  });
  it('requires a valid future close when publishing and hides drafts from students', async () => {
    const c = await course();
    await courses.join(student.id, c.enrollmentCode);
    const service = createQuizService(db, c.id);
    const q = await service.create(
      lecturer.id,
      assessmentInput({ closesAt: null }),
    );
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/assessments/${q.id}/publish`,
          { revision: 0 },
        )
      ).status,
    ).toBe(400);
    expect(
      (await get(student, `/courses/${c.id}/assessments`)).body.assessments,
    ).toHaveLength(0);
    expect((await get(student, `/assessments/${q.id}`)).status).toBe(404);
    expect(
      (await mutate(student, 'post', `/quizzes/${q.id}/attempts`)).status,
    ).toBe(404);
  });
  it('enforces opening times, enrollment and timer/closing-date effective deadlines', async () => {
    const scheduled = await fixture({
      opensAt: new Date(Date.now() + 3600000).toISOString(),
      closesAt: new Date(Date.now() + 7200000).toISOString(),
    });
    expect(
      (await mutate(student, 'post', `/quizzes/${scheduled.quiz.id}/attempts`))
        .status,
    ).toBe(403);
    const active = await fixture({
      closesAt: new Date(Date.now() + 120000).toISOString(),
    });
    expect((await get(outsider, `/assessments/${active.quiz.id}`)).status).toBe(
      404,
    );
    expect(
      (await mutate(outsider, 'post', `/quizzes/${active.quiz.id}/attempts`))
        .status,
    ).toBe(404);
    const response = await mutate(
      student,
      'post',
      `/quizzes/${active.quiz.id}/attempts`,
    );
    expect(response.status).toBe(200);
    expect(response.body.expiresAt).toBe(active.quiz.closesAt);
    assertNoKeys(response.body);
    assertNoKeys((await get(student, `/assessments/${active.quiz.id}`)).body);
  });
  it('uses one active attempt and prevents concurrent requests exceeding attempt limits', async () => {
    const { quiz } = await fixture();
    const started = await Promise.all(
      [1, 2, 3].map(() =>
        mutate(student, 'post', `/quizzes/${quiz.id}/attempts`),
      ),
    );
    expect(started.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(started.map((r) => r.body.id)).size).toBe(1);
    const id = started[0]!.body.id;
    await engine.submit(student.id, id);
    const more = await Promise.all(
      [1, 2].map(() => mutate(student, 'post', `/quizzes/${quiz.id}/attempts`)),
    );
    expect(more.map((r) => r.status)).toEqual([403, 403]);
    expect(await db.attempt.count({ where: { quizId: quiz.id } })).toBe(1);
    await expect(
      db.attempt.create({
        data: {
          quizId: quiz.id,
          userId: student.id,
          attemptNumber: 2,
          totalQuestions: 2,
          expiresAt: new Date(quiz.closesAt!),
        },
      }),
    ).rejects.toThrow();
  });
  it('keeps keys hidden after submission and reveals review only after closure', async () => {
    const { course: c, quiz } = await fixture();
    const attempt = await engine.start(student.id, quiz.id);
    await engine.save(student.id, attempt.id, attempt.questions[0]!.id, {
      selectedOptionId: attempt.questions[0]!.options[0]!.id,
      revision: 0,
    });
    const submissions = await Promise.all(
      [1, 2].map(() =>
        mutate(student, 'post', `/attempts/${attempt.id}/submit`),
      ),
    );
    expect(submissions.map((r) => r.status)).toEqual([200, 200]);
    const held = (await get(student, `/attempts/${attempt.id}/result`)).body;
    expect(held).toMatchObject({
      correctAnswers: 1,
      percentage: 50,
      reviewAvailable: false,
      questions: [],
    });
    assertNoKeys(held);
    expect(
      (await mutate(student, 'post', `/attempts/${attempt.id}/retry-incorrect`))
        .status,
    ).toBe(403);
    expect((await get(outsider, `/attempts/${attempt.id}/result`)).status).toBe(
      404,
    );
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/assessments/${quiz.id}/close`,
        )
      ).status,
    ).toBe(200);
    const released = (await get(student, `/attempts/${attempt.id}/result`))
      .body;
    expect(released.reviewAvailable).toBe(true);
    expect(released.questions[0].explanation).toBe(question.explanation);
    expect(
      (await mutate(student, 'post', `/quizzes/${quiz.id}/attempts`)).status,
    ).toBe(403);
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/assessments/${quiz.id}/close`,
        )
      ).status,
    ).toBe(200);
    await expect(
      db.quiz.update({ where: { id: quiz.id }, data: { closedAt: null } }),
    ).rejects.toThrow();
  });
  it('blocks membership removal during active attempts and serializes removal against starting', async () => {
    const { course: c, quiz } = await fixture();
    const attempt = await engine.start(student.id, quiz.id);
    expect(
      (await mutate(student, 'post', `/courses/${c.id}/leave`)).status,
    ).toBe(409);
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/students/${student.id}/remove`,
        )
      ).status,
    ).toBe(409);
    await assessments.close(lecturer.id, c.id, quiz.id);
    expect((await engine.result(student.id, attempt.id)).status).toBe(
      'EXPIRED',
    );
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/students/${student.id}/remove`,
        )
      ).status,
    ).toBe(200);
    expect((await get(student, `/attempts/${attempt.id}/result`)).status).toBe(
      404,
    );
    const next = await fixture();
    const [start, remove] = await Promise.all([
      mutate(student, 'post', `/quizzes/${next.quiz.id}/attempts`),
      mutate(
        lecturer,
        'post',
        `/courses/${next.course.id}/students/${student.id}/remove`,
      ),
    ]);
    expect([
      [200, 409],
      [404, 200],
    ]).toContainEqual([start.status, remove.status]);
  });
  it('applies early closure to in-flight answer saving and preserves stored results', async () => {
    const { course: c, quiz } = await fixture();
    const attempt = await engine.start(student.id, quiz.id);
    const q = attempt.questions[0]!;
    const [save, close] = await Promise.all([
      mutate(student, 'put', `/attempts/${attempt.id}/answers/${q.id}`, {
        selectedOptionId: q.options[0]!.id,
        revision: 0,
      }),
      mutate(lecturer, 'post', `/courses/${c.id}/assessments/${quiz.id}/close`),
    ]);
    expect(close.status).toBe(200);
    expect([200, 409]).toContain(save.status);
    const result = await engine.result(student.id, attempt.id);
    expect(result.status).toBe('EXPIRED');
    expect(result.correctAnswers).toBe(save.status === 200 ? 1 : 0);
    expect(
      (
        await mutate(
          student,
          'put',
          `/attempts/${attempt.id}/answers/${q.id}`,
          { selectedOptionId: null, revision: 1 },
        )
      ).status,
    ).toBe(409);
  });
  it('finalizes a closure in the same millisecond as the attempt start', async () => {
    const { quiz } = await fixture();
    const attempt = await engine.start(student.id, quiz.id);
    await db.quiz.update({ where: { id: quiz.id }, data: { closedAt: new Date(attempt.startedAt) } });
    const result = await engine.result(student.id, attempt.id);
    expect(result).toMatchObject({ status: 'EXPIRED', durationSeconds: 0, correctAnswers: 0, reviewAvailable: true });
  });

  it('provides scoped lecturer reports with accurate averages and question statistics', async () => {
    const { course: c, quiz } = await fixture({ maxAttempts: 2 });
    await courses.join(outsider.id, c.enrollmentCode);
    const first = await engine.start(student.id, quiz.id);
    await engine.save(student.id, first.id, first.questions[0]!.id, {
      selectedOptionId: first.questions[0]!.options[0]!.id,
      revision: 0,
    });
    await engine.submit(student.id, first.id);
    const second = await engine.start(outsider.id, quiz.id);
    await engine.submit(outsider.id, second.id);
    const path = `/courses/${c.id}/assessments/${quiz.id}/report`;
    expect((await get(student, path)).status).toBe(403);
    expect((await get(otherLecturer, path)).status).toBe(404);
    const report = (await get(lecturer, path)).body;
    expect(report).toMatchObject({
      totalEnrolled: 2,
      studentsAttempted: 2,
      finalizedAttempts: 2,
      averagePercentage: 25,
      highestPercentage: 50,
      lowestPercentage: 0,
    });
    expect(report.questions[0]).toMatchObject({
      correctCount: 1,
      totalGraded: 2,
    });
    expect(
      report.attempts.every(
        (row: { submittedAt: string }) => !!row.submittedAt,
      ),
    ).toBe(true);
    const third = await engine.start(student.id, quiz.id);
    expect(third.attemptNumber).toBe(2);
    expect((await engine.result(student.id, first.id)).percentage).toBe(50);
  });
  it('archives courses safely, stops participation, and preserves attempts and review', async () => {
    const { course: c, quiz } = await fixture();
    const attempt = await engine.start(student.id, quiz.id);
    expect(
      (await mutate(lecturer, 'post', `/courses/${c.id}/archive`)).status,
    ).toBe(200);
    expect(
      (await mutate(lecturer, 'post', `/courses/${c.id}/archive`)).status,
    ).toBe(200);
    expect((await engine.result(student.id, attempt.id)).reviewAvailable).toBe(
      true,
    );
    expect(
      (await mutate(student, 'post', `/quizzes/${quiz.id}/attempts`)).status,
    ).toBe(403);
    expect(
      (
        await mutate(
          lecturer,
          'post',
          `/courses/${c.id}/assessments`,
          assessmentInput(),
        )
      ).status,
    ).toBe(409);
    expect(
      (await get(student, `/courses/${c.id}`)).body.archivedAt,
    ).toBeTruthy();
    expect(await db.attempt.count({ where: { quizId: quiz.id } })).toBe(1);
  });
  it('releases answers at a scheduled closing time and refuses later starts', async () => {
    const { quiz } = await fixture({
      closesAt: new Date(Date.now() + 1800).toISOString(),
    });
    const attempt = await engine.start(student.id, quiz.id);
    await new Promise((resolve) => setTimeout(resolve, 1900));
    const result = await engine.result(student.id, attempt.id);
    expect(result.status).toBe('EXPIRED');
    expect(result.reviewAvailable).toBe(true);
    expect(result.finalizedAt).toBe(quiz.closesAt);
    expect(
      (await mutate(student, 'post', `/quizzes/${quiz.id}/attempts`)).status,
    ).toBe(403);
  });
});
