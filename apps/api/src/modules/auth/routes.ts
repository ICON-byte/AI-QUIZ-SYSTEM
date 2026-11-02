import { Router, type CookieOptions, type Response } from 'express';
import type { Config } from '../../config/env.js';
import type { Database } from '../../infrastructure/database.js';
import { createAuthService, publicUser } from './service.js';
import { authenticate } from './authorization.js';
import { loginSchema, registerSchema } from './validation.js';

export function authRoutes(db: Database, config: Config) {
  const router = Router();
  const service = createAuthService(db, config);
  const base: CookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' };
  const accessOptions = { ...base, path: '/api' };
  const refreshOptions = { ...base, path: '/api/v1/auth' };
  function setCookies(res: Response, result: Awaited<ReturnType<typeof service.login>>) {
    res.cookie('quiz_access', result.accessToken, { ...accessOptions, maxAge: config.ACCESS_TOKEN_MINUTES * 60_000 });
    res.cookie('quiz_refresh', result.refreshToken, { ...refreshOptions, expires: result.expiresAt });
  }
  function clearCookies(res: Response) {
    res.clearCookie('quiz_access', accessOptions);
    res.clearCookie('quiz_refresh', refreshOptions);
  }

  router.post('/register', async (req, res) => {
    const result = await service.register(registerSchema.parse(req.body));
    setCookies(res, result);
    res.status(201).json({ user: result.user });
  });
  router.post('/login', async (req, res) => {
    const result = await service.login(loginSchema.parse(req.body));
    setCookies(res, result);
    res.json({ user: result.user });
  });
  router.post('/refresh', async (req, res, next) => {
    try {
      const result = await service.refresh(req.cookies?.quiz_refresh);
      setCookies(res, result);
      res.json({ user: result.user });
    } catch (error) {
      clearCookies(res);
      next(error);
    }
  });
  router.post('/logout', async (req, res) => {
    await service.logout(req.cookies?.quiz_refresh);
    clearCookies(res);
    res.status(204).end();
  });
  router.get('/me', authenticate(db, config), (req, res) => res.json({ user: publicUser(req.auth!.user) }));
  return { router, ready: service.ready };
}
