import { z } from 'zod';
import { quizSchema, pageSchema } from '../quizzes/validation.js';
export const challengeSchema = quizSchema.extend({
  closesAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export const challengeUpdateSchema = challengeSchema.extend({
  revision: z.number().int().nonnegative(),
});
export const challengeListSchema = pageSchema
  .extend({ view: z.enum(['created', 'joined', 'history']).default('created') })
  .strict();
export const challengeJoinSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-F0-9]{24}$/, 'Enter the 24-character invitation code.'),
  })
  .strict();
