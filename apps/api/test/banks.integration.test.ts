import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database.js';
import { verifyLecturer } from '../src/modules/users/verification.js';
import { createBankService } from '../src/modules/banks/service.js';
import { createQuizService } from '../src/modules/quizzes/service.js';
import { createAttemptEngine } from '../src/modules/attempts/engine.js';
import { createCourseService } from '../src/modules/courses/service.js';
import {
  bankListSchema,
  questionListSchema,
} from '../src/modules/banks/validation.js';
import { csvTemplate, headers } from '../src/modules/banks/csv.js';

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
const banks = createBankService(db, config.JWT_SECRET);
const quizzes = createQuizService(db);
type Account = { id: string; cookies: string[] };
let student: Account;
let other: Account;
let lecturer: Account;
let pending: Account;
const question = {
  prompt: 'Which is prime?',
  options: ['2', '4', '6', '8'] as [string, string, string, string],
  correctOption: 0,
  explanation: 'Two factors.',
  difficulty: 'EASY' as const,
  topic: 'Numbers',
};
const makeBank = (owner = student.id) =>
  banks.create(owner, {
    title: 'Number theory',
    description: 'Reusable questions.',
    courseId: null,
  });
const get = (path: string, account = student) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', account.cookies);
const mutate = (
  path: string,
  body: object,
  account = student,
  method: 'post' | 'put' = 'post',
) =>
  request(app)[method]('/api/v1' + path)
    .set('Cookie', account.cookies)
    .set('Origin', config.APP_ORIGIN)
    .set('X-CSRF-Protection', '1')
    .send(body);
beforeAll(async () => {
  await ready;
  async function register(role: 'STUDENT' | 'LECTURER', approved = false) {
    const email = `${randomUUID()}@example.edu`;
    const res = await mutate(
      '/auth/register',
      {
        email,
        displayName: role === 'STUDENT' ? 'Ada Okoro' : 'Nneka Okafor',
        password: 'safe-long-test-passphrase',
        role,
        ageConfirmed: true,
      },
      { id: '', cookies: [] },
    );
    expect(res.status).toBe(201);
    if (approved)
      await verifyLecturer(db, {
        email,
        actor: 'bank-tests',
        decision: 'approve',
        reason: 'Confirmed lecturer identity.',
      });
    return {
      id: res.body.user.id as string,
      cookies: (res.headers['set-cookie'] as unknown as string[]).map(
        (v) => v.split(';')[0]!,
      ),
    };
  }
  student = await register('STUDENT');
  other = await register('STUDENT');
  lecturer = await register('LECTURER', true);
  pending = await register('LECTURER');
});
afterAll(async () => {
  await db.$disconnect();
});

describe.sequential('private question banks on PostgreSQL', () => {
  it('requires authentication and preserves origin/CSRF checks for bank mutations', async () => {
    expect((await request(app).get('/api/v1/question-banks')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/question-banks')
          .set('Cookie', student.cookies)
          .send({ title: 'Private' })
      ).status,
    ).toBe(403);
  });
  it('allows students and pending lecturers to create private banks and validates input', async () => {
    expect(
      (await mutate('/question-banks', { title: 'Student bank' })).status,
    ).toBe(201);
    expect(
      (await mutate('/question-banks', { title: 'Lecturer bank' }, pending))
        .status,
    ).toBe(201);
    expect(
      (await mutate('/question-banks', { title: '', ownerId: other.id }))
        .status,
    ).toBe(400);
    expect((await banks.list(other.id, bankListSchema.parse({}))).total).toBe(
      0,
    );
  });
  it('prevents reading, editing, archiving or duplicating another owner’s bank or its questions', async () => {
    const bank = await makeBank();
    const q = await banks.add(student.id, bank.id, question);
    for (const path of [
      `/question-banks/${bank.id}`,
      `/question-banks/${bank.id}/questions`,
      `/question-banks/${bank.id}/questions/${q.id}`,
    ])
      expect((await get(path, other)).status).toBe(404);
    expect(
      (
        await mutate(
          `/question-banks/${bank.id}/archive`,
          { revision: 0 },
          other,
        )
      ).status,
    ).toBe(404);
    expect(
      (await mutate(`/question-banks/${bank.id}/duplicate`, {}, other)).status,
    ).toBe(404);
    expect(
      (
        await mutate(
          `/question-banks/${bank.id}/questions/${q.id}`,
          { ...question, revision: 0 },
          other,
          'put',
        )
      ).status,
    ).toBe(404);
    expect(
      (await mutate('/question-banks/selection', { ids: [q.id] }, other))
        .status,
    ).toBe(404);
  });
  it('associates only the lecturer owner’s course and does not share questions through enrollment', async () => {
    const c = await createCourseService(db).create(lecturer.id, {
      title: 'Mathematics',
      code: ('MATH-' + randomUUID().slice(0, 8)).toUpperCase(),
      description: '',
    });
    await createCourseService(db).join(student.id, c.enrollmentCode);
    const bank = await banks.create(lecturer.id, {
      title: 'Course bank',
      description: '',
      courseId: c.id,
    });
    expect(bank.courseId).toBe(c.id);
    expect(
      (
        await mutate('/question-banks', {
          title: 'Stolen association',
          courseId: c.id,
        })
      ).status,
    ).toBe(404);
    expect((await get(`/question-banks/${bank.id}`)).status).toBe(404);
    await expect(
      db.questionBank.create({
        data: {
          ownerId: student.id,
          title: 'Invalid association',
          courseId: c.id,
        },
      }),
    ).rejects.toThrow();
  });
  it('handles revision conflicts and bank archive without deleting questions', async () => {
    const bank = await makeBank();
    const q = await banks.add(student.id, bank.id, question);
    const updated = await banks.update(student.id, bank.id, {
      title: 'Renamed bank',
      description: '',
      courseId: null,
      revision: 0,
    });
    expect(updated.revision).toBe(1);
    await expect(
      banks.update(student.id, bank.id, {
        title: 'Stale',
        description: '',
        courseId: null,
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await banks.archive(student.id, bank.id, 1);
    expect((await banks.getQuestion(student.id, bank.id, q.id)).prompt).toBe(
      question.prompt,
    );
    await expect(
      banks.add(student.id, bank.id, question),
    ).rejects.toMatchObject({ status: 409 });
    await expect(banks.select(student.id, [q.id])).rejects.toThrow();
    expect(
      (
        await banks.list(
          student.id,
          bankListSchema.parse({ archived: 'true', search: 'Renamed' }),
        )
      ).banks.some((b) => b.id === bank.id),
    ).toBe(true);
  });
  it('reuses four-option validation and enforces database answer constraints', async () => {
    const bank = await makeBank();
    for (const invalid of [
      { ...question, options: ['2', ' 2 ', '6', '8'] },
      { ...question, correctOption: 4 },
      { ...question, difficulty: 'IMPOSSIBLE' },
      { ...question, prompt: '' },
      { ...question, options: ['2', '4', '6'] },
    ])
      expect(
        (await mutate(`/question-banks/${bank.id}/questions`, invalid)).status,
      ).toBe(400);
    await expect(
      db.question.create({
        data: { ...question, bankId: bank.id, correctOption: 5 },
      }),
    ).rejects.toThrow();
    await expect(
      db.question.create({
        data: { ...question, bankId: bank.id, options: ['2', '2', '6', '8'] },
      }),
    ).rejects.toThrow();
  });
  it('edits and filters questions with stale-tab protection', async () => {
    const bank = await makeBank();
    const q = await banks.add(student.id, bank.id, question);
    const updated = await banks.edit(student.id, bank.id, q.id, {
      ...question,
      prompt: 'Another prime?',
      topic: 'Integers',
      difficulty: 'HARD',
      revision: 0,
    });
    expect(updated.revision).toBe(1);
    await expect(
      banks.edit(student.id, bank.id, q.id, { ...question, revision: 0 }),
    ).rejects.toMatchObject({ status: 409 });
    const result = await banks.questions(
      student.id,
      bank.id,
      questionListSchema.parse({
        search: 'prime',
        topic: 'integer',
        difficulty: 'HARD',
      }),
    );
    expect(result.total).toBe(1);
    expect(result.questions[0]?.correctOption).toBe(0);
    expect(
      (
        await banks.questions(
          student.id,
          bank.id,
          questionListSchema.parse({ difficulty: 'EASY' }),
        )
      ).total,
    ).toBe(0);
  });
  it('archives individual questions and excludes them from selection and active counts', async () => {
    const bank = await makeBank();
    const q = await banks.add(student.id, bank.id, question);
    await banks.archiveQuestion(student.id, bank.id, q.id, 0);
    expect((await banks.get(student.id, bank.id)).questionCount).toBe(0);
    expect(
      (
        await banks.questions(
          student.id,
          bank.id,
          questionListSchema.parse({ archived: 'true' }),
        )
      ).total,
    ).toBe(1);
    await expect(banks.select(student.id, [q.id])).rejects.toThrow();
    await expect(
      banks.edit(student.id, bank.id, q.id, { ...question, revision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('copies and moves questions only between owned active banks, preserving original copies', async () => {
    const a = await makeBank();
    const b = await makeBank();
    const foreign = await makeBank(other.id);
    const q = await banks.add(student.id, a.id, question);
    const copy = await banks.transfer(student.id, a.id, q.id, {
      targetBankId: b.id,
      action: 'COPY',
      revision: 0,
    });
    expect(copy.id).not.toBe(q.id);
    expect((await banks.getQuestion(student.id, a.id, q.id)).revision).toBe(0);
    await expect(
      banks.transfer(student.id, a.id, q.id, {
        targetBankId: foreign.id,
        action: 'MOVE',
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const moved = await banks.transfer(student.id, a.id, q.id, {
      targetBankId: b.id,
      action: 'MOVE',
      revision: 0,
    });
    expect(moved.bankId).toBe(b.id);
    expect(moved.revision).toBe(1);
    await expect(banks.getQuestion(student.id, a.id, q.id)).rejects.toThrow();
  });
  it('serializes opposite-direction moves without deadlock', async () => {
    const a = await makeBank();
    const b = await makeBank();
    const qa = await banks.add(student.id, a.id, question);
    const qb = await banks.add(student.id, b.id, question);
    const results = await Promise.all([
      banks.transfer(student.id, a.id, qa.id, {
        targetBankId: b.id,
        action: 'MOVE',
        revision: 0,
      }),
      banks.transfer(student.id, b.id, qb.id, {
        targetBankId: a.id,
        action: 'MOVE',
        revision: 0,
      }),
    ]);
    expect(results.map((q) => q.bankId)).toEqual([b.id, a.id]);
  });
  it('duplicates banks with independent active questions and no course or history references', async () => {
    const bank = await makeBank();
    const q = await banks.add(student.id, bank.id, question);
    const archived = await banks.add(student.id, bank.id, question);
    await banks.archiveQuestion(student.id, bank.id, archived.id, 0);
    const copy = await banks.duplicate(student.id, bank.id);
    expect(copy.title).toContain('(copy)');
    expect(copy.questionCount).toBe(1);
    expect(copy.courseId).toBeNull();
    const copiedQuestions = await banks.questions(
      student.id,
      copy.id,
      questionListSchema.parse({}),
    );
    expect(copiedQuestions.questions[0]?.id).not.toBe(q.id);
    await banks.edit(student.id, bank.id, q.id, {
      ...question,
      prompt: 'Changed original',
      revision: 0,
    });
    expect(copiedQuestions.questions[0]?.prompt).toBe(question.prompt);
  });
  it('previews without writing, requires explicit confirmation, and rejects changed files and wrong-bank tokens', async () => {
    const a = await makeBank();
    const b = await makeBank();
    const csv = csvTemplate();
    const preview = await mutate(`/question-banks/${a.id}/import/preview`, {
      csv,
    });
    expect(preview.status).toBe(200);
    expect((await banks.get(student.id, a.id)).questionCount).toBe(0);
    expect(
      (
        await mutate(`/question-banks/${a.id}/import/confirm`, {
          csv,
          token: preview.body.token,
          skipInvalid: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate(`/question-banks/${b.id}/import/confirm`, {
          csv,
          token: preview.body.token,
          confirmed: true,
          skipInvalid: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate(`/question-banks/${a.id}/import/confirm`, {
          csv: csv + ' ',
          token: preview.body.token,
          confirmed: true,
          skipInvalid: false,
        })
      ).status,
    ).toBe(400);
  });
  it('reports invalid rows and skips them only with explicit acknowledgement', async () => {
    const bank = await makeBank();
    const csv = csvTemplate() + 'Bad question,one,one,,,Z,,IMPOSSIBLE,\r\n';
    const preview = await banks.preview(student.id, bank.id, csv);
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(1);
    expect(preview.rows[1]?.row).toBe(3);
    await expect(
      banks.confirm(student.id, bank.id, {
        csv,
        token: preview.token,
        confirmed: true,
        skipInvalid: false,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await banks.confirm(student.id, bank.id, {
        csv,
        token: preview.token,
        confirmed: true,
        skipInvalid: true,
      }),
    ).toEqual({ importedCount: 1, skippedCount: 1 });
  });
  it('makes concurrent confirmation and lost-response retries idempotent on PostgreSQL', async () => {
    const bank = await makeBank();
    const csv = csvTemplate();
    const preview = await banks.preview(student.id, bank.id, csv);
    const input = {
      csv,
      token: preview.token,
      confirmed: true as const,
      skipInvalid: false,
    };
    const results = await Promise.all([
      banks.confirm(student.id, bank.id, input),
      banks.confirm(student.id, bank.id, input),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await banks.get(student.id, bank.id)).questionCount).toBe(1);
    expect(await banks.confirm(student.id, bank.id, input)).toEqual(results[0]);
  });
  it('rejects oversize/malformed uploads and returns a static formula-safe authenticated template', async () => {
    const bank = await makeBank();
    expect(
      (
        await mutate(`/question-banks/${bank.id}/import/preview`, {
          csv: 'a'.repeat(1024 * 1024 + 1),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate(`/question-banks/${bank.id}/import/preview`, {
          csv: headers.join(',') + '\n"broken',
        })
      ).status,
    ).toBe(400);
    const template = await get('/question-banks/csv-template');
    expect(template.status).toBe(200);
    expect(template.headers['content-type']).toContain('text/csv');
    expect(template.headers['content-disposition']).toContain(
      'question-template.csv',
    );
    expect(
      (await get(`/question-banks/${bank.id}/questions?difficulty=bad`)).status,
    ).toBe(400);
  });
  it('copies bank selections into practice quizzes and preserves published history after bank edits and archiving', async () => {
    const bank = await makeBank();
    const q = await banks.add(student.id, bank.id, question);
    const selected = await banks.select(student.id, [q.id]);
    const quiz = await quizzes.create(student.id, {
      title: 'Practice snapshot',
      description: '',
      timeLimitSeconds: null,
      questions: selected.questions as [typeof question],
    });
    await quizzes.publish(student.id, quiz.id, 0);
    await banks.edit(student.id, bank.id, q.id, {
      ...question,
      correctOption: 1,
      prompt: 'Changed bank text',
      revision: 0,
    });
    await banks.archive(student.id, bank.id, 0);
    const stored = await db.quiz.findUniqueOrThrow({
      where: { id: quiz.id },
      include: { questions: { include: { options: true } } },
    });
    expect(stored.questions[0]?.prompt).toBe(question.prompt);
    expect(stored.questions[0]?.options.find((o) => o.isCorrect)?.text).toBe(
      '2',
    );
    await expect(
      quizzes.update(student.id, quiz.id, {
        title: 'Illegal',
        description: '',
        timeLimitSeconds: null,
        questions: [],
        revision: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const engine = createAttemptEngine(db);
    const attempt = await engine.start(student.id, quiz.id);
    expect(JSON.stringify(attempt)).not.toMatch(
      /correctOption|isCorrect|explanation/,
    );
    await engine.save(student.id, attempt.id, attempt.questions[0]!.id, {
      selectedOptionId: attempt.questions[0]!.options[0]!.id,
      revision: 0,
    });
    await engine.submit(student.id, attempt.id);
    expect((await engine.result(student.id, attempt.id)).percentage).toBe(100);
    const copy = await quizzes.duplicate(student.id, quiz.id);
    expect(copy.status).toBe('DRAFT');
    expect(copy.questions[0]?.prompt).toBe(question.prompt);
    expect(await db.attempt.count({ where: { quizId: copy.id } })).toBe(0);
  });
  it('uses the same selection and duplication for verified lecturer assessment drafts', async () => {
    const c = await createCourseService(db).create(lecturer.id, {
      title: 'Numbers',
      code: ('NUM-' + randomUUID().slice(0, 8)).toUpperCase(),
      description: '',
    });
    const bank = await makeBank(lecturer.id);
    const q = await banks.add(lecturer.id, bank.id, question);
    const selected = await banks.select(lecturer.id, [q.id]);
    const service = createQuizService(db, c.id);
    const quiz = await service.create(lecturer.id, {
      title: 'Assessment snapshot',
      description: '',
      timeLimitSeconds: null,
      questions: selected.questions as [typeof question],
      closesAt: new Date(Date.now() + 3600000).toISOString(),
    });
    await service.publish(lecturer.id, quiz.id, 0);
    await banks.archiveQuestion(lecturer.id, bank.id, q.id, 0);
    const res = await mutate(
      `/courses/${c.id}/assessments/${quiz.id}/duplicate`,
      {},
      lecturer,
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.closesAt).toBeNull();
    expect(res.body.questions[0].prompt).toBe(question.prompt);
    expect(
      (
        await mutate(
          `/courses/${c.id}/assessments/${quiz.id}/duplicate`,
          {},
          student,
        )
      ).status,
    ).toBe(403);
    expect(
      (await mutate(`/quizzes/${quiz.id}/duplicate`, {}, other)).status,
    ).toBe(404);
  });
  it('enforces capacity including archived questions and rejects atomic imports without partial writes', async () => {
    const bank = await makeBank();
    await db.question.createMany({
      data: Array.from({ length: 1000 }, () => ({
        ...question,
        bankId: bank.id,
        archivedAt: new Date(),
      })),
    });
    const csv = csvTemplate();
    const preview = await banks.preview(student.id, bank.id, csv);
    await expect(
      banks.confirm(student.id, bank.id, {
        csv,
        token: preview.token,
        confirmed: true,
        skipInvalid: false,
      }),
    ).rejects.toMatchObject({ code: 'BANK_FULL' });
    expect(await db.question.count({ where: { bankId: bank.id } })).toBe(1000);
    expect(
      await db.csvImportReceipt.count({ where: { bankId: bank.id } }),
    ).toBe(0);
  });
});
