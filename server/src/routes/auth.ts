import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { ApiError } from '../lib/errors';
import { asyncHandler, ok } from '../lib/http';
import { authLimiter } from '../middleware/rateLimit';
import { requireAuth, signSession } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createRepository } from '../repo';
import { loginSchema, passwordResetConfirmSchema, passwordResetRequestSchema, registerSchema } from '../schemas';
import { env } from '../env';
import { logger } from '../lib/logger';
import { sendMail } from '../services/email';
import { recordServerEvent } from '../services/analytics/collect';

const SESSION_COOKIE = 'echoes_session';
const RESET_TTL_MINUTES = 60;

/**
 * Only the hash of a reset token is stored, so the database never holds anything
 * that can be turned back into a working link. Hashing is deterministic here
 * because lookup happens by hash — the token's own entropy is the secret.
 */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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
    const { email, name, password, role } = req.body as {
      email: string;
      name: string;
      password: string;
      role?: 'visitor' | 'organizer';
    };
    const repo = createRepository();
    const existing = await repo.getUserByEmail(email);
    if (existing) throw ApiError.conflict('An account with that email already exists.');

    const normalizedRole = role === 'organizer' ? 'organizer' : 'visitor';
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await repo.createUser({ email, name, passwordHash, role: normalizedRole });
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
    // Recorded server-side: the browser cannot claim an account was created.
    await recordServerEvent(repo, 'user_registered', { userId: user.id, path: '/auth/register' });

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

    // Checked only after the password matched, so a suspended account is not
    // disclosed to someone who does not already hold its credentials.
    if (user.status === 'suspended') {
      throw ApiError.forbidden(
        'This account is suspended. Contact an administrator if you believe that is a mistake.',
      );
    }

    const session = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = signSession(session);
    setSessionCookie(res, token);

    await recordServerEvent(repo, 'user_login', { userId: user.id, path: '/auth/login' });

    ok(res, { user: session, token });
  }),
);

authRouter.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    if (req.user) {
      await recordServerEvent(createRepository(), 'user_logout', {
        userId: req.user.id,
        path: '/auth/logout',
      });
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    ok(res, { message: 'Signed out.' });
  }),
);

/**
 * The client calls this on load. Returning the *current* status means a session
 * issued before a suspension stops working as soon as the app checks in, instead
 * of staying valid until the stateless token expires.
 */
authRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const repo = createRepository();
    const fresh = await repo.getUserById(req.user!.id);
    if (fresh?.status === 'suspended') {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      throw ApiError.forbidden('This account is suspended.');
    }
    ok(res, { user: { ...req.user, status: fresh?.status ?? 'active' } });
  }),
);

/**
 * Requests a reset link. The response is deliberately identical whether or not
 * the address belongs to an account: telling an anonymous caller which emails are
 * registered is a disclosure, and this endpoint is public.
 */
authRouter.post(
  '/auth/password-reset/request',
  authLimiter,
  validateBody(passwordResetRequestSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    const repo = createRepository();
    const user = await repo.getUserByEmail(email);

    const acknowledgement = {
      message: 'If an account exists for that address, a reset link is on its way.',
      expiresInMinutes: RESET_TTL_MINUTES,
    };

    if (!user) {
      ok(res, acknowledgement);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString();
    const reset = await repo.createPasswordReset({
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt,
    });

    const link = `${env.appBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    const result = await sendMail({
      to: user.email,
      subject: 'Reset your ECHOES password',
      // Tied to the stored reset, so a retried request cannot send twice.
      idempotencyKey: `password-reset-${reset.id}`,
      text: [
        `Hello ${user.name},`,
        '',
        'Someone asked to reset the password for this ECHOES account. If that was you, open this link:',
        '',
        link,
        '',
        `The link expires in ${RESET_TTL_MINUTES} minutes and can only be used once.`,
        'If you did not ask for this, you can ignore this message — your password has not changed.',
      ].join('\n'),
    });

    await repo.appendAudit({
      actor: user.email,
      action: 'user.password_reset_requested',
      entityType: 'user',
      entityId: user.id,
      details: {
        accepted: result.accepted,
        delivered: result.delivered,
        sandbox: result.sandbox,
        transport: result.transport,
      },
    });

    if (!result.delivered) {
      // The caller is told nothing (that would leak which addresses exist), so the
      // operator needs the warning: a reset that never arrives looks exactly like
      // one that was delivered. A sandbox send is the most likely cause.
      logger.warn(
        { email: user.email, transport: result.transport, sandbox: result.sandbox, reason: result.reason },
        'password reset email was not delivered',
      );
    }

    ok(res, acknowledgement);
  }),
);

/** Completes a reset with a single-use token. */
authRouter.post(
  '/auth/password-reset/confirm',
  authLimiter,
  validateBody(passwordResetConfirmSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as { token: string; password: string };
    const repo = createRepository();
    const tokenHash = hashResetToken(token);
    const reset = await repo.getPasswordReset(tokenHash);

    // Compared in constant time so a wrong-but-near token cannot be probed.
    const presented = Buffer.from(tokenHash, 'utf8');
    const stored = Buffer.from(reset?.tokenHash ?? '', 'utf8');
    const matches = stored.length === presented.length && timingSafeEqual(stored, presented);

    if (!reset || !matches) {
      throw new ApiError(400, 'invalid_reset_token', 'That reset link is not valid.');
    }
    if (reset.usedAt) {
      throw new ApiError(400, 'reset_token_used', 'That reset link has already been used.');
    }
    if (new Date(reset.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(
        400,
        'reset_token_expired',
        'That reset link has expired. Request a new one.',
      );
    }

    await repo.updateUserPassword(reset.userId, await bcrypt.hash(password, 12));
    await repo.consumePasswordReset(reset.id, reset.userId);
    await repo.appendAudit({
      actor: 'system',
      action: 'user.password_reset_completed',
      entityType: 'user',
      entityId: reset.userId,
      details: null,
    });

    // Sessions are stateless JWTs, so an already-signed-in session elsewhere stays
    // valid until it expires. Revoking those needs a token denylist.
    ok(res, { message: 'Password updated. You can sign in with the new password.' });
  }),
);
