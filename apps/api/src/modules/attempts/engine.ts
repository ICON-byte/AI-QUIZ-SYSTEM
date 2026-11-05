import type { Prisma } from '../../generated/prisma/client.js';
import type { Database } from '../../infrastructure/database.js';
import { HttpError } from '../../middleware/errors.js';
import {
  databaseNow,
  lock,
  questionData,
  quizInclude,
  quizSummary,
  type Tx,
} from '../quizzes/data.js';
import { quizMissing } from '../quizzes/service.js';
import { challengeCutoff } from '../challenges/access.js';
import { requireEnrollment } from '../courses/access.js';

const attemptInclude = {
  quiz: { include: { ...quizInclude, course: true } },
  answers: true,
} as const;
type FullAttempt = Prisma.AttemptGetPayload<{ include: typeof attemptInclude }>;
const missing = () =>
  new HttpError(404, 'ATTEMPT_NOT_FOUND', 'This attempt was not found.');

type EngineQuiz = FullAttempt['quiz'];
async function assertEligible(
  tx: Tx,
  quiz: EngineQuiz,
  userId: string,
  starting = false,
) {
  if (quiz.status !== 'PUBLISHED') throw quizMissing();
  if (quiz.mode === 'PRACTICE') {
    if (quiz.ownerId !== userId) throw quizMissing();
    return;
  }
  if (quiz.mode === 'CHALLENGE') {
    if (
      !quiz.challenge ||
      quiz.ownerId === userId ||
      !(await tx.challengeParticipant.findUnique({
        where: { quizId_studentId: { quizId: quiz.id, studentId: userId } },
      }))
    )
      throw quizMissing();
    const cutoff = challengeCutoff(quiz.challenge);
    if (starting && cutoff && cutoff <= (await databaseNow(tx)))
      throw new HttpError(403, 'CHALLENGE_CLOSED', 'This challenge is closed.');
    return;
  }
  if (quiz.mode !== 'ASSESSMENT' || !quiz.course) throw quizMissing();
  await requireEnrollment(tx, quiz.course.id, userId);
  if (starting) {
    const now = await databaseNow(tx);
    const owner = await tx.user.findUnique({
      where: { id: quiz.course.ownerId },
      include: { verification: true },
    });
    if (
      quiz.course.archivedAt ||
      quiz.closedAt ||
      !quiz.closesAt ||
      now >= quiz.closesAt ||
      (quiz.opensAt && now < quiz.opensAt) ||
      owner?.status !== 'ACTIVE' ||
      owner.verification?.status !== 'APPROVED'
    )
      throw new HttpError(
        403,
        'ASSESSMENT_UNAVAILABLE',
        'This assessment is not open for new attempts.',
      );
  }
}

function effectiveDeadline(attempt: FullAttempt) {
  const deadlines = [attempt.expiresAt];
  if (attempt.quiz.mode === 'CHALLENGE')
    deadlines.push(challengeCutoff(attempt.quiz.challenge));
  if (attempt.quiz.mode === 'ASSESSMENT')
    deadlines.push(
      attempt.quiz.closesAt,
      attempt.quiz.closedAt,
      attempt.quiz.course?.archivedAt ?? null,
    );
  const values = deadlines.filter((value): value is Date => value !== null);
  return values.length
    ? new Date(Math.min(...values.map((value) => value.getTime())))
    : null;
}

function attemptDto(attempt: FullAttempt, now: Date) {
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    mode: attempt.quiz.mode,
    courseId: attempt.quiz.courseId,
    title: attempt.quiz.title,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt.toISOString(),
    expiresAt: effectiveDeadline(attempt)?.toISOString() ?? null,
    serverNow: now.toISOString(),
    questions: attempt.quiz.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options.map((option) => ({
        id: option.id,
        text: option.text,
      })),
    })),
    answers: attempt.answers.map((answer) => ({
      questionId: answer.questionId,
      selectedOptionId: answer.selectedOptionId,
      revision: answer.revision,
    })),
  };
}

async function ownedAttempt(tx: Tx, id: string, userId: string) {
  const context = await tx.attempt.findFirst({
    where: { id, userId },
    select: { quizId: true, quiz: { select: { courseId: true } } },
  });
  if (!context) throw missing();
  if (context.quiz.courseId) await lock(tx, `course:${context.quiz.courseId}`);
  await lock(tx, `quiz:${context.quizId}`);
  await lock(tx, `attempt:${id}`);
  const attempt = await tx.attempt.findFirst({
    where: { id, userId },
    include: attemptInclude,
  });
  if (!attempt) throw missing();
  await assertEligible(tx, attempt.quiz, userId);
  return attempt;
}

async function finalize(
  tx: Tx,
  attempt: FullAttempt,
  now: Date,
  submit = false,
): Promise<FullAttempt> {
  if (attempt.status !== 'IN_PROGRESS') return attempt;
  const deadline = effectiveDeadline(attempt);
  const expired = deadline !== null && deadline <= now;
  if (!expired && !submit) return attempt;
  const selected = new Map(
    attempt.answers.map((answer) => [
      answer.questionId,
      answer.selectedOptionId,
    ]),
  );
  const score = attempt.quiz.questions.filter((question) =>
    question.options.some(
      (option) => option.isCorrect && option.id === selected.get(question.id),
    ),
  ).length;
  const finalizedAt = expired ? deadline! : now;
  return tx.attempt.update({
    where: { id: attempt.id },
    data: {
      status: expired ? 'EXPIRED' : 'SUBMITTED',
      expiresAt: deadline,
      finalizedAt,
      score,
      durationSeconds: Math.max(
        0,
        Math.floor(
          (finalizedAt.getTime() - attempt.startedAt.getTime()) / 1000,
        ),
      ),
    },
    include: attemptInclude,
  });
}

export function createAttemptEngine(db: Database) {
  return {
    async start(userId: string, quizId: string) {
      return db.$transaction(async (tx) => {
        const context = await tx.quiz.findUnique({
          where: { id: quizId },
          select: { courseId: true },
        });
        if (context?.courseId) await lock(tx, `course:${context.courseId}`);
        await lock(tx, `quiz:${quizId}`);
        const quiz = await tx.quiz.findUnique({
          where: { id: quizId },
          include: { ...quizInclude, course: true },
        });
        if (!quiz) throw quizMissing();
        await assertEligible(tx, quiz, userId);
        const active = await tx.attempt.findFirst({
          where: {
            quizId,
            userId,
            ...(quiz.mode === 'CHALLENGE'
              ? {}
              : { status: 'IN_PROGRESS' as const }),
          },
        });
        if (active) {
          const attempt = await ownedAttempt(tx, active.id, userId);
          const now = await databaseNow(tx);
          // Return even an expired prior attempt. A second explicit start creates a retake.
          return attemptDto(await finalize(tx, attempt, now), now);
        }
        await assertEligible(tx, quiz, userId, true);
        const now = await databaseNow(tx);
        const aggregate = await tx.attempt.aggregate({
          where: { quizId, userId },
          _max: { attemptNumber: true },
        });
        if (
          quiz.mode === 'ASSESSMENT' &&
          (aggregate._max.attemptNumber ?? 0) >= quiz.maxAttempts
        )
          throw new HttpError(
            403,
            'ATTEMPT_LIMIT',
            'You have used all attempts for this assessment.',
          );
        const timerDeadline =
          quiz.timeLimitSeconds === null
            ? null
            : new Date(now.getTime() + quiz.timeLimitSeconds * 1000);
        const scheduledClose =
          quiz.mode === 'CHALLENGE' ? quiz.challenge?.closesAt : quiz.closesAt;
        const deadline =
          (quiz.mode === 'ASSESSMENT' || quiz.mode === 'CHALLENGE') &&
          scheduledClose
            ? new Date(
                Math.min(
                  timerDeadline?.getTime() ?? Infinity,
                  scheduledClose.getTime(),
                ),
              )
            : timerDeadline;
        const attempt = await tx.attempt.create({
          data: {
            userId,
            quizId,
            attemptNumber: (aggregate._max.attemptNumber ?? 0) + 1,
            startedAt: now,
            expiresAt: deadline,
            totalQuestions: quiz.questions.length,
          },
          include: attemptInclude,
        });
        return attemptDto(attempt, now);
      });
    },
    async get(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        const attempt = await ownedAttempt(tx, id, userId);
        const now = await databaseNow(tx);
        return attemptDto(await finalize(tx, attempt, now), now);
      });
    },
    async save(
      userId: string,
      id: string,
      questionId: string,
      input: { selectedOptionId: string | null; revision: number },
    ) {
      const result = await db
        .$transaction(async (tx) => {
          let attempt = await ownedAttempt(tx, id, userId);
          const now = await databaseNow(tx);
          attempt = await finalize(tx, attempt, now);
          if (attempt.status !== 'IN_PROGRESS')
            return { closed: true as const };
          const question = attempt.quiz.questions.find(
            (item) => item.id === questionId,
          );
          if (
            !question ||
            (input.selectedOptionId !== null &&
              !question.options.some(
                (option) => option.id === input.selectedOptionId,
              ))
          ) {
            throw new HttpError(
              400,
              'INVALID_ANSWER',
              'Select an option belonging to this question.',
            );
          }
          const previous = attempt.answers.find(
            (answer) => answer.questionId === questionId,
          );
          const revision = previous?.revision ?? 0;
          if (revision !== input.revision) {
            // A lost success response can safely retry the same intended selection.
            if (
              revision === input.revision + 1 &&
              previous?.selectedOptionId === input.selectedOptionId
            )
              return { answer: previous };
            throw new HttpError(
              409,
              'ANSWER_CHANGED',
              'This answer changed in another tab. Reload the attempt before answering again.',
            );
          }
          const answer = await tx.attemptAnswer.upsert({
            where: { attemptId_questionId: { attemptId: id, questionId } },
            create: {
              attemptId: id,
              quizId: attempt.quizId,
              questionId,
              selectedOptionId: input.selectedOptionId,
              revision: 1,
              savedAt: now,
            },
            update: {
              selectedOptionId: input.selectedOptionId,
              revision: revision + 1,
              savedAt: now,
            },
          });
          return { answer };
        })
        .catch(async (error: unknown) => {
          if (error instanceof HttpError) throw error;
          // The deadline can cross between the clock check and the answer trigger.
          // Finalize in a fresh transaction after the rejected write rolled back.
          const current = await db.attempt.findFirst({
            where: { id, userId },
            select: { status: true, expiresAt: true },
          });
          if (
            current &&
            (current.status !== 'IN_PROGRESS' ||
              (current.expiresAt &&
                current.expiresAt <= (await databaseNow(db))))
          ) {
            await this.get(userId, id);
            return { closed: true as const };
          }
          throw error;
        });
      // Preserve expiration finalization even though the attempted save is rejected.
      if ('closed' in result)
        throw new HttpError(
          409,
          'ATTEMPT_CLOSED',
          'This attempt has ended. View your results.',
        );
      return {
        questionId: result.answer.questionId,
        selectedOptionId: result.answer.selectedOptionId,
        revision: result.answer.revision,
      };
    },
    async submit(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        const attempt = await ownedAttempt(tx, id, userId);
        const now = await databaseNow(tx);
        return attemptDto(await finalize(tx, attempt, now, true), now);
      });
    },
    async result(userId: string, id: string) {
      const result = await db.$transaction(async (tx) => {
        const original = await ownedAttempt(tx, id, userId);
        const now = await databaseNow(tx);
        const attempt = await finalize(tx, original, now);
        if (attempt.status === 'IN_PROGRESS') return null;
        const selections = new Map(
          attempt.answers.map((answer) => [
            answer.questionId,
            answer.selectedOptionId,
          ]),
        );
        const reviewAvailable =
          attempt.quiz.mode === 'PRACTICE' ||
          (attempt.quiz.mode === 'CHALLENGE' &&
            !!challengeCutoff(attempt.quiz.challenge) &&
            challengeCutoff(attempt.quiz.challenge)! <= now) ||
          !!attempt.quiz.closedAt ||
          !!attempt.quiz.course?.archivedAt ||
          !!(attempt.quiz.closesAt && attempt.quiz.closesAt <= now);
        return {
          mode: attempt.quiz.mode,
          courseId: attempt.quiz.courseId,
          reviewAvailable,
          reviewReleaseAt:
            (attempt.quiz.mode === 'CHALLENGE'
              ? challengeCutoff(attempt.quiz.challenge)
              : attempt.quiz.closesAt
            )?.toISOString() ?? null,
          id: attempt.id,
          quizId: attempt.quizId,
          title: attempt.quiz.title,
          status: attempt.status,
          attemptNumber: attempt.attemptNumber,
          totalQuestions: attempt.totalQuestions,
          correctAnswers: attempt.score!,
          incorrectAnswers: attempt.totalQuestions - attempt.score!,
          percentage:
            Math.round((attempt.score! / attempt.totalQuestions) * 10000) / 100,
          durationSeconds: attempt.durationSeconds!,
          finalizedAt: attempt.finalizedAt!.toISOString(),
          questions: reviewAvailable
            ? attempt.quiz.questions.map((question) => ({
                id: question.id,
                prompt: question.prompt,
                explanation: question.explanation,
                selectedOptionId: selections.get(question.id) ?? null,
                correctOptionId: question.options.find(
                  (option) => option.isCorrect,
                )!.id,
                options: question.options.map((option) => ({
                  id: option.id,
                  text: option.text,
                })),
              }))
            : [],
        };
      });
      if (!result)
        throw new HttpError(
          403,
          'RESULT_NOT_READY',
          'Submit this attempt before reviewing answers.',
        );
      return result;
    },
    async history(userId: string, page: number) {
      // Expired attempts are finalized on history access too, even after a server restart.
      await this.expire(userId);
      const where = {
        userId,
        status: { not: 'IN_PROGRESS' as const },
        quiz: { mode: 'PRACTICE' as const, ownerId: userId },
      };
      const [attempts, total] = await db.$transaction([
        db.attempt.findMany({
          where,
          include: { quiz: { select: { title: true } } },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * 20,
          take: 20,
        }),
        db.attempt.count({ where }),
      ]);
      return {
        total,
        page,
        pageSize: 20,
        attempts: attempts.map((attempt) => ({
          id: attempt.id,
          quizId: attempt.quizId,
          title: attempt.quiz.title,
          status: attempt.status,
          attemptNumber: attempt.attemptNumber,
          score: attempt.score,
          totalQuestions: attempt.totalQuestions,
          durationSeconds: attempt.durationSeconds,
          finalizedAt: attempt.finalizedAt!.toISOString(),
        })),
      };
    },
    async retryIncorrect(userId: string, id: string) {
      const result = await this.result(userId, id);
      if (result.mode !== 'PRACTICE')
        throw new HttpError(
          403,
          'PRACTICE_ONLY',
          'Only personal practice can be copied into a retry quiz.',
        );
      const incorrect = result.questions.filter(
        (question) => question.selectedOptionId !== question.correctOptionId,
      );
      if (!incorrect.length)
        throw new HttpError(
          400,
          'NO_INCORRECT_QUESTIONS',
          'You answered every question correctly.',
        );
      const quiz = await db.quiz.create({
        data: {
          ownerId: userId,
          title: `Retry: ${result.title}`.slice(0, 150),
          description: 'Practice the questions you missed.',
          questions: {
            create: questionData(
              incorrect.map((question) => ({
                prompt: question.prompt,
                explanation: question.explanation,
                options: question.options.map((option) => option.text) as [
                  string,
                  string,
                  string,
                  string,
                ],
                correctOption: question.options.findIndex(
                  (option) => option.id === question.correctOptionId,
                ),
              })),
            ),
          },
        },
        include: quizInclude,
      });
      return quizSummary(quiz);
    },
    async expire(userId?: string, quizId?: string, drain = true) {
      const now = await databaseNow(db);
      const candidates = await db.attempt.findMany({
        where: {
          status: 'IN_PROGRESS',
          OR: [
            {
              quiz: {
                mode: 'CHALLENGE',
                challenge: {
                  OR: [{ closedAt: { lte: now } }, { closesAt: { lte: now } }],
                },
              },
            },
            { expiresAt: { lte: now } },
            {
              quiz: {
                mode: 'ASSESSMENT',
                OR: [
                  { closedAt: { lte: now } },
                  { closesAt: { lte: now } },
                  { course: { archivedAt: { lte: now } } },
                ],
              },
            },
          ],
          ...(userId ? { userId } : {}),
          ...(quizId ? { quizId } : {}),
          quiz: { mode: { in: ['PRACTICE', 'ASSESSMENT', 'CHALLENGE'] } },
        },
        select: { id: true },
        take: 100,
      });
      for (const candidate of candidates) {
        await db.$transaction(async (tx) => {
          const context = await tx.attempt.findUnique({
            where: { id: candidate.id },
            select: { quizId: true, quiz: { select: { courseId: true } } },
          });
          if (!context) return;
          if (context.quiz.courseId)
            await lock(tx, `course:${context.quiz.courseId}`);
          await lock(tx, `quiz:${context.quizId}`);
          await lock(tx, `attempt:${candidate.id}`);
          const attempt = await tx.attempt.findUnique({
            where: { id: candidate.id },
            include: attemptInclude,
          });
          if (attempt) await finalize(tx, attempt, await databaseNow(tx));
        });
      }
      if (drain && quizId && candidates.length === 100)
        await this.expire(userId, quizId);
    },
  };
}
