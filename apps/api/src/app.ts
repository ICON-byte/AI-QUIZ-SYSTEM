import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Config } from './config/env.js';
import type { Database } from './infrastructure/database.js';
import { errorHandler, HttpError } from './middleware/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { authenticate, requireRole, requireVerifiedLecturer } from './modules/auth/authorization.js';
import { practiceRoutes } from './modules/quizzes/routes.js';
import { courseRoutes } from './modules/courses/routes.js';
import { bankRoutes } from './modules/banks/routes.js';

export function createApp(db: Database, config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute.' } } }));
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('Origin') !== config.APP_ORIGIN || req.get('X-CSRF-Protection') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site') {
        throw new HttpError(403, 'UNTRUSTED_REQUEST', 'This request could not be verified.');
      }
      if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send an application/json request.');
    }
    next();
  });
  app.use('/api/v1/quizzes', express.json({ limit: '256kb' }));
  app.use('/api/v1/courses/:courseId/assessments', express.json({ limit: '256kb' }));
  // JSON transport preserves the existing CSRF contract; raw CSV is capped separately.
  app.use('/api/v1/question-banks/:bankId/import', express.json({ limit: '2mb' }));
  app.use('/api/v1/question-banks', express.json({ limit: '64kb' }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  const auth = authRoutes(db, config);
  const credentialsLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please try again in 15 minutes.' } } });
  app.use('/api/v1/auth/login', credentialsLimiter);
  app.use('/api/v1/auth/register', credentialsLimiter);
  app.use('/api/v1/auth', auth.router);
  const authenticated = authenticate(db, config);
  app.use('/api/v1/question-banks', authenticated, bankRoutes(db, config));
  app.use('/api/v1/quizzes', authenticated, requireRole('STUDENT'));
  app.use('/api/v1/attempts', authenticated, requireRole('STUDENT'));
  app.use('/api/v1/practice/history', authenticated, requireRole('STUDENT'));
  app.use('/api/v1', practiceRoutes(db));
  // Mount only course/assessment paths so this router never guards public health/auth routes.
  const academic = courseRoutes(db, config);
  app.use('/api/v1', (req, res, next) => {
    if (/^\/(courses|assessments)(\/|$)/.test(req.path)) return academic(req, res, next);
    next();
  });
  app.get('/api/v1/dashboard/student', authenticated, requireRole('STUDENT'), (_req, res) => res.json({ role: 'STUDENT' }));
  app.get('/api/v1/dashboard/lecturer', authenticated, requireRole('LECTURER'), (req, res) => res.json({
    role: 'LECTURER', verificationStatus: req.auth!.user.verification!.status
  }));
  // Capability check only; no assessment functionality is implemented in Stage 1.
  app.get('/api/v1/lecturer/eligibility', authenticated, requireVerifiedLecturer, (_req, res) => res.json({ verified: true }));
  app.get('/api/v1/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'This endpoint does not exist.')));
  app.use(errorHandler);
  return { app, ready: auth.ready };
}
