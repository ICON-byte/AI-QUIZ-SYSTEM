import type { Tx } from '../quizzes/data.js';
import { lock } from '../quizzes/data.js';
import { HttpError } from '../../middleware/errors.js';

export const courseMissing = () =>
  new HttpError(404, 'COURSE_NOT_FOUND', 'This course was not found.');
export async function ownedCourse(
  tx: Tx,
  id: string,
  lecturerId: string,
  editable = false,
) {
  await lock(tx, `course:${id}`);
  const course = await tx.course.findFirst({
    where: { id, ownerId: lecturerId },
    include: { owner: { include: { verification: true } } },
  });
  if (!course) throw courseMissing();
  if (
    course.owner.status !== 'ACTIVE' ||
    course.owner.role !== 'LECTURER' ||
    course.owner.verification?.status !== 'APPROVED'
  )
    throw new HttpError(
      403,
      'LECTURER_NOT_VERIFIED',
      'Lecturer verification is required.',
    );
  if (editable && course.archivedAt)
    throw new HttpError(
      409,
      'COURSE_ARCHIVED',
      'Archived courses cannot be changed.',
    );
  return course;
}
export async function requireEnrollment(
  tx: Tx,
  courseId: string,
  studentId: string,
) {
  const enrollment = await tx.enrollment.findUnique({
    where: { courseId_studentId: { courseId, studentId } },
  });
  if (enrollment?.status !== 'ACTIVE') throw courseMissing();
}
