import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(12, 'Use at least 12 characters.').max(72)
  .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Use at most 72 UTF-8 bytes.');

export const registerSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(2).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u, 'Use a readable name.'),
  password,
  role: z.enum(['STUDENT', 'LECTURER']),
  ageConfirmed: z.literal(true, { error: 'You must confirm that you are at least 18 years old.' })
}).strict();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long.')
}).strict();
