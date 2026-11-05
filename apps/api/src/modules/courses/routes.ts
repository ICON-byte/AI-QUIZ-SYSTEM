import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../../config/env.js';
import type { Database } from '../../infrastructure/database.js';
import {
  authenticate,
  requireRole,
  requireVerifiedLecturer,
} from '../auth/authorization.js';
import {
  emptySchema,
  idSchema,
  pageSchema,
  publishSchema,
} from '../quizzes/validation.js';
import { createQuizService } from '../quizzes/service.js';
import { createCourseService } from './service.js';
import { courseSchema, courseUpdateSchema, joinSchema } from './validation.js';
import { createAssessmentService } from '../assessments/service.js';
import {
  assessmentSchema,
  assessmentUpdateSchema,
} from '../assessments/validation.js';

export function courseRoutes(db: Database, config: Config) {
  const router = Router();
  const courses = createCourseService(db);
  const assessments = createAssessmentService(db);
  router.use(authenticate(db, config));
  router.use((req, res, next) =>
    req.auth!.user.role === 'LECTURER'
      ? requireVerifiedLecturer(req, res, next)
      : next(),
  );
  const lecturer = requireVerifiedLecturer;
  const student = requireRole('STUDENT');
  router.get('/courses', async (req, res) =>
    res.json(
      await courses.list(
        req.auth!.user.id,
        req.auth!.user.role,
        pageSchema.parse(req.query).page,
      ),
    ),
  );
  router.post('/courses', lecturer, async (req, res) =>
    res
      .status(201)
      .json(
        await courses.create(req.auth!.user.id, courseSchema.parse(req.body)),
      ),
  );
  router.post(
    '/courses/join',
    student,
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res) =>
      res.json(
        await courses.join(req.auth!.user.id, joinSchema.parse(req.body).code),
      ),
  );
  router.get('/courses/:courseId', async (req, res) =>
    res.json(
      await courses.get(
        req.auth!.user.id,
        req.auth!.user.role,
        idSchema.parse(req.params.courseId),
      ),
    ),
  );
  router.put('/courses/:courseId', lecturer, async (req, res) =>
    res.json(
      await courses.update(
        req.auth!.user.id,
        idSchema.parse(req.params.courseId),
        courseUpdateSchema.parse(req.body),
      ),
    ),
  );
  router.post(
    '/courses/:courseId/enrollment-code',
    lecturer,
    async (req, res) => {
      emptySchema.parse(req.body);
      res.json(
        await courses.enrollmentCode(
          req.auth!.user.id,
          idSchema.parse(req.params.courseId),
          false,
        ),
      );
    },
  );
  router.post('/courses/:courseId/revoke-code', lecturer, async (req, res) => {
    emptySchema.parse(req.body);
    res.json(
      await courses.enrollmentCode(
        req.auth!.user.id,
        idSchema.parse(req.params.courseId),
        true,
      ),
    );
  });
  router.post('/courses/:courseId/archive', lecturer, async (req, res) => {
    emptySchema.parse(req.body);
    const result = await courses.archive(
      req.auth!.user.id,
      idSchema.parse(req.params.courseId),
    );
    res.json(result);
  });
  router.get('/courses/:courseId/roster', lecturer, async (req, res) =>
    res.json(
      await courses.roster(
        req.auth!.user.id,
        idSchema.parse(req.params.courseId),
        pageSchema.parse(req.query).page,
      ),
    ),
  );
  router.post('/courses/:courseId/leave', student, async (req, res) => {
    emptySchema.parse(req.body);
    res.json(
      await courses.membership(
        req.auth!.user.id,
        'STUDENT',
        idSchema.parse(req.params.courseId),
        req.auth!.user.id,
      ),
    );
  });
  for (const action of ['remove', 'restore'] as const)
    router.post(
      `/courses/:courseId/students/:studentId/${action}`,
      lecturer,
      async (req, res) => {
        emptySchema.parse(req.body);
        res.json(
          await courses.membership(
            req.auth!.user.id,
            'LECTURER',
            idSchema.parse(req.params.courseId),
            idSchema.parse(req.params.studentId),
            action === 'restore',
          ),
        );
      },
    );
  router.get('/courses/:courseId/assessments', async (req, res) =>
    res.json(
      await assessments.list(
        req.auth!.user.id,
        req.auth!.user.role,
        idSchema.parse(req.params.courseId),
        pageSchema.parse(req.query).page,
      ),
    ),
  );
  router.post('/courses/:courseId/assessments', lecturer, async (req, res) =>
    res
      .status(201)
      .json(
        await createQuizService(db, idSchema.parse(req.params.courseId)).create(
          req.auth!.user.id,
          assessmentSchema.parse(req.body),
        ),
      ),
  );
  router.get(
    '/courses/:courseId/assessments/:id/draft',
    lecturer,
    async (req, res) =>
      res.json(
        await createQuizService(db, idSchema.parse(req.params.courseId)).get(
          req.auth!.user.id,
          idSchema.parse(req.params.id),
          true,
        ),
      ),
  );
  router.put('/courses/:courseId/assessments/:id', lecturer, async (req, res) =>
    res.json(
      await createQuizService(db, idSchema.parse(req.params.courseId)).update(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
        assessmentUpdateSchema.parse(req.body),
      ),
    ),
  );
  router.post('/courses/:courseId/assessments/:id/duplicate', lecturer, async (req, res) => {
    emptySchema.parse(req.body);
    res.status(201).json(await createQuizService(db, idSchema.parse(req.params.courseId)).duplicate(req.auth!.user.id, idSchema.parse(req.params.id)));
  });
  router.post(
    '/courses/:courseId/assessments/:id/publish',
    lecturer,
    async (req, res) =>
      res.json(
        await createQuizService(
          db,
          idSchema.parse(req.params.courseId),
        ).publish(
          req.auth!.user.id,
          idSchema.parse(req.params.id),
          publishSchema.parse(req.body).revision,
        ),
      ),
  );
  router.post(
    '/courses/:courseId/assessments/:id/close',
    lecturer,
    async (req, res) => {
      emptySchema.parse(req.body);
      res.json(
        await assessments.close(
          req.auth!.user.id,
          idSchema.parse(req.params.courseId),
          idSchema.parse(req.params.id),
        ),
      );
    },
  );
  router.get(
    '/courses/:courseId/assessments/:id/report',
    lecturer,
    async (req, res) =>
      res.json(
        await assessments.report(
          req.auth!.user.id,
          idSchema.parse(req.params.courseId),
          idSchema.parse(req.params.id),
        ),
      ),
  );
  router.get('/assessments/:id', student, async (req, res) =>
    res.json(
      await assessments.instructions(
        req.auth!.user.id,
        idSchema.parse(req.params.id),
      ),
    ),
  );
  return router;
}
