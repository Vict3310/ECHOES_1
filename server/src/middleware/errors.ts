import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors';
import { logger } from '../lib/logger';
import { recordServerError } from './metrics';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route matches ${req.method} ${req.path}.` },
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      logger.error({ code: error.code, path: req.path, details: error.details }, error.message);
      // Only our own error text reaches the health view: an unexpected exception
      // could otherwise copy infrastructure detail onto a page people read.
      recordServerError({ req, status: error.status, code: error.code, message: error.message });
    } else {
      logger.warn({ code: error.code, path: req.path }, error.message);
    }
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details ?? undefined },
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error.';
  logger.error({ err: error, path: req.path, requestId: req.requestId }, 'Unhandled error');
  recordServerError({
    req,
    status: 500,
    code: 'internal_error',
    message: 'Unhandled server error. Search the logs for this correlation id for the stack trace.',
  });
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on the server. The failure has been logged.',
      details: process.env.NODE_ENV === 'production' ? undefined : message,
    },
  });
}
