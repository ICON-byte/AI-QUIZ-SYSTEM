import { Router } from 'express';
import type { Database } from '../../infrastructure/database.js';
import { createQuizService } from './service.js';
import { createAttemptEngine } from '../attempts/engine.js';
import {
  answerSchema,
  emptySchema,
  idSchema,
  pageSchema,
  publishSchema,
  quizSchema,
  updateQuizSchema,
} from './validation.js';

export function practiceRoutes(db: Database) {
  const router = Router();
  const quizzes = createQuizService(db);
  const engine = createAttemptEngine(db);
  router.get('/quizzes', async (req, res) =>
    res.json(
      await quizzes.list(req.auth!.user.id, pageSchema.parse(req.query).page),
    ),
  );
  router.post('/quizzes', async (req, res) =>
    res
      .status(201)
      .json(
        await quizzes.create(req.auth!.user.id, quizSchema.parse(req.body)),
      ),
  );
  router.get('/quizzes/:id', async (req, res) =>
    res.json(
      await quizzes.get(req.auth!.user.id, idSchema.parse(req.params.id)),
    ),
  );
  router.get('/quizzes/:id/draft', async (req, res) =>
    res.json(
      await quizzes.get(req.auth!.user.id, idSchema.parse(req.params.id), true),
    ),
  );
  router.put('/quizzes/:id', async (req, res) =>
    res.json(
      await quizzes.update(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        updateQuizSchema.parse(req.body),
      ),
    ),
  );
  router.post('/quizzes/:id/publish', async (req, res) =>
    res.json(
      await quizzes.publish(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        publishSchema.parse(req.body).revision,
      ),
    ),
  );
  router.post('/quizzes/:id/attempts', async (req, res) => {
    emptySchema.parse(req.body);
    res.json(
      await engine.start(req.auth!.user.id, idSchema.parse(req.params.id)),
    );
  });
  router.get('/attempts/:id', async (req, res) =>
    res.json(
      await engine.get(req.auth!.user.id, idSchema.parse(req.params.id)),
    ),
  );
  router.put('/attempts/:id/answers/:questionId', async (req, res) =>
    res.json(
      await engine.save(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        idSchema.parse(req.params.questionId),
        answerSchema.parse(req.body),
      ),
    ),
  );
  router.post('/attempts/:id/submit', async (req, res) => {
    emptySchema.parse(req.body);
    res.json(
      await engine.submit(req.auth!.user.id, idSchema.parse(req.params.id)),
    );
  });
  router.get('/attempts/:id/result', async (req, res) =>
    res.json(
      await engine.result(req.auth!.user.id, idSchema.parse(req.params.id)),
    ),
  );
  router.post('/attempts/:id/retry-incorrect', async (req, res) => {
    emptySchema.parse(req.body);
    res
      .status(201)
      .json(
        await engine.retryIncorrect(
          req.auth!.user.id,
          idSchema.parse(req.params.id),
        ),
      );
  });
  router.get('/practice/history', async (req, res) =>
    res.json(
      await engine.history(req.auth!.user.id, pageSchema.parse(req.query).page),
    ),
  );
  return router;
}
