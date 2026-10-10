import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env';
import { ApiError } from '../lib/errors';

export type Role = 'visitor' | 'contributor' | 'organizer' | 'moderator' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function signSession(user: SessionUser): string {
  return jwt.sign(user, env.sessionSecret, { expiresIn: '7d', algorithm: 'HS256' });
}

export function verifySession(token: string): SessionUser | null {
  try {
    const payload = jwt.verify(token, env.sessionSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'string') return null;
    const { id, email, name, role } = payload as Record<string, unknown>;
    if (typeof id !== 'string' || typeof email !== 'string' || typeof name !== 'string') return null;
    return { id, email, name, role: (role as Role) ?? 'visitor' };
  } catch {
    return null;
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('echoes_session='));
    if (match) return decodeURIComponent(match.slice('echoes_session='.length));
  }
  return null;
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (token) {
    const user = verifySession(token);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(ApiError.unauthorized());
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    const allowed = roles.includes('admin') ? req.user.role === 'admin' || roles.includes(req.user.role) : roles.includes(req.user.role);
    if (!allowed) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}

/**
 * Administrative endpoints are gated by a shared token when no user session is
 * present, so moderation tooling can be exercised without standing up accounts.
 * When the token is not configured, access is refused rather than allowed.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'moderator')) {
    next();
    return;
  }
  if (!env.adminApiToken) {
    next(
      ApiError.serviceUnavailable(
        'admin_not_configured',
        'ADMIN_API_TOKEN is not set and no moderator session was supplied. Administrative access is refused.',
      ),
    );
    return;
  }
  const supplied = req.header('x-admin-token');
  if (!supplied || supplied !== env.adminApiToken) {
    next(ApiError.forbidden('A valid administrator token is required.'));
    return;
  }
  next();
}
