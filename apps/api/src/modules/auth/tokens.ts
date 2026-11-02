import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Config } from '../../config/env.js';

export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const newRefreshToken = () => randomBytes(48).toString('base64url');

export function signAccess(userId: string, sessionId: string, config: Config) {
  return jwt.sign({ sid: sessionId }, config.JWT_SECRET, {
    algorithm: 'HS256', subject: userId, issuer: 'ai-quiz-api', audience: 'ai-quiz-web',
    expiresIn: config.ACCESS_TOKEN_MINUTES * 60
  });
}

export function verifyAccess(token: string, config: Config): { userId: string; sessionId: string } | null {
  try {
    const value = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], issuer: 'ai-quiz-api', audience: 'ai-quiz-web' });
    if (typeof value === 'string' || typeof value.sub !== 'string' || typeof value.sid !== 'string') return null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(value.sub) || !uuid.test(value.sid)) return null;
    return { userId: value.sub, sessionId: value.sid };
  } catch {
    return null;
  }
}
