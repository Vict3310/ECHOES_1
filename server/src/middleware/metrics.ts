import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { createRepository } from '../repo';
import type { RequestMetricRecord } from '../repo/types';
import { latencyBucketIndex, emptyHistogram } from '../services/analytics/aggregate';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a response with its log lines; never a user identifier. */
      requestId?: string;
    }
  }
}

/** Paths that say nothing about product health and would swamp the aggregates. */
const IGNORED_PATHS = new Set(['/api/health', '/favicon.ico', '/robots.txt']);

const ROLLUP_INTERVAL_MS = 15_000;

/**
 * Per-minute buckets keyed by `bucket|route|method`.
 *
 * A row per request would dwarf the product tables within days, so requests are
 * folded into minute buckets in memory and written every 15 seconds. Latency is
 * kept as a fixed-bucket histogram, which is what makes an exact-enough p95
 * recomputable for any date range without storing an individual request.
 */
const pending = new Map<string, RequestMetricRecord & { hist: number[] }>();
let flushTimer: NodeJS.Timeout | null = null;

export interface RecentError {
  at: string;
  route: string;
  method: string;
  status: number;
  code: string;
  requestId: string | null;
  message: string;
}

const recentErrors: RecentError[] = [];
const RECENT_ERROR_LIMIT = 50;

export function recentServerErrors(limit = 20): RecentError[] {
  return recentErrors.slice(0, limit);
}

/** Test helper: clears in-memory metrics and error history. */
export function resetRequestMetrics(): void {
  pending.clear();
  recentErrors.length = 0;
}

function routeKey(req: Request): string {
  const base = req.baseUrl ?? '';
  const path = req.route?.path;
  if (typeof path === 'string') {
    return `${base}${path === '/' ? '' : path}` || path;
  }
  if (Array.isArray(req.route?.path)) {
    return `${base}${String(req.route.path[0])}`;
  }
  // Nothing matched; the raw path is kept bounded and stripped of query strings.
  return `unmatched:${(req.path ?? '').slice(0, 80)}`;
}

function minuteBucket(at: Date): string {
  const truncated = new Date(at);
  truncated.setUTCSeconds(0, 0);
  return truncated.toISOString();
}

/**
 * Adds a correlation id to every request and folds the finished response into
 * the minute bucket for its route.
 */
export function requestMetrics(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9._:-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const path = req.path ?? '';
      if (IGNORED_PATHS.has(path)) return;
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const bucket = minuteBucket(new Date());
      const route = routeKey(req);
      const method = req.method;
      const key = `${bucket}|${route}|${method}`;
      const existing = pending.get(key) ?? {
        bucket,
        route,
        method,
        count: 0,
        serverErrors: 0,
        clientErrors: 0,
        latencySumMs: 0,
        latencyMaxMs: 0,
        histogram: emptyHistogram(),
        hist: emptyHistogram(),
      };
      existing.count += 1;
      if (res.statusCode >= 500) existing.serverErrors += 1;
      else if (res.statusCode >= 400) existing.clientErrors += 1;
      existing.latencySumMs += latencyMs;
      existing.latencyMaxMs = Math.max(existing.latencyMaxMs, latencyMs);
      const index = latencyBucketIndex(latencyMs);
      existing.hist[index] = (existing.hist[index] ?? 0) + 1;
      pending.set(key, existing);
    } catch (error) {
      logger.warn({ err: error }, 'could not record request metrics');
    }
  });

  scheduleFlush();
  next();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushRequestMetrics();
  }, ROLLUP_INTERVAL_MS);
  // Never keep the process alive just to write metrics.
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/** Writes the accumulated buckets. Safe to call at any time, including on shutdown. */
export async function flushRequestMetrics(): Promise<number> {
  if (pending.size === 0) return 0;
  const rows: RequestMetricRecord[] = [];
  for (const [key, value] of pending) {
    rows.push({
      bucket: value.bucket,
      route: value.route,
      method: value.method,
      count: value.count,
      serverErrors: value.serverErrors,
      clientErrors: value.clientErrors,
      latencySumMs: Math.round(value.latencySumMs),
      latencyMaxMs: Math.round(value.latencyMaxMs),
      histogram: value.hist,
    });
    pending.delete(key);
  }

  try {
    await createRepository().recordRequestMetrics(rows);
    return rows.length;
  } catch (error) {
    // Keep the rows so the next flush can try again, unless the backlog is huge.
    logger.warn({ err: error, rows: rows.length }, 'could not persist request metrics');
    for (const row of rows) {
      if (pending.size > 5_000) break;
      const key = `${row.bucket}|${row.route}|${row.method}`;
      if (pending.has(key)) continue;
      pending.set(key, { ...row, hist: row.histogram });
    }
    return 0;
  }
}

/**
 * Remembers a server failure for the health view.
 *
 * Only the API's own error codes and messages are kept — an unexpected exception
 * would otherwise risk copying infrastructure detail into a page that
 * administrators read. The correlation id is what links a row here to the full
 * stack trace in the structured logs.
 */
export function recordServerError(input: {
  req: Request;
  status: number;
  code: string;
  message: string;
}): void {
  if (recentErrors.length >= RECENT_ERROR_LIMIT) recentErrors.pop();
  recentErrors.unshift({
    at: new Date().toISOString(),
    route: `${input.req.baseUrl ?? ''}${input.req.path ?? ''}`.slice(0, 120),
    method: input.req.method,
    status: input.status,
    code: input.code,
    requestId: input.req.requestId ?? null,
    message: input.message.slice(0, 200),
  });
}
