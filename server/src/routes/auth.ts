import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { authLimiter } from '../middleware/rateLimit';
import { requireAuth, signSession } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { loginSchema, registerSchema } from '../schemas';

const SESSION_COOKIE = 'echoes_session';

export const authRouter = Router();

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

authRouter.post(
  '/auth/register',
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, name, password } = req.body as { email: string; name: string; password: string };
    const repo = createRepository();
    const existing = await repo.getUserByEmail(email);
    if (existing) throw ApiError.conflict('An account with that email already exists.');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await repo.createUser({ email, name, passwordHash, role: 'contributor' });
    const session = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = signSession(session);
    setSessionCookie(res, token);

    await repo.appendAudit({
      actor: user.email,
      action: 'user.registered',
      entityType: 'user',
      entityId: user.id,
      details: null,
    });

    ok(res, { user: session, token }, 201);
  }),
);

authRouter.post(
  '/auth/login',
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const repo = createRepository();
    const user = await repo.getUserByEmail(email);
    // Constant-ish work whether or not the account exists.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) throw ApiError.unauthorized('Those credentials are not valid.');

    const session = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = signSession(session);
    setSessionCookie(res, token);

    ok(res, { user: session, token });
  }),
);

authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  ok(res, { message: 'Signed out.' });
});

authRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, { user: req.user });
  }),
);
