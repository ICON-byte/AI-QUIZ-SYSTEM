import type { RequestHandler } from 'express';
import type { Config } from '../../config/env.js';
import type { Database } from '../../infrastructure/database.js';
import type { Role } from '../../generated/prisma/client.js';
import { HttpError } from '../../middleware/errors.js';
import { verifyAccess } from './tokens.js';

export function authenticate(db: Database, config: Config): RequestHandler {
  return async (req, _res, next) => {
    const raw = req.cookies?.quiz_access;
    const claims = typeof raw === 'string' ? verifyAccess(raw, config) : null;
    if (!claims) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    const session = await db.refreshSession.findUnique({ where: { id: claims.sessionId }, include: { user: { include: { verification: true } } } });
    if (!session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      throw new HttpError(401, 'SESSION_EXPIRED', 'Please sign in again.');
    }
    req.auth = { user: session.user, sessionId: session.id };
    next();
  };
}

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    if (req.auth.user.role !== role) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this area.');
    next();
  };
}

export const requireVerifiedLecturer: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  if (req.auth.user.role !== 'LECTURER' || req.auth.user.verification?.status !== 'APPROVED') {
    throw new HttpError(403, 'LECTURER_NOT_VERIFIED', 'Lecturer verification is required.');
  }
  next();
};
