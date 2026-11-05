import type { Prisma } from '../../generated/prisma/client.js';
import type { QuizInput } from './validation.js';

export const questionInclude = {
  orderBy: { position: 'asc' },
  include: { options: { orderBy: { position: 'asc' } } },
} as const;
export const quizInclude = {
  questions: questionInclude,
  challenge: true,
} as const;
export type FullQuiz = Prisma.QuizGetPayload<{ include: typeof quizInclude }>;
export type Tx = Prisma.TransactionClient;

export function questionData(questions: QuizInput['questions']) {
  return questions.map((question, position) => ({
    position,
    prompt: question.prompt,
    explanation: question.explanation,
    options: {
      create: question.options.map((text, index) => ({
        position: index,
        text,
        isCorrect: index === question.correctOption,
      })),
    },
  }));
}

export function quizSummary(
  quiz: Omit<FullQuiz, 'questions' | 'challenge'> & {
    questions: { id: string }[];
    challenge?: FullQuiz['challenge'];
  },
) {
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    mode: quiz.mode,
    status: quiz.status,
    revision: quiz.revision,
    timeLimitSeconds: quiz.timeLimitSeconds,
    questionCount: quiz.questions.length,
    createdAt: quiz.createdAt.toISOString(),
    publishedAt: quiz.publishedAt?.toISOString() ?? null,
    courseId: quiz.courseId,
    opensAt: quiz.opensAt?.toISOString() ?? null,
    closesAt:
      (quiz.mode === 'CHALLENGE'
        ? quiz.challenge?.closesAt
        : quiz.closesAt
      )?.toISOString() ?? null,
    closedAt:
      (quiz.mode === 'CHALLENGE'
        ? quiz.challenge?.closedAt
        : quiz.closedAt
      )?.toISOString() ?? null,
    maxAttempts: quiz.maxAttempts,
  };
}

export function authorQuiz(quiz: FullQuiz) {
  return {
    ...quizSummary(quiz),
    questions: quiz.questions.map((question) => ({
      prompt: question.prompt,
      explanation: question.explanation,
      options: question.options.map((option) => option.text),
      correctOption: question.options.findIndex((option) => option.isCorrect),
    })),
  };
}

export async function lock(tx: Tx, key: string) {
  // Transaction-scoped PostgreSQL lock, independent of the configured schema.
  // PostgreSQL UUIDs are case-insensitive; textual lock keys must identify the
  // same row even when a caller sends an uppercase UUID.
  const canonical = key.replace(
    /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    (id) => id.toLowerCase(),
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonical}, 0))::text`;
}

export async function databaseNow(tx: Tx) {
  const [row] = await tx.$queryRaw<
    { milliseconds: string }[]
  >`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS milliseconds`;
  // Numeric epoch avoids driver timezone conversion of raw timestamptz values.
  return new Date(Number(row!.milliseconds));
}
