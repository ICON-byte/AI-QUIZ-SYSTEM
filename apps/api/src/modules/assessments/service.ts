import type { Database } from '../../infrastructure/database.js';
import {
  databaseNow,
  lock,
  quizInclude,
  quizSummary,
} from '../quizzes/data.js';
import {
  ownedCourse,
  requireEnrollment,
  courseMissing,
} from '../courses/access.js';
import { createAttemptEngine } from '../attempts/engine.js';

export function createAssessmentService(db: Database) {
  return {
    async list(userId: string, role: string, courseId: string, page: number) {
      return db.$transaction(async (tx) => {
        await lock(tx, `course:${courseId}`);
        if (role === 'LECTURER') await ownedCourse(tx, courseId, userId);
        else await requireEnrollment(tx, courseId, userId);
        const where = {
          courseId,
          mode: 'ASSESSMENT' as const,
          ...(role === 'STUDENT' ? { status: 'PUBLISHED' as const } : {}),
        };
        const rows = await tx.quiz.findMany({
          where,
          include: { questions: { select: { id: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * 20,
          take: 20,
        });
        const total = await tx.quiz.count({ where });
        return {
          assessments: rows.map(quizSummary),
          total,
          page,
          pageSize: 20,
          serverNow: (await databaseNow(tx)).toISOString(),
        };
      });
    },
    async instructions(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        const found = await tx.quiz.findUnique({
          where: { id },
          select: { courseId: true },
        });
        if (!found?.courseId) throw courseMissing();
        await lock(tx, `course:${found.courseId}`);
        await requireEnrollment(tx, found.courseId, userId);
        const quiz = await tx.quiz.findFirst({
          where: { id, mode: 'ASSESSMENT', status: 'PUBLISHED' },
          include: { ...quizInclude, course: true },
        });
        if (!quiz) throw courseMissing();
        const attempts = await tx.attempt.findMany({
          where: { quizId: id, userId },
          select: { id: true, status: true, attemptNumber: true },
          orderBy: { attemptNumber: 'desc' },
        });
        return {
          ...quizSummary(quiz),
          courseArchived: !!quiz.course?.archivedAt,
          attempts,
          serverNow: (await databaseNow(tx)).toISOString(),
        };
      });
    },
    async close(lecturerId: string, courseId: string, id: string) {
      const result = await db.$transaction(async (tx) => {
        await ownedCourse(tx, courseId, lecturerId);
        await lock(tx, `quiz:${id}`);
        const quiz = await tx.quiz.findFirst({
          where: { id, courseId, mode: 'ASSESSMENT', status: 'PUBLISHED' },
        });
        if (!quiz) throw courseMissing();
        if (!quiz.closedAt)
          await tx.quiz.update({
            where: { id },
            data: { closedAt: await databaseNow(tx) },
          });
        return { closed: true };
      });
      await createAttemptEngine(db).expire(undefined, id);
      return result;
    },
    async report(lecturerId: string, courseId: string, id: string) {
      await db.$transaction((tx) => ownedCourse(tx, courseId, lecturerId));
      await createAttemptEngine(db).expire(undefined, id);
      return db.$transaction(async (tx) => {
        await ownedCourse(tx, courseId, lecturerId);
        await lock(tx, `quiz:${id}`);
        const quiz = await tx.quiz.findFirst({
          where: { id, courseId, mode: 'ASSESSMENT' },
          include: quizInclude,
        });
        if (!quiz) throw courseMissing();
        const totalEnrolled = await tx.enrollment.count({
          where: { courseId, status: 'ACTIVE' },
        });
        const attempts = await tx.attempt.findMany({
          where: { quizId: id },
          include: {
            user: { select: { id: true, displayName: true, email: true } },
            answers: true,
          },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        });
        const finalized = attempts.filter(
          (attempt) => attempt.status !== 'IN_PROGRESS',
        );
        const scores = finalized.map((attempt) => attempt.score!);
        const percentages = scores.map(
          (score) => (score / quiz.questions.length) * 100,
        );
        const round = (value: number) => Math.round(value * 100) / 100;
        return {
          quiz: quizSummary(quiz),
          totalEnrolled,
          studentsAttempted: new Set(attempts.map((attempt) => attempt.userId))
            .size,
          finalizedAttempts: finalized.length,
          averagePercentage: percentages.length
            ? round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
            : null,
          highestPercentage: percentages.length
            ? round(Math.max(...percentages))
            : null,
          lowestPercentage: percentages.length
            ? round(Math.min(...percentages))
            : null,
          attempts: attempts.map((attempt) => ({
            id: attempt.id,
            student: attempt.user,
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            score: attempt.score,
            totalQuestions: attempt.totalQuestions,
            submittedAt: attempt.finalizedAt?.toISOString() ?? null,
          })),
          questions: quiz.questions.map((question) => ({
            id: question.id,
            prompt: question.prompt,
            correctCount: finalized.filter((attempt) =>
              attempt.answers.some(
                (answer) =>
                  answer.questionId === question.id &&
                  question.options.some(
                    (option) =>
                      option.isCorrect && option.id === answer.selectedOptionId,
                  ),
              ),
            ).length,
            totalGraded: finalized.length,
          })),
        };
      });
    },
  };
}
