import { HttpError } from '../../middleware/errors.js';
import { lock, type Tx, quizInclude } from '../quizzes/data.js';
export const challengeMissing = () =>
  new HttpError(404, 'CHALLENGE_NOT_FOUND', 'This challenge was not found.');
export function challengeCutoff(
  challenge:
    | { closesAt: Date | null; closedAt: Date | null }
    | null
    | undefined,
) {
  const dates = [challenge?.closesAt, challenge?.closedAt].filter(
    (date): date is Date => !!date,
  );
  return dates.length
    ? new Date(Math.min(...dates.map((date) => date.getTime())))
    : null;
}
export async function challengeAccess(
  tx: Tx,
  id: string,
  userId: string,
  ownerOnly = false,
) {
  await lock(tx, `quiz:${id}`);
  const quiz = await tx.quiz.findFirst({
    where: { id, mode: 'CHALLENGE' },
    include: quizInclude,
  });
  if (!quiz?.challenge) throw challengeMissing();
  if (quiz.ownerId !== userId) {
    if (
      ownerOnly ||
      quiz.status !== 'PUBLISHED' ||
      !(await tx.challengeParticipant.findUnique({
        where: { quizId_studentId: { quizId: id, studentId: userId } },
      }))
    )
      throw challengeMissing();
  }
  return quiz;
}
