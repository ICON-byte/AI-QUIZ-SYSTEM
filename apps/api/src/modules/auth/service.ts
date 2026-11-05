import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { z } from 'zod';
import type { Config } from '../../config/env.js';
import type { Database } from '../../infrastructure/database.js';
import { Prisma, type LecturerVerification, type User } from '../../generated/prisma/client.js';
import { HttpError } from '../../middleware/errors.js';
import type { registerSchema, loginSchema } from './validation.js';
import { newRefreshToken, tokenHash, signAccess } from './tokens.js';

export function publicUser(user: User & { verification: LecturerVerification | null }) {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role,
    verificationStatus: user.verification?.status ?? null, createdAt: user.createdAt.toISOString(), ageConfirmed: !!user.adultConfirmedAt };
}

const invalidSession = () => new HttpError(401, 'SESSION_EXPIRED', 'Please sign in again.');
const invalidLogin = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

export function createAuthService(db: Database, config: Config) {
  // Equal-cost password verification for unknown accounts; initialized before listening.
  const dummyHash = bcrypt.hash(newRefreshToken(), config.BCRYPT_ROUNDS);

  async function createSession(userId: string) {
    const refreshToken = newRefreshToken();
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 86_400_000);
    const session = await db.refreshSession.create({ data: {
      id: familyId, userId, tokenHash: tokenHash(refreshToken), familyId, expiresAt
    } });
    return { refreshToken, accessToken: signAccess(userId, session.id, config), expiresAt };
  }

  return {
    ready: dummyHash.then(() => undefined),
    async register(input: z.infer<typeof registerSchema>) {
      const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
      try {
        const user = await db.user.create({ data: {
          email: input.email, displayName: input.displayName, role: input.role, passwordHash, adultConfirmedAt: new Date(),
          ...(input.role === 'LECTURER' ? { verification: { create: {} } } : {})
        }, include: { verification: true } });
        return { user: publicUser(user), ...await createSession(user.id) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new HttpError(409, 'REGISTRATION_UNAVAILABLE', 'An account with this email already exists. Try signing in.');
        }
        throw error;
      }
    },
    async login(input: z.infer<typeof loginSchema>) {
      const user = await db.user.findUnique({ where: { email: input.email }, include: { verification: true } });
      const valid = await bcrypt.compare(input.password, user?.passwordHash ?? await dummyHash);
      if (!valid || !user || user.status !== 'ACTIVE') throw invalidLogin();
      return { user: publicUser(user), ...await createSession(user.id) };
    },
    async refresh(rawToken: unknown) {
      if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(rawToken)) throw invalidSession();
      const refreshToken = newRefreshToken();
      const result = await db.$transaction(async tx => {
        let old = await tx.refreshSession.findUnique({ where: { tokenHash: tokenHash(rawToken) }, include: { user: { include: { verification: true } } } });
        if (!old) return null;
        // Every rotation/logout locks the same root row, including after rotation.
        // This prevents logout racing a newly inserted refresh session.
        await tx.refreshSession.update({ where: { id: old.familyId }, data: { familyId: old.familyId } });
        old = await tx.refreshSession.findUnique({ where: { id: old.id }, include: { user: { include: { verification: true } } } });
        if (!old) return null;
        const now = new Date();
        if (old.revokedAt || old.expiresAt <= now || old.user.status !== 'ACTIVE') {
          await tx.refreshSession.updateMany({ where: { familyId: old.familyId, revokedAt: null }, data: { revokedAt: now } });
          return null;
        }
        const claimed = await tx.refreshSession.updateMany({
          where: { id: old.id, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now }
        });
        if (claimed.count !== 1) {
          // A concurrent rotation or replay invalidates this entire session family.
          await tx.refreshSession.updateMany({ where: { familyId: old.familyId, revokedAt: null }, data: { revokedAt: now } });
          return null;
        }
        const next = await tx.refreshSession.create({ data: {
          userId: old.userId, familyId: old.familyId, tokenHash: tokenHash(refreshToken), expiresAt: old.expiresAt
        } });
        return { user: publicUser(old.user), id: next.id, expiresAt: old.expiresAt };
      });
      // Throw outside the transaction so replay revocation is committed.
      if (!result) throw invalidSession();
      return { user: result.user, refreshToken, accessToken: signAccess(result.user.id, result.id, config), expiresAt: result.expiresAt };
    },
    async logout(rawToken: unknown) {
      if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(rawToken)) return;
      await db.$transaction(async tx => {
        const session = await tx.refreshSession.findUnique({ where: { tokenHash: tokenHash(rawToken) } });
        if (!session) return;
        await tx.refreshSession.update({ where: { id: session.familyId }, data: { familyId: session.familyId } });
        await tx.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      });
    }
  };
}
