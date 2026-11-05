import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import type { Database } from '../../infrastructure/database.js';
import type { Config } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';
import {
  createAiService,
  isAiConfigured,
  requireAiEligible,
} from './service.js';
import { createExtractor } from './extraction.js';
import {
  acceptSchema,
  eligibilitySchema,
  generationInputSchema,
  reviewSchema,
} from './validation.js';
import { emptySchema, idSchema } from '../quizzes/validation.js';

export function aiRoutes(db: Database, config: Config) {
  const router = Router();
  const service = createAiService(db, config);
  const extract = createExtractor(config);
  const limiter = rateLimit({
    windowMs: 60000,
    limit: 6,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'AI_RATE_LIMIT',
        message: 'Too many AI requests. Wait a minute before trying again.',
      },
    },
  });
  router.get('/capabilities', async (req, res) =>
    res.json(await service.capabilities(req.auth!.user.id)),
  );
  router.post('/eligibility', async (req, res) => {
    eligibilitySchema.parse(req.body);
    res.json(await service.eligibility(req.auth!.user.id));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.AI_DOCUMENT_MAX_BYTES,
      files: 1,
      fields: 1,
      fieldSize: 20,
      parts: 2,
    },
  }).single('document');
  router.post(
    '/documents/extract',
    limiter,
    async (req, _res, next) => {
      await requireAiEligible(db, req.auth!.user.id);
      if (!isAiConfigured(config))
        throw new HttpError(
          503,
          'AI_UNAVAILABLE',
          'AI document generation is unavailable until Gemini is configured.',
        );
      next();
    },
    (req, res, next) => {
      upload(req, res, (error) => {
        if (error)
          return next(
            new HttpError(
              400,
              'INVALID_UPLOAD',
              'Upload one supported file within the configured size limit.',
            ),
          );
        next();
      });
    },
    async (req, res) => {
      if (req.body?.nonSensitiveConfirmed !== 'true' || !req.file)
        throw new HttpError(
          400,
          'PRIVACY_CONFIRMATION_REQUIRED',
          'Confirm that the document contains only non-sensitive educational material.',
        );
      res.json(
        await extract(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
        ),
      );
    },
  );
  router.post('/generations', limiter, async (req, res) =>
    res
      .status(202)
      .json(
        await service.create(
          req.auth!.user.id,
          generationInputSchema.parse(req.body),
        ),
      ),
  );
  router.get('/generations/:id', async (req, res) =>
    res.json(
      await service.get(req.auth!.user.id, idSchema.parse(req.params.id)),
    ),
  );
  router.post('/generations/:id/discard', async (req, res) => {
    emptySchema.parse(req.body);
    await service.discard(req.auth!.user.id, idSchema.parse(req.params.id));
    res.status(204).end();
  });
  router.post('/generations/:id/accept', async (req, res) =>
    res.json(
      await service.accept(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        acceptSchema.parse(req.body),
      ),
    ),
  );
  router.post('/generations/:id/review', async (req, res) =>
    res.json(
      await service.review(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        reviewSchema.parse(req.body),
      ),
    ),
  );
  return router;
}
