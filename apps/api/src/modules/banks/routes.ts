import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Database } from '../../infrastructure/database.js';
import type { Config } from '../../config/env.js';
import { createBankService } from './service.js';
import {
  bankSchema,
  bankUpdateSchema,
  bankQuestionSchema,
  bankListSchema,
  questionListSchema,
  questionUpdateSchema,
  revisionSchema,
  transferSchema,
  selectionSchema,
} from './validation.js';
import { confirmImportSchema, csvBodySchema, csvTemplate } from './csv.js';
import { emptySchema, idSchema } from '../quizzes/validation.js';

export function bankRoutes(db: Database, config: Config) {
  const router = Router();
  const service = createBankService(db, config.JWT_SECRET);
  router.get('/csv-template', (_req, res) =>
    res
      .type('text/csv')
      .attachment('question-template.csv')
      .send(csvTemplate()),
  );
  router.get('/', async (req, res) =>
    res.json(
      await service.list(req.auth!.user.id, bankListSchema.parse(req.query)),
    ),
  );
  router.post('/', async (req, res) =>
    res
      .status(201)
      .json(
        await service.create(req.auth!.user.id, bankSchema.parse(req.body)),
      ),
  );
  router.post('/selection', async (req, res) =>
    res.json(
      await service.select(
        req.auth!.user.id,
        selectionSchema.parse(req.body).ids,
      ),
    ),
  );
  router.get('/:bankId', async (req, res) =>
    res.json(
      await service.get(req.auth!.user.id, idSchema.parse(req.params.bankId)),
    ),
  );
  router.put('/:bankId', async (req, res) =>
    res.json(
      await service.update(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        bankUpdateSchema.parse(req.body),
      ),
    ),
  );
  router.post('/:bankId/archive', async (req, res) =>
    res.json(
      await service.archive(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        revisionSchema.parse(req.body).revision,
      ),
    ),
  );
  router.post('/:bankId/duplicate', async (req, res) => {
    emptySchema.parse(req.body);
    res
      .status(201)
      .json(
        await service.duplicate(
          req.auth!.user.id,
          idSchema.parse(req.params.bankId),
        ),
      );
  });
  router.get('/:bankId/questions', async (req, res) =>
    res.json(
      await service.questions(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        questionListSchema.parse(req.query),
      ),
    ),
  );
  router.post('/:bankId/questions', async (req, res) =>
    res
      .status(201)
      .json(
        await service.add(
          req.auth!.user.id,
          idSchema.parse(req.params.bankId),
          bankQuestionSchema.parse(req.body),
        ),
      ),
  );
  router.get('/:bankId/questions/:id', async (req, res) =>
    res.json(
      await service.getQuestion(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        idSchema.parse(req.params.id),
      ),
    ),
  );
  router.put('/:bankId/questions/:id', async (req, res) =>
    res.json(
      await service.edit(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        idSchema.parse(req.params.id),
        questionUpdateSchema.parse(req.body),
      ),
    ),
  );
  router.post('/:bankId/questions/:id/archive', async (req, res) =>
    res.json(
      await service.archiveQuestion(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        idSchema.parse(req.params.id),
        revisionSchema.parse(req.body).revision,
      ),
    ),
  );
  router.post('/:bankId/questions/:id/transfer', async (req, res) =>
    res
      .status(201)
      .json(
        await service.transfer(
          req.auth!.user.id,
          idSchema.parse(req.params.bankId),
          idSchema.parse(req.params.id),
          transferSchema.parse(req.body),
        ),
      ),
  );
  router.use(
    '/:bankId/import',
    rateLimit({
      windowMs: 60000,
      limit: 12,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many imports. Wait a minute and try again.',
        },
      },
    }),
  );
  router.post('/:bankId/import/preview', async (req, res) =>
    res.json(
      await service.preview(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        csvBodySchema.parse(req.body).csv,
      ),
    ),
  );
  router.post('/:bankId/import/confirm', async (req, res) =>
    res.json(
      await service.confirm(
        req.auth!.user.id,
        idSchema.parse(req.params.bankId),
        confirmImportSchema.parse(req.body),
      ),
    ),
  );
  return router;
}
