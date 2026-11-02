import { z } from 'zod';

export const idSchema = z.uuid();
const option = z.string().trim().min(1, 'Every option needs text.').max(500);
export const questionSchema = z
  .object({
    prompt: z.string().trim().min(1, 'Enter a question.').max(2000),
    options: z
      .tuple([option, option, option, option])
      .refine(
        (values) =>
          new Set(values.map((value) => value.toLowerCase())).size === 4,
        'Use four different options.',
      ),
    correctOption: z.number().int().min(0).max(3),
    explanation: z.string().trim().max(2000).default(''),
  })
  .strict();

export const quizSchema = z
  .object({
    title: z.string().trim().min(1, 'Give your quiz a title.').max(150),
    description: z.string().trim().max(2000).default(''),
    timeLimitSeconds: z
      .number()
      .int()
      .min(60)
      .max(10800)
      .nullable()
      .default(null),
    questions: z.array(questionSchema).max(50).default([]),
  })
  .strict();
export const updateQuizSchema = quizSchema.extend({
  revision: z.number().int().nonnegative(),
});
export const publishSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const answerSchema = z
  .object({
    selectedOptionId: z.uuid().nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const emptySchema = z.object({}).strict();
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type QuizInput = z.infer<typeof quizSchema>;
