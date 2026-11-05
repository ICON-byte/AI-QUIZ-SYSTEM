import type { Database } from '../../infrastructure/database.js';
import { HttpError } from '../../middleware/errors.js';
import {
  authorQuiz,
  lock,
  questionData,
  quizInclude,
  quizSummary,
  databaseNow,
} from './data.js';
import type { QuizInput } from './validation.js';
import { ownedCourse } from '../courses/access.js';

export const quizMissing = () =>
  new HttpError(404, 'QUIZ_NOT_FOUND', 'This practice quiz was not found.');
export const immutableQuiz = () =>
  new HttpError(409, 'QUIZ_PUBLISHED', 'Published quizzes cannot be edited.');

type Settings = {
  opensAt?: string | null;
  closesAt?: string | null;
  maxAttempts?: number;
};
export function createQuizService(db: Database, courseId?: string) {
  const mode = courseId ? ('ASSESSMENT' as const) : ('PRACTICE' as const);
  const scope = courseId ? { courseId } : {};
  const settings = (input: Settings) =>
    courseId
      ? {
          opensAt: input.opensAt ? new Date(input.opensAt) : null,
          closesAt: input.closesAt ? new Date(input.closesAt) : null,
          maxAttempts: input.maxAttempts ?? 1,
        }
      : {};
  return {
    async list(userId: string, page: number) {
      if (courseId)
        await db.$transaction((tx) => ownedCourse(tx, courseId, userId));
      const where = { ownerId: userId, mode, ...scope };
      const [quizzes, total] = await db.$transaction([
        db.quiz.findMany({
          where,
          include: { questions: { select: { id: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * 20,
          take: 20,
        }),
        db.quiz.count({ where }),
      ]);
      return { quizzes: quizzes.map(quizSummary), total, page, pageSize: 20 };
    },
    async create(userId: string, input: QuizInput & Settings) {
      const quiz = await db.$transaction(async (tx) => {
        if (courseId) await ownedCourse(tx, courseId, userId, true);
        return tx.quiz.create({
          data: {
            mode,
            ...scope,
            ...settings(input),
            ownerId: userId,
            title: input.title,
            description: input.description,
            timeLimitSeconds: input.timeLimitSeconds,
            questions: { create: questionData(input.questions) },
          },
          include: quizInclude,
        });
      });
      return authorQuiz(quiz);
    },
    async get(userId: string, id: string, edit = false) {
      if (courseId)
        await db.$transaction((tx) => ownedCourse(tx, courseId, userId, edit));
      const quiz = await db.quiz.findFirst({
        where: { id, ownerId: userId, mode, ...scope },
        include: quizInclude,
      });
      if (!quiz) throw quizMissing();
      if (edit) {
        if (quiz.status !== 'DRAFT') throw immutableQuiz();
        return authorQuiz(quiz);
      }
      return quizSummary(quiz);
    },
    async update(
      userId: string,
      id: string,
      input: QuizInput & Settings & { revision: number },
    ) {
      return db.$transaction(async (tx) => {
        if (courseId) await ownedCourse(tx, courseId, userId, true);
        await lock(tx, `quiz:${id}`);
        const quiz = await tx.quiz.findFirst({
          where: { id, ownerId: userId, mode, ...scope },
        });
        if (!quiz) throw quizMissing();
        if (quiz.status !== 'DRAFT') throw immutableQuiz();
        if (quiz.revision !== input.revision)
          throw new HttpError(
            409,
            'DRAFT_CHANGED',
            'This draft changed in another tab. Reload it before saving.',
          );
        await tx.quizQuestion.deleteMany({ where: { quizId: id } });
        return authorQuiz(
          await tx.quiz.update({
            where: { id },
            data: {
              ...settings(input),
              title: input.title,
              description: input.description,
              timeLimitSeconds: input.timeLimitSeconds,
              revision: { increment: 1 },
              questions: { create: questionData(input.questions) },
            },
            include: quizInclude,
          }),
        );
      });
    },
    async publish(userId: string, id: string, revision: number) {
      return db.$transaction(async (tx) => {
        if (courseId) await ownedCourse(tx, courseId, userId, true);
        await lock(tx, `quiz:${id}`);
        const quiz = await tx.quiz.findFirst({
          where: { id, ownerId: userId, mode, ...scope },
          include: quizInclude,
        });
        if (!quiz) throw quizMissing();
        if (quiz.status === 'PUBLISHED') return quizSummary(quiz);
        const now = await databaseNow(tx);
        if (
          courseId &&
          (!quiz.closesAt ||
            quiz.closesAt <= now ||
            (quiz.opensAt && quiz.opensAt >= quiz.closesAt))
        )
          throw new HttpError(
            400,
            'INVALID_SCHEDULE',
            'Choose a future closing date after the opening date before publishing.',
          );
        if (quiz.revision !== revision)
          throw new HttpError(
            409,
            'DRAFT_CHANGED',
            'This draft changed. Reload before publishing.',
          );
        if (!quiz.questions.length)
          throw new HttpError(
            400,
            'EMPTY_QUIZ',
            'Add at least one question before publishing.',
          );
        if (
          quiz.questions.some(
            (question) =>
              question.options.length !== 4 ||
              question.options.filter((option) => option.isCorrect).length !==
                1,
          )
        ) {
          throw new HttpError(
            400,
            'INVALID_QUESTIONS',
            'Each question needs four options and one correct answer.',
          );
        }
        return quizSummary(
          await tx.quiz.update({
            where: { id },
            data: {
              status: 'PUBLISHED',
              publishedAt: now,
              revision: { increment: 1 },
            },
            include: quizInclude,
          }),
        );
      });
    },
    async duplicate(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        if (courseId) await ownedCourse(tx, courseId, userId, true);
        await lock(tx, `quiz:${id}`);
        const source = await tx.quiz.findFirst({ where: { id, ownerId: userId, mode, ...scope }, include: quizInclude });
        if (!source) throw quizMissing();
        return authorQuiz(await tx.quiz.create({
          data: {
            ownerId: userId, mode, ...scope, title: `${source.title.slice(0, 143)} (copy)`,
            description: source.description, timeLimitSeconds: source.timeLimitSeconds,
            // Copies need a newly chosen assessment schedule before publishing.
            maxAttempts: source.maxAttempts,
            questions: { create: questionData(authorQuiz(source).questions as QuizInput['questions']) },
          }, include: quizInclude,
        }));
      });
    },
  };
}
