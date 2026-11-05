import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { registerSchema } from '../src/modules/auth/validation.js';
import { signAccess, verifyAccess } from '../src/modules/auth/tokens.js';

const input = { DATABASE_URL: 'postgresql://localhost/test', JWT_SECRET: 'a'.repeat(48) };

describe('configuration and validation', () => {
  it('rejects placeholder secrets and avoids echoing credentials', () => {
    expect(() => loadConfig({ ...input, JWT_SECRET: 'replace-with-at-least-32-random-characters' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ ...input, DATABASE_URL: 'private-password' })).not.toThrow('private-password');
  });
  it('requires HTTPS and a strict origin in production', () => {
    expect(() => loadConfig({ ...input, NODE_ENV: 'production' })).toThrow('APP_ORIGIN');
    expect(() => loadConfig({ ...input, APP_ORIGIN: 'http://localhost:5173/' })).toThrow('APP_ORIGIN');
  });
  it('normalizes email, rejects role escalation and bcrypt truncation', () => {
    const valid = { email: ' Student@Example.edu ', displayName: 'Ada Okoro', password: 'a-long-safe-passphrase', ageConfirmed: true, role: 'STUDENT' };
    expect(registerSchema.parse(valid).email).toBe('student@example.edu');
    expect(registerSchema.safeParse({ ...valid, ageConfirmed: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, ageConfirmed: undefined }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, role: 'ADMIN' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, verificationStatus: 'APPROVED' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'é'.repeat(40) }).success).toBe(false);
  });
  it('accepts only correctly signed access tokens', () => {
    const config = loadConfig(input);
    const id = '11111111-1111-4111-8111-111111111111';
    const token = signAccess(id, id, config);
    expect(verifyAccess(token, config)).toEqual({ userId: id, sessionId: id });
    expect(verifyAccess(token + 'tampered', config)).toBeNull();
    expect(verifyAccess(token, { ...config, JWT_SECRET: 'b'.repeat(48) })).toBeNull();
  });
});
