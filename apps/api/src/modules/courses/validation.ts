import { z } from 'zod';
export const courseSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(30)
      .regex(
        /^[A-Z0-9][A-Z0-9 ._-]*$/,
        'Use letters, numbers, spaces, dots, hyphens or underscores.',
      ),
    description: z.string().trim().max(2000).default(''),
  })
  .strict();
export const courseUpdateSchema = courseSchema.extend({
  revision: z.number().int().nonnegative(),
});
export const joinSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-F0-9]{24}$/, 'Enter the 24-character enrollment code.'),
  })
  .strict();
