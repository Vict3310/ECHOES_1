import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Forwards rejected promises to the Express error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}
