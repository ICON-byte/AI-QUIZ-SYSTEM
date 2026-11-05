import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Database } from '../../infrastructure/database.js';
import type { Config } from '../../config/env.js';
import {
  idSchema,
  pageSchema,
  emptySchema,
  publishSchema,
} from '../quizzes/validation.js';
import { createChallengeService } from './service.js';
import {
  challengeSchema,
  challengeUpdateSchema,
  challengeListSchema,
  challengeJoinSchema,
} from './validation.js';
export function challengeRoutes(db: Database, config: Config) {
  const router = Router(),
    service = createChallengeService(db, config);
  router.get('/', async (req, res) => {
    const { view, page } = challengeListSchema.parse(req.query);
    res.json(await service.list(req.auth!.user.id, view, page));
  });
  router.post('/', async (req, res) =>
    res
      .status(201)
      .json(
        await service.author.create(
          req.auth!.user.id,
          challengeSchema.parse(req.body),
        ),
      ),
  );
  router.get('/history', async (req, res) =>
    res.json(
      await service.list(
        req.auth!.user.id,
        'history',
        pageSchema.parse(req.query).page,
      ),
    ),
  );
  router.post(
    '/join',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many invitation attempts. Wait a minute and try again.',
        },
      },
    }),
    async (req, res) =>
      res.json(
        await service.join(
          req.auth!.user.id,
          challengeJoinSchema.parse(req.body).code,
        ),
      ),
  );
  router.get('/:id', async (req, res) =>
    res.json(
      await service.details(req.auth!.user.id, idSchema.parse(req.params.id)),
    ),
  );
  router.get('/:id/manage', async (req, res) =>
    res.json(
      await service.details(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        true,
      ),
    ),
  );
  router.get('/:id/draft', async (req, res) =>
    res.json(
      await service.author.get(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        true,
      ),
    ),
  );
  router.put('/:id', async (req, res) =>
    res.json(
      await service.author.update(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        challengeUpdateSchema.parse(req.body),
      ),
    ),
  );
  router.post('/:id/publish', async (req, res) =>
    res.json(
      await service.publish(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        publishSchema.parse(req.body).revision,
      ),
    ),
  );
  router.get('/:id/invitation', async (req, res) =>
    res.json(
      await service.invitation(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
      ),
    ),
  );
  router.post('/:id/close', async (req, res) => {
    emptySchema.parse(req.body);
    res.json(
      await service.close(req.auth!.user.id, idSchema.parse(req.params.id)),
    );
  });
  router.get('/:id/leaderboard', async (req, res) =>
    res.json(
      await service.leaderboard(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        pageSchema.parse(req.query).page,
      ),
    ),
  );
  return router;
}
