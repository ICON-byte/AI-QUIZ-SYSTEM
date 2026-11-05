import { Prisma } from '../../generated/prisma/client.js';
import type { Database } from '../../infrastructure/database.js';
import type { Config } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';
import { databaseNow, lock, quizSummary } from '../quizzes/data.js';
import { createQuizService } from '../quizzes/service.js';
import { createAttemptEngine } from '../attempts/engine.js';
import {
  challengeAccess,
  challengeCutoff,
  challengeMissing,
} from './access.js';
import {
  createInvitation,
  readInvitation,
  invitationHash,
} from './invitations.js';

export function createChallengeService(db: Database, config: Config) {
  // Only the operator-configured schema becomes an identifier; all user values remain parameters.
  const schema = (
    new URL(config.DATABASE_URL).searchParams.get('schema') ?? 'public'
  ).replace(/"/g, '""');
  const attemptTable = Prisma.raw('"' + schema + '"."Attempt"');
  const userTable = Prisma.raw('"' + schema + '"."User"');
  const author = createQuizService(db, { mode: 'CHALLENGE' }),
    engine = createAttemptEngine(db);
  return {
    author,
    async list(
      userId: string,
      view: 'created' | 'joined' | 'history',
      page: number,
    ) {
      if (view === 'history') await engine.expire(userId, undefined, false);
      const where = {
        mode: 'CHALLENGE' as const,
        ...(view === 'created'
          ? { ownerId: userId }
          : {
              challenge: { participants: { some: { studentId: userId } } },
              ...(view === 'history'
                ? {
                    attempts: {
                      some: { userId, status: { not: 'IN_PROGRESS' as const } },
                    },
                  }
                : {}),
            }),
      };
      const [quizzes, total] = await db.$transaction([
        db.quiz.findMany({
          where,
          include: {
            questions: { select: { id: true } },
            challenge: true,
            attempts: {
              where: { userId },
              select: {
                id: true,
                status: true,
                score: true,
                totalQuestions: true,
                durationSeconds: true,
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * 20,
          take: 20,
        }),
        db.quiz.count({ where }),
      ]);
      const now = await databaseNow(db);
      return {
        page,
        pageSize: 20,
        total,
        quizzes: quizzes.map((quiz) => ({
          ...quizSummary(quiz),
          state:
            quiz.status === 'DRAFT'
              ? 'DRAFT'
              : challengeCutoff(quiz.challenge) &&
                  challengeCutoff(quiz.challenge)! <= now
                ? 'CLOSED'
                : 'OPEN',
          attempt: quiz.attempts[0] ?? null,
        })),
        sharingAvailable: !!config.CHALLENGE_INVITE_KEY,
      };
    },
    async publish(userId: string, id: string, revision: number) {
      const invitation = createInvitation(
        config.CHALLENGE_INVITE_KEY,
        id.toLowerCase(),
      );
      return author.publish(userId, id, revision, async (tx) => {
        await tx.challenge.update({
          where: { quizId: id },
          data: {
            inviteCodeHash: invitation.hash,
            inviteCodeSealed: invitation.sealed,
          },
        });
      });
    },
    async invitation(userId: string, id: string) {
      return db.$transaction(async (tx) => {
        const quiz = await challengeAccess(tx, id, userId, true);
        if (quiz.status !== 'PUBLISHED' || !quiz.challenge?.inviteCodeSealed)
          throw challengeMissing();
        const code = readInvitation(
          config.CHALLENGE_INVITE_KEY,
          quiz.id,
          quiz.challenge.inviteCodeSealed,
        );
        return {
          code,
          link: config.APP_ORIGIN + '/challenges/join#code=' + code,
        };
      });
    },
    async join(userId: string, code: string) {
      const digest = invitationHash(code);
      const found = await db.challenge.findUnique({
        where: { inviteCodeHash: digest },
        select: { quizId: true },
      });
      const invalid = () =>
        new HttpError(
          404,
          'INVITATION_UNAVAILABLE',
          'This invitation is invalid or the challenge is closed.',
        );
      if (!found) throw invalid();
      return db.$transaction(async (tx) => {
        await lock(tx, `quiz:${found.quizId}`);
        const challenge = await tx.challenge.findUnique({
          where: { quizId: found.quizId },
          include: { quiz: true },
        });
        if (
          !challenge ||
          challenge.inviteCodeHash !== digest ||
          challenge.quiz.status !== 'PUBLISHED'
        )
          throw invalid();
        if (challenge.quiz.ownerId === userId)
          throw new HttpError(
            403,
            'CREATOR_EXCLUDED',
            'Creators cannot participate in their own ranked challenges.',
          );
        const existing = await tx.challengeParticipant.findUnique({
          where: {
            quizId_studentId: { quizId: found.quizId, studentId: userId },
          },
        });
        if (existing) return { id: found.quizId };
        const cutoff = challengeCutoff(challenge);
        if (cutoff && cutoff <= (await databaseNow(tx))) throw invalid();
        await tx.challengeParticipant.create({
          data: { quizId: found.quizId, studentId: userId },
        });
        return { id: found.quizId };
      });
    },
    async details(userId: string, id: string, manage = false) {
      await db.$transaction((tx) => challengeAccess(tx, id, userId, manage));
      await engine.expire(undefined, id, false);
      return db.$transaction(async (tx) => {
        const quiz = await challengeAccess(tx, id, userId, manage),
          now = await databaseNow(tx),
          cutoff = challengeCutoff(quiz.challenge);
        const [attempts, joined, started, finalized] = await Promise.all([
          tx.attempt.findMany({
            where: { quizId: id, userId },
            select: {
              id: true,
              status: true,
              attemptNumber: true,
              score: true,
              totalQuestions: true,
            },
          }),
          tx.challengeParticipant.count({ where: { quizId: id } }),
          tx.attempt.count({ where: { quizId: id } }),
          tx.attempt.count({
            where: { quizId: id, status: { not: 'IN_PROGRESS' } },
          }),
        ]);
        return {
          ...quizSummary(quiz),
          state:
            quiz.status === 'DRAFT'
              ? 'DRAFT'
              : cutoff && cutoff <= now
                ? 'CLOSED'
                : 'OPEN',
          isCreator: quiz.ownerId === userId,
          attempts,
          serverNow: now.toISOString(),
          ...(manage
            ? {
                statistics: {
                  joined,
                  started,
                  finalized,
                  inProgress: started - finalized,
                },
                sharingAvailable: !!config.CHALLENGE_INVITE_KEY,
              }
            : {}),
        };
      });
    },
    async close(userId: string, id: string) {
      const closedAt = await db.$transaction(async (tx) => {
        const quiz = await challengeAccess(tx, id, userId, true);
        if (quiz.status !== 'PUBLISHED')
          throw new HttpError(
            409,
            'NOT_PUBLISHED',
            'Publish the challenge before closing it.',
          );
        if (quiz.challenge!.closedAt) return quiz.challenge!.closedAt;
        const now = await databaseNow(tx),
          scheduled = quiz.challenge!.closesAt;
        const cutoff = scheduled && scheduled < now ? scheduled : now;
        await tx.challenge.update({
          where: { quizId: id },
          data: { closedAt: cutoff },
        });
        return cutoff;
      });
      await engine.expire(undefined, id, false);
      return { closedAt: closedAt.toISOString() };
    },
    async leaderboard(userId: string, id: string, page: number) {
      await db.$transaction((tx) => challengeAccess(tx, id, userId));
      await engine.expire(userId, id, false);
      await db.$transaction(async (tx) => {
        const quiz = await challengeAccess(tx, id, userId),
          now = await databaseNow(tx),
          cutoff = challengeCutoff(quiz.challenge);
        if (
          quiz.ownerId !== userId &&
          !(cutoff && cutoff <= now) &&
          !(await tx.attempt.findFirst({
            where: { quizId: id, userId, status: { not: 'IN_PROGRESS' } },
          }))
        )
          throw new HttpError(
            403,
            'LEADERBOARD_LOCKED',
            'Finish your attempt or wait for closure to view the leaderboard.',
          );
      });
      await engine.expire(undefined, id, false);
      return db.$transaction(async (tx) => {
        const quiz = await challengeAccess(tx, id, userId),
          now = await databaseNow(tx),
          cutoff = challengeCutoff(quiz.challenge);
        const pending = await tx.attempt.count({
          where: {
            quizId: id,
            status: 'IN_PROGRESS',
            ...(cutoff && cutoff <= now ? {} : { expiresAt: { lte: now } }),
          },
        });
        const total = await tx.attempt.count({
          where: { quizId: id, status: { not: 'IN_PROGRESS' } },
        });
        type Entry = {
          rank: number;
          displayName: string;
          score: number;
          totalQuestions: number;
          percentage: number;
          durationMilliseconds: number;
          isYou: boolean;
        };
        // Rank the full set before pagination. Timestamp intervals are computed in PostgreSQL,
        // avoiding raw timestamp timezone decoding and whole-second rounding ties.
        const entries = pending
          ? []
          : await tx.$queryRaw<Entry[]>(Prisma.sql`
          WITH results AS (
            SELECT a."id",a."userId",u."displayName",a."score",a."totalQuestions",
              greatest(0,floor(extract(epoch FROM (a."finalizedAt"-a."startedAt"))*1000))::double precision AS "durationMilliseconds"
            FROM ${attemptTable} a JOIN ${userTable} u ON u."id"=a."userId"
            WHERE a."quizId"=${id}::uuid AND a."status"<>'IN_PROGRESS'
          ), ranked AS (
            SELECT *,rank() OVER (ORDER BY "score" DESC,"durationMilliseconds" ASC)::integer AS rank FROM results
          )
          SELECT rank,"displayName","score","totalQuestions",
            round("score"::numeric/"totalQuestions"*100,2)::double precision AS percentage,
            "durationMilliseconds",("userId"=${userId}::uuid) AS "isYou"
          FROM ranked ORDER BY rank,"id" LIMIT 20 OFFSET ${(page - 1) * 20}
        `);

        return {
          page,
          pageSize: 20,
          total,
          updating: pending > 0,
          closed: !!cutoff && cutoff <= now,
          entries,
        };
      });
    },
  };
}
