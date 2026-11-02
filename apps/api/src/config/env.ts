import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  JWT_SECRET: z.string().min(32).refine(value => !/replace|example|change-me/i.test(value), 'Generate a random JWT secret'),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0)
}).superRefine((value, ctx) => {
  const origin = new URL(value.APP_ORIGIN);
  if (origin.origin !== value.APP_ORIGIN) {
    ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'Use an origin without a path or trailing slash' });
  }
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'HTTPS is required in production' });
  }
});

export type Config = z.infer<typeof schema>;

export function loadConfig(input: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Never include submitted values (notably connection strings) in startup errors.
    throw new Error(`Invalid environment configuration: ${[...new Set(result.error.issues.map(issue => issue.path[0]))].join(', ')}`);
  }
  return result.data;
}
