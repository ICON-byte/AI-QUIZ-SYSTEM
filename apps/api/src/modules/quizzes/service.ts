import type { Database } from '../../infrastructure/database.js';
import { HttpError } from '../../middleware/errors.js';
import {
  authorQuiz,
  lock,
  questionData,
  quizInclude,
  quizSummary,
} from './data.js';
import type { QuizInput } from './validation.js';

export const quizMissing = () =>
  new HttpError(404, 'QUIZ_NOT_FOUND', 'This practice quiz was not found.');
export const immutableQuiz = () =>
  new HttpError(409, 'QUIZ_PUBLISHED', 'Published quizzes cannot be edited.');

export function createQuizService(db: Database) {
  return {
    async list(userId: string, page: number) {
      const where = { ownerId: userId, mode: 'PRACTICE' as const };
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
    async create(userId: string, input: QuizInput) {
      const quiz = await db.quiz.create({
        data: {
          ownerId: userId,
          title: input.title,
          description: input.description,
          timeLimitSeconds: input.timeLimitSeconds,
          questions: { create: questionData(input.questions) },
        },
        include: quizInclude,
      });
      return authorQuiz(quiz);
    },
    async get(userId: string, id: string, edit = false) {
      const quiz = await db.quiz.findFirst({
        where: { id, ownerId: userId, mode: 'PRACTICE' },
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
      input: QuizInput & { revision: number },
    ) {
      return db.$transaction(async (tx) => {
        await lock(tx, `quiz:${id}`);
        const quiz = await tx.quiz.findFirst({
          where: { id, ownerId: userId, mode: 'PRACTICE' },
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
        await lock(tx, `quiz:${id}`);
        const quiz = await tx.quiz.findFirst({
          where: { id, ownerId: userId, mode: 'PRACTICE' },
          include: quizInclude,
        });
        if (!quiz) throw quizMissing();
        if (quiz.status === 'PUBLISHED') return quizSummary(quiz);
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
              publishedAt: new Date(),
              revision: { increment: 1 },
            },
            include: quizInclude,
          }),
        );
      });
    },
  };
}
