import { z } from 'zod';
import { questionSchema, pageSchema } from '../quizzes/validation.js';

export const MAX_BANK_QUESTIONS = 1000;
export const difficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD']);
export const bankQuestionSchema = questionSchema.extend({
  difficulty: difficultySchema.default('MEDIUM'),
  topic: z.string().trim().max(100).default(''),
});
export const revisionSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const bankSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    description: z.string().trim().max(2000).default(''),
    courseId: z.uuid().nullable().default(null),
  })
  .strict();
export const bankUpdateSchema = bankSchema.extend(revisionSchema.shape);
export const questionUpdateSchema = bankQuestionSchema.extend(
  revisionSchema.shape,
);
export const transferSchema = revisionSchema.extend({
  targetBankId: z.uuid(),
  action: z.enum(['COPY', 'MOVE']),
});
export const bankListSchema = pageSchema
  .extend({
    search: z.string().trim().max(150).default(''),
    archived: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export const questionListSchema = bankListSchema.extend({
  difficulty: difficultySchema.optional(),
  topic: z.string().trim().max(100).default(''),
});
export const selectionSchema = z
  .object({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export type BankInput = z.infer<typeof bankSchema>;
export type BankQuestionInput = z.infer<typeof bankQuestionSchema>;
