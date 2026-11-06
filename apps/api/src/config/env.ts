import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  JWT_SECRET: z.string().min(32).refine(value => !/replace|example|change-me/i.test(value), 'Generate a random JWT secret'),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  CHALLENGE_INVITE_KEY: z.string().trim().regex(/^(?:[a-fA-F0-9]{64})?$/).default(''),
  GEMINI_API_KEY: z.string().trim().default(''),
  GEMINI_MODEL: z.string().trim().max(120).regex(/^[a-zA-Z0-9._-]*$/).default(''),
  AI_DAILY_USER_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  AI_DAILY_PROJECT_CALL_LIMIT: z.coerce.number().int().min(1).max(10000).default(20),
  AI_CALL_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(300).default(30),
  AI_JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(300).default(120),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(16000).default(8192),
  AI_DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1024).max(10*1024*1024).default(5*1024*1024),
  AI_DOCUMENT_MAX_CHARACTERS: z.coerce.number().int().min(1000).max(100000).default(40000),
  AI_DOCUMENT_MAX_PAGES: z.coerce.number().int().min(1).max(200).default(100),
  AI_EXTRACTION_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(30).default(10)
}).superRefine((value, ctx) => {
  if (value.CHALLENGE_INVITE_KEY && value.CHALLENGE_INVITE_KEY === value.JWT_SECRET) ctx.addIssue({code:'custom',path:['CHALLENGE_INVITE_KEY'],message:'Use a dedicated encryption key'});
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
