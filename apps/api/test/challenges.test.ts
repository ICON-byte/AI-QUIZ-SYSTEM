import { describe, it, expect } from 'vitest';
import {
  createInvitation,
  readInvitation,
  invitationHash,
} from '../src/modules/challenges/invitations.js';
import { challengeSchema } from '../src/modules/challenges/validation.js';
import { loadConfig } from '../src/config/env.js';
describe('challenge invitation encryption and validation', () => {
  it('uses authenticated, quiz-bound encryption and independent random invitations', () => {
    const key = 'b'.repeat(64),
      id = 'first-quiz',
      sealed = createInvitation(key, id),
      again = createInvitation(key, id),
      code = readInvitation(key, id, sealed.sealed);
    expect(code).toMatch(/^[A-F0-9]{24}$/);
    expect(invitationHash(code)).toBe(sealed.hash);
    expect(again.hash).not.toBe(sealed.hash);
    expect(again.sealed).not.toBe(sealed.sealed);
    expect(() => readInvitation('c'.repeat(64), id, sealed.sealed)).toThrow();
    expect(() => readInvitation(key, 'other-quiz', sealed.sealed)).toThrow();
    const tampered = Buffer.from(sealed.sealed, 'base64');
    tampered[30] = tampered[30]! ^ 1;
    expect(() =>
      readInvitation(key, id, tampered.toString('base64')),
    ).toThrow();
  });
  it('requires a separate configured key and rejects invalid schedules or extra fields', () => {
    expect(() => createInvitation('', 'quiz')).toThrow();
    expect(() =>
      challengeSchema.parse({ title: 'x', closesAt: 'tomorrow' }),
    ).toThrow();
    expect(() =>
      challengeSchema.parse({ title: 'x', mode: 'ASSESSMENT' }),
    ).toThrow();
    expect(challengeSchema.parse({ title: 'No schedule' }).closesAt).toBeNull();
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://localhost/test',
        JWT_SECRET: 'a'.repeat(64),
        CHALLENGE_INVITE_KEY: 'a'.repeat(64),
      }),
    ).toThrow();
  });
});
