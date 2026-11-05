import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { HttpError } from '../../middleware/errors.js';
export const invitationHash = (code: string) =>
  createHash('sha256').update(code).digest('hex');
function keyBytes(key: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(key))
    throw new HttpError(
      503,
      'CHALLENGE_UNAVAILABLE',
      'Challenge sharing is unavailable until the operator configures its encryption key.',
    );
  return Buffer.from(key, 'hex');
}
export function createInvitation(key: string, quizId: string) {
  const bytes = keyBytes(key),
    code = randomBytes(12).toString('hex').toUpperCase(),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bytes, iv);
  cipher.setAAD(Buffer.from(quizId));
  const encrypted = Buffer.concat([
    cipher.update(code, 'utf8'),
    cipher.final(),
  ]);
  return {
    hash: invitationHash(code),
    sealed: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64',
    ),
  };
}
export function readInvitation(key: string, quizId: string, sealed: string) {
  const bytes = keyBytes(key);
  try {
    const payload = Buffer.from(sealed, 'base64');
    if (payload.length !== 52) throw Error('Invalid envelope');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      bytes,
      payload.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(quizId));
    decipher.setAuthTag(payload.subarray(12, 28));
    const code = Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
    if (!/^[A-F0-9]{24}$/.test(code)) throw Error('Invalid invitation');
    return code;
  } catch {
    throw new HttpError(
      503,
      'INVITATION_UNAVAILABLE',
      'The invitation could not be opened. Ask the operator to check the challenge encryption key.',
    );
  }
}
