import { createHash, randomUUID } from 'node:crypto';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import type { Repository } from '../../repo/types';
import {
  MAX_EVENT_AGE_MS,
  MAX_FUTURE_DRIFT_MS,
  SESSION_INACTIVITY_MINUTES,
  classifyDevice,
  validateIngestEvent,
  type AnalyticsEventRecord,
  type EventName,
  type EventProps,
} from '../../domain/analytics';

export interface CollectContext {
  /** Authenticated account, when there is one. Never inferred from the payload. */
  userId: string | null;
  userAgent: string | null;
  ip: string | null;
  /** Set when the request itself is administrative (token or staff role). */
  internal?: boolean;
  receivedAt?: Date;
}

export interface CollectResult {
  accepted: number;
  /** Events whose id was already stored — a retry, not new activity. */
  duplicates: number;
  rejected: number;
  reasons: string[];
}

const VISITOR_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Sessions are assigned by the server, not accepted from the browser.
 *
 * Inactivity is what ends a session: the first event after the timeout opens a
 * new one. This registry is per process, which is correct for a single instance
 * and the documented limitation of a multi-instance deployment (see README).
 */
interface SessionState {
  sessionId: string;
  lastSeenAt: number;
}

const sessions = new Map<string, SessionState>();
let lastPurgeAt = 0;

/** Test helper. */
export function resetAnalyticsSessions(): void {
  sessions.clear();
  lastPurgeAt = 0;
}

/**
 * A visitor is identified by a random id the browser stores itself. When that id
 * is missing we fall back to a salted hash of the request, rotated daily: it
 * groups a day's requests without storing an address or user agent, and it
 * cannot be joined across days.
 */
export function resolveVisitorId(rawVisitor: unknown, ctx: CollectContext, now: Date): string | null {
  if (typeof rawVisitor === 'string' && VISITOR_PATTERN.test(rawVisitor.trim())) {
    return rawVisitor.trim();
  }
  if (!ctx.ip && !ctx.userAgent) return null;
  const day = now.toISOString().slice(0, 10);
  const salt = `${env.sessionSecret}:${day}`;
  const digest = createHash('sha256')
    .update(`${salt}|${ctx.ip ?? ''}|${ctx.userAgent ?? ''}`)
    .digest('hex');
  return `anon-${digest.slice(0, 32)}`;
}

function sessionFor(key: string, occurredAt: number): { sessionId: string; started: boolean } {
  const timeoutMs = SESSION_INACTIVITY_MINUTES * 60 * 1000;
  const existing = sessions.get(key);
  if (!existing || occurredAt - existing.lastSeenAt > timeoutMs) {
    const sessionId = randomUUID();
    sessions.set(key, { sessionId, lastSeenAt: occurredAt });
    return { sessionId, started: true };
  }
  existing.lastSeenAt = Math.max(existing.lastSeenAt, occurredAt);
  return { sessionId: existing.sessionId, started: false };
}

function resourceIdFor(event: { resourceId: string | null; props: EventProps }): string | null {
  if (event.resourceId) return event.resourceId;
  const fromProps = event.props.placeId ?? event.props.experienceId;
  return typeof fromProps === 'string' ? fromProps : null;
}

/**
 * Validates and stores a batch of client events.
 *
 * Nothing here trusts the payload: identity comes from the session cookie, the
 * device from the user agent, session boundaries from the server clock, and
 * property values from the allowlist. Invalid events are counted and dropped
 * rather than failing the whole batch, so one bad event cannot cost a visitor a
 * session's worth of data.
 */
export async function collectEvents(
  repo: Repository,
  body: { visitorId?: unknown; events?: unknown } | null,
  ctx: CollectContext,
): Promise<CollectResult> {
  const receivedAt = ctx.receivedAt ?? new Date();
  const nowMs = receivedAt.getTime();
  const visitorId = resolveVisitorId(body?.visitorId, ctx, receivedAt);
  const device = classifyDevice(ctx.userAgent);

  if (device === 'bot') {
    // Bots are recorded nowhere. Counting them would flatter every audience KPI.
    return { accepted: 0, duplicates: 0, rejected: 0, reasons: ['bot traffic is not recorded'] };
  }

  const list = body?.events;
  if (!Array.isArray(list)) {
    return { accepted: 0, duplicates: 0, rejected: 0, reasons: ['`events` must be an array'] };
  }
  // One request cannot consume unbounded work.
  const capped = list.slice(0, 50);

  const records: AnalyticsEventRecord[] = [];
  const reasons: string[] = [];
  let rejected = 0;

  for (const raw of capped) {
    const validated = validateIngestEvent(raw);
    if (!validated.ok || !validated.value) {
      rejected += 1;
      if (reasons.length < 5) reasons.push(validated.reason ?? 'invalid event');
      continue;
    }
    const value = validated.value;

    const claimed = Date.parse(value.occurredAt);
    let occurred = claimed;
    if (occurred > nowMs + MAX_FUTURE_DRIFT_MS) occurred = nowMs;
    if (occurred < nowMs - MAX_EVENT_AGE_MS) occurred = nowMs;

    const key = visitorId ?? ctx.userId ?? 'anonymous';
    const { sessionId } = sessionFor(key, occurred);
    // Bot user agents never reach here (they are dropped above), so this is about
    // staff traffic and admin paths, which must not flatter audience figures.
    const internal =
      Boolean(ctx.internal) ||
      (value.path ?? '').startsWith('/admin') ||
      (value.path ?? '').startsWith('/api/admin');

    records.push({
      // A client may reuse one id for `session_started` within a session; a fresh
      // id keeps the second genuine start from being mistaken for a retry.
      id: value.name === 'session_started' ? `s-${randomUUID()}` : (raw as { id: string }).id,
      name: value.name,
      receivedAt: receivedAt.toISOString(),
      occurredAt: new Date(occurred).toISOString(),
      visitorId,
      sessionId,
      userId: ctx.userId,
      path: value.path,
      resourceId: resourceIdFor(value),
      utmSource: value.utm?.source ?? null,
      utmMedium: value.utm?.medium ?? null,
      utmCampaign: value.utm?.campaign ?? null,
      device,
      props: value.props,
      internal,
      source: 'server',
    });
  }

  const written = await repo.appendAnalyticsEvents(records);
  const accepted = written;
  const duplicates = records.length - written;

  // Retention runs opportunistically, at most once an hour, so it needs no
  // scheduler of its own. It never blocks a response — failures are logged only.
  void maybePurge(repo);

  return { accepted, duplicates, rejected, reasons };
}

async function maybePurge(repo: Repository): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAt < 60 * 60 * 1000) return;
  lastPurgeAt = now;
  try {
    const retentionDays = env.analytics.retentionDays;
    const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const removed = await repo.purgeAnalyticsBefore(cutoff);
    if (removed > 0) {
      logger.info({ removed, cutoff, retentionDays }, 'pruned expired analytics rows');
    }
  } catch (error) {
    logger.warn({ err: error }, 'analytics retention sweep failed');
  }
}

/**
 * Records a fact the server witnessed — a confirmed booking, a verified payment.
 *
 * These exist so the funnel and the AI/commerce sections can be read without
 * trusting the browser. They are written after the transaction, never instead of it.
 */
export async function recordServerEvent(
  repo: Repository,
  name: EventName,
  input: {
    userId?: string | null;
    path?: string | null;
    resourceId?: string | null;
    props?: EventProps;
    occurredAt?: Date;
  } = {},
): Promise<void> {
  const now = input.occurredAt ?? new Date();
  const record: AnalyticsEventRecord = {
    id: randomUUID(),
    name,
    receivedAt: new Date().toISOString(),
    occurredAt: now.toISOString(),
    visitorId: null,
    sessionId: null,
    userId: input.userId ?? null,
    path: input.path ?? null,
    resourceId: input.resourceId ?? null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    device: 'unknown',
    props: input.props ?? {},
    internal: false,
    source: 'server',
  };
  try {
    await repo.appendAnalyticsEvents([record]);
  } catch (error) {
    // An analytics failure must never fail the transaction that already happened.
    logger.warn({ err: error, name }, 'could not record a server analytics event');
  }
}
