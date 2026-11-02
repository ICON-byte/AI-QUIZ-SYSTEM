import { z } from 'zod';
import { quizSchema } from '../quizzes/validation.js';
export const assessmentSchema = quizSchema
  .extend({
    opensAt: z.iso.datetime({ offset: true }).nullable().default(null),
    closesAt: z.iso.datetime({ offset: true }).nullable().default(null),
    maxAttempts: z.number().int().min(1).max(10).default(1),
  })
  .refine(
    (value) =>
      !value.opensAt ||
      !value.closesAt ||
      Date.parse(value.opensAt) < Date.parse(value.closesAt),
    { message: 'Closing time must be after opening time.', path: ['closesAt'] },
  );
export const assessmentUpdateSchema = assessmentSchema.safeExtend({
  revision: z.number().int().nonnegative(),
});
