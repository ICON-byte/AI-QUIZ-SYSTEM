import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database.js';
import { createApp } from '../src/app.js';
import { verifyLecturer } from '../src/modules/users/verification.js';
import { tokenHash, signAccess } from '../src/modules/auth/tokens.js';

// Direct execution against an arbitrary configured database is deliberately refused.
const config = loadConfig();
if (!/^auth_test_[a-f0-9]{16}$/.test(process.env.TEST_SCHEMA ?? '') || new URL(config.DATABASE_URL).searchParams.get('schema') !== process.env.TEST_SCHEMA) {
  throw new Error('Use npm run test:integration to create an isolated PostgreSQL test schema.');
}
const db = createDatabase(config.DATABASE_URL);
const { app, ready } = createApp(db, config);
const origin = config.APP_ORIGIN;
const credentials = { email: 'student@example.edu', displayName: 'Ada Okoro', ageConfirmed: true, role: 'STUDENT', password: 'a-long-test-passphrase' };

function post(path: string, body: object = {}) {
  return request(app).post(`/api/v1${path}`).set('Origin', origin).set('X-CSRF-Protection', '1').send(body);
}
function cookies(response: request.Response) {
  const value = response.headers['set-cookie'] as unknown as string[];
  return value.map(cookie => cookie.split(';')[0]!);
}
const cookieValue = (values: string[], name: string) => values.find(value => value.startsWith(`${name}=`))!.slice(name.length + 1);

beforeAll(async () => { await db.$connect(); await ready; });
afterAll(async () => { await db.$disconnect(); });

describe.sequential('PostgreSQL authentication and authorization', () => {
  let studentCookies: string[];
  let lecturerCookies: string[];
  let lecturerId: string;

  it('registers a normalized student with a hashed password and private cookies', async () => {
    const response = await post('/auth/register', { ...credentials, email: ' Student@Example.edu ' });
    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(credentials.email);
    expect(response.body.user.verificationStatus).toBeNull();
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.headers['cache-control']).toBe('no-store');
    studentCookies = cookies(response);
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('HttpOnly'), expect.stringContaining('SameSite=Lax')]));
    const user = await db.user.findUniqueOrThrow({ where: { email: credentials.email } });
    expect(user.passwordHash).toMatch(/^\$2[ab]\$/);
    expect(user.passwordHash).not.toContain(credentials.password);
    const session = await db.refreshSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toBe(tokenHash(cookieValue(studentCookies, 'quiz_refresh')));
  });

  it('prevents duplicate normalized accounts, including concurrent registrations', async () => {
    expect((await post('/auth/register', credentials)).status).toBe(409);
    const results = await Promise.all([1, 2].map(() => post('/auth/register', { ...credentials, email: 'race@example.edu' })));
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await db.user.count({ where: { email: 'race@example.edu' } })).toBe(1);
  });

  it('rejects mass assignment, invalid roles, weak and oversized passwords', async () => {
    for (const value of [
      { ...credentials, role: 'ADMIN' }, { ...credentials, password: 'short' },
      { ...credentials, status: 'ACTIVE' }, { ...credentials, password: 'é'.repeat(40) }
    ]) expect((await post('/auth/register', value)).status).toBe(400);
  });

  it('enforces browser request origin, custom CSRF header and body constraints', async () => {
    expect((await request(app).post('/api/v1/auth/login').send(credentials)).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/login').set('Origin', 'https://attacker.invalid').set('X-CSRF-Protection', '1').send(credentials)).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/login').set('Origin', origin).set('X-CSRF-Protection', '1').set('Content-Type', 'application/json').send('{bad')).status).toBe(400);
    expect((await post('/auth/login', { oversized: 'x'.repeat(20_000) })).status).toBe(413);
  });

  it('uses generic failures for missing accounts and incorrect passwords', async () => {
    const wrong = await post('/auth/login', { email: credentials.email, password: 'incorrect-passphrase' });
    const missing = await post('/auth/login', { email: 'missing@example.edu', password: 'incorrect-passphrase' });
    expect(wrong.status).toBe(401);
    expect(missing.body.error).toEqual(wrong.body.error);
  });

  it('requires authentication and enforces dashboard roles on the server', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/dashboard/student').set('Cookie', studentCookies)).status).toBe(200);
    expect((await request(app).get('/api/v1/dashboard/lecturer').set('Cookie', studentCookies)).status).toBe(403);
    expect((await request(app).get('/api/v1/lecturer/eligibility').set('Cookie', studentCookies)).status).toBe(403);
  });

  it('registers lecturers as pending and refuses official eligibility', async () => {
    const response = await post('/auth/register', { ...credentials, email: 'lecturer@example.edu', role: 'LECTURER' });
    expect(response.status).toBe(201);
    lecturerCookies = cookies(response);
    lecturerId = response.body.user.id;
    expect(response.body.user.verificationStatus).toBe('PENDING');
    expect((await request(app).get('/api/v1/dashboard/lecturer').set('Cookie', lecturerCookies)).status).toBe(200);
    expect((await request(app).get('/api/v1/dashboard/student').set('Cookie', lecturerCookies)).status).toBe(403);
    expect((await request(app).get('/api/v1/lecturer/eligibility').set('Cookie', lecturerCookies)).status).toBe(403);
  });

  it('audits operator decisions and reads changed permissions without a new login', async () => {
    const input = { email: 'lecturer@example.edu', actor: 'test-operator', reason: 'Confirmed staff appointment', decision: 'approve' as const };
    await verifyLecturer(db, input);
    expect((await request(app).get('/api/v1/lecturer/eligibility').set('Cookie', lecturerCookies)).status).toBe(200);
    const event = await db.auditEvent.findFirstOrThrow({ where: { resourceId: lecturerId } });
    expect(event.actor).toBe(input.actor);
    expect(event.reason).toBe(input.reason);
    await verifyLecturer(db, { ...input, decision: 'reject' });
    expect((await request(app).get('/api/v1/lecturer/eligibility').set('Cookie', lecturerCookies)).status).toBe(403);
    await expect(verifyLecturer(db, { ...input, email: credentials.email })).rejects.toThrow('active lecturer');
  });

  it('rotates refresh tokens and revokes the family on replay', async () => {
    const login = await post('/auth/login', { email: credentials.email, password: credentials.password });
    expect(login.status).toBe(200);
    const previous = cookies(login);
    const refresh = await post('/auth/refresh').set('Cookie', previous);
    expect(refresh.status).toBe(200);
    const next = cookies(refresh);
    expect(cookieValue(next, 'quiz_refresh')).not.toBe(cookieValue(previous, 'quiz_refresh'));
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', previous)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', next)).status).toBe(200);
    expect((await post('/auth/refresh').set('Cookie', previous)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', next)).status).toBe(401);
    expect((await post('/auth/refresh').set('Cookie', next)).status).toBe(401);
  });

  it('allows only one concurrent rotation and revokes replayed family', async () => {
    const login = await post('/auth/login', { email: credentials.email, password: credentials.password });
    const previous = cookies(login);
    const results = await Promise.all([1, 2].map(() => post('/auth/refresh').set('Cookie', previous)));
    expect(results.map(result => result.status).sort()).toEqual([200, 401]);
    const successful = results.find(result => result.status === 200)!;
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookies(successful))).status).toBe(401);
  });

  it('logs out idempotently and immediately rejects copied access/refresh cookies', async () => {
    const login = await post('/auth/login', { email: credentials.email, password: credentials.password });
    const values = cookies(login);
    const response = await post('/auth/logout').set('Cookie', values);
    expect(response.status).toBe(204);
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('Expires=Thu, 01 Jan 1970')]));
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', values)).status).toBe(401);
    expect((await post('/auth/refresh').set('Cookie', values)).status).toBe(401);
    expect((await post('/auth/logout')).status).toBe(204);
  });

  it('does not leave a live session when refresh races logout', async () => {
    const login = await post('/auth/login', { email: credentials.email, password: credentials.password });
    const values = cookies(login);
    const [rotation, logout] = await Promise.all([
      post('/auth/refresh').set('Cookie', values), post('/auth/logout').set('Cookie', values)
    ]);
    expect(logout.status).toBe(204);
    expect([200, 401]).toContain(rotation.status);
    if (rotation.status === 200) {
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookies(rotation))).status).toBe(401);
    }
    const root = await db.refreshSession.findUniqueOrThrow({ where: { tokenHash: tokenHash(cookieValue(values, 'quiz_refresh')) } });
    expect(await db.refreshSession.count({ where: { familyId: root.familyId, revokedAt: null } })).toBe(0);
  });

  it('enforces absolute session expiry and disabled account state', async () => {
    const login = await post('/auth/login', { email: credentials.email, password: credentials.password });
    const values = cookies(login);
    await db.refreshSession.update({ where: { tokenHash: tokenHash(cookieValue(values, 'quiz_refresh')) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', values)).status).toBe(401);
    expect((await post('/auth/refresh').set('Cookie', values)).status).toBe(401);
    const user = await db.user.findUniqueOrThrow({ where: { email: credentials.email } });
    await db.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', studentCookies)).status).toBe(401);
    expect((await post('/auth/login', { email: credentials.email, password: credentials.password })).status).toBe(401);
  });

  it('rejects forged tokens and malformed refresh values safely', async () => {
    const forged = signAccess(lecturerId, lecturerId, { ...config, JWT_SECRET: 'different-secret'.repeat(4) });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', `quiz_access=${forged}`)).status).toBe(401);
    expect((await post('/auth/refresh').set('Cookie', 'quiz_refresh=invalid')).status).toBe(401);
    expect((await request(app).get('/api/v1/does-not-exist')).status).toBe(404);
  });

  it('rate limits repeated authentication attempts', async () => {
    const statuses = [];
    for (let index = 0; index < 22; index++) statuses.push((await post('/auth/login', { email: 'invalid', password: '' })).status);
    expect(statuses).toContain(429);
  });
});
