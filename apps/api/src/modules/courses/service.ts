import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { Prisma, type Course } from '../../generated/prisma/client.js';
import type { Database } from '../../infrastructure/database.js';
import { HttpError } from '../../middleware/errors.js';
import { tokenHash } from '../auth/tokens.js';
import { databaseNow, lock } from '../quizzes/data.js';
import { ownedCourse, courseMissing, requireEnrollment } from './access.js';
import type { courseSchema } from './validation.js';

export function courseDto(course: Course) {
  return {
    id: course.id,
    title: course.title,
    code: course.code,
    description: course.description,
    revision: course.revision,
    archivedAt: course.archivedAt?.toISOString() ?? null,
    enrollmentEnabled: course.enrollmentCodeHash !== null,
  };
}
const newCode = () => randomBytes(12).toString('hex').toUpperCase();
function conflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    throw new HttpError(
      409,
      'COURSE_CODE_EXISTS',
      'You already have a course with this course code.',
    );
  throw error;
}

export function createCourseService(db: Database) {
  return {
    async list(userId: string, role: string, page: number) {
      const where =
        role === 'LECTURER'
          ? { ownerId: userId }
          : {
              enrollments: {
                some: { studentId: userId, status: 'ACTIVE' as const },
              },
            };
      const [courses, total] = await db.$transaction([
        db.course.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * 20,
          take: 20,
        }),
        db.course.count({ where }),
      ]);
      return { courses: courses.map(courseDto), total, page, pageSize: 20 };
    },
    async create(lecturerId: string, input: z.infer<typeof courseSchema>) {
      const enrollmentCode = newCode();
      try {
        // Services recheck verification too, rather than relying only on routing.
        const user = await db.user.findUnique({
          where: { id: lecturerId },
          include: { verification: true },
        });
        if (
          user?.role !== 'LECTURER' ||
          user.status !== 'ACTIVE' ||
          user.verification?.status !== 'APPROVED'
        )
          throw new HttpError(
            403,
            'LECTURER_NOT_VERIFIED',
            'Lecturer verification is required.',
          );
        const course = await db.course.create({
          data: {
            ...input,
            ownerId: lecturerId,
            enrollmentCodeHash: tokenHash(enrollmentCode),
          },
        });
        return { ...courseDto(course), enrollmentCode };
      } catch (error) {
        return conflict(error);
      }
    },
    async get(userId: string, role: string, id: string) {
      return db.$transaction(async (tx) => {
        await lock(tx, `course:${id}`);
        const course =
          role === 'LECTURER'
            ? await ownedCourse(tx, id, userId)
            : await tx.course.findUnique({ where: { id } });
        if (!course) throw courseMissing();
        if (role === 'STUDENT') await requireEnrollment(tx, id, userId);
        return courseDto(course);
      });
    },
    async update(
      userId: string,
      id: string,
      input: z.infer<typeof courseSchema> & { revision: number },
    ) {
      try {
        return await db.$transaction(async (tx) => {
          const course = await ownedCourse(tx, id, userId, true);
          if (course.revision !== input.revision)
            throw new HttpError(
              409,
              'COURSE_CHANGED',
              'This course changed. Reload before saving.',
            );
          return courseDto(
            await tx.course.update({
              where: { id },
              data: {
                title: input.title,
                code: input.code,
                description: input.description,
                revision: { increment: 1 },
              },
            }),
          );
        });
      } catch (error) {
        return conflict(error);
      }
    },
    async enrollmentCode(userId: string, id: string, revoke: boolean) {
      return db.$transaction(async (tx) => {
        await ownedCourse(tx, id, userId, true);
        const enrollmentCode = revoke ? null : newCode();
        await tx.course.update({
          where: { id },
          data: {
            enrollmentCodeHash: enrollmentCode
              ? tokenHash(enrollmentCode)
              : null,
          },
        });
        return { enrollmentCode };
      });
    },
    async join(studentId: string, code: string) {
      const digest = tokenHash(code);
      return db.$transaction(async (tx) => {
        const found = await tx.course.findUnique({
          where: { enrollmentCodeHash: digest },
        });
        if (!found)
          throw new HttpError(
            404,
            'INVALID_ENROLLMENT_CODE',
            'This enrollment code is invalid or revoked.',
          );
        await lock(tx, `course:${found.id}`);
        const course = await tx.course.findUniqueOrThrow({
          where: { id: found.id },
          include: { owner: { include: { verification: true } } },
        });
        if (
          course.enrollmentCodeHash !== digest ||
          course.archivedAt ||
          course.owner.status !== 'ACTIVE' ||
          course.owner.verification?.status !== 'APPROVED'
        )
          throw new HttpError(
            404,
            'INVALID_ENROLLMENT_CODE',
            'This enrollment code is invalid or revoked.',
          );
        const existing = await tx.enrollment.findUnique({
          where: { courseId_studentId: { courseId: course.id, studentId } },
        });
        if (existing?.status === 'REMOVED')
          throw new HttpError(
            403,
            'ENROLLMENT_REMOVED',
            'Your enrollment was removed. Contact the lecturer to restore access.',
          );
        if (existing?.status !== 'ACTIVE')
          await tx.enrollment.upsert({
            where: { courseId_studentId: { courseId: course.id, studentId } },
            create: { courseId: course.id, studentId },
            update: { status: 'ACTIVE', joinedAt: await databaseNow(tx) },
          });
        return courseDto(course);
      });
    },
    async roster(userId: string, id: string, page: number) {
      return db.$transaction(async (tx) => {
        await ownedCourse(tx, id, userId);
        const rows = await tx.enrollment.findMany({
          where: { courseId: id },
          include: {
            student: { select: { id: true, displayName: true, email: true } },
          },
          orderBy: [{ joinedAt: 'asc' }, { studentId: 'asc' }],
          skip: (page - 1) * 20,
          take: 20,
        });
        const total = await tx.enrollment.count({ where: { courseId: id } });
        const active = await tx.enrollment.count({
          where: { courseId: id, status: 'ACTIVE' },
        });
        return {
          students: rows.map((row) => ({
            ...row.student,
            status: row.status,
            joinedAt: row.joinedAt.toISOString(),
          })),
          total,
          active,
          page,
          pageSize: 20,
        };
      });
    },
    async membership(
      userId: string,
      role: string,
      id: string,
      studentId: string,
      restore = false,
    ) {
      return db.$transaction(async (tx) => {
        await lock(tx, `course:${id}`);
        if (role === 'LECTURER') await ownedCourse(tx, id, userId, true);
        else {
          if (userId !== studentId) throw courseMissing();
          await requireEnrollment(tx, id, userId);
        }
        const existing = await tx.enrollment.findUnique({
          where: { courseId_studentId: { courseId: id, studentId } },
        });
        if (!existing) throw courseMissing();
        if (
          !restore &&
          (await tx.attempt.count({
            where: {
              userId: studentId,
              status: 'IN_PROGRESS',
              quiz: { courseId: id },
            },
          }))
        )
          throw new HttpError(
            409,
            'ACTIVE_COURSE_ATTEMPT',
            'Finish active course attempts before changing enrollment. Close the assessment first if necessary.',
          );
        await tx.enrollment.update({
          where: { courseId_studentId: { courseId: id, studentId } },
          data: {
            status: restore
              ? 'ACTIVE'
              : role === 'LECTURER'
                ? 'REMOVED'
                : 'LEFT',
          },
        });
        return { changed: true };
      });
    },
    async archive(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        const course = await ownedCourse(tx, id, userId);
        if (course.archivedAt) return courseDto(course);
        return courseDto(
          await tx.course.update({
            where: { id },
            data: {
              archivedAt: await databaseNow(tx),
              enrollmentCodeHash: null,
              revision: { increment: 1 },
            },
          }),
        );
      });
    },
  };
}
