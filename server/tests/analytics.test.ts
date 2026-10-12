import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createRepository, resetRepository } from '../src/repo';
import { resetAnalyticsSessions } from '../src/services/analytics/collect';
import { resetRequestMetrics } from '../src/middleware/metrics';
import { validateIngestEvent, validateEventProperties } from '../src/domain/analytics';
import {
  activeUsers,
  latencyBucketIndex,
  percentileFromHistogram,
  percentChange,
  rollupAi,
  rollupRequests,
  searchInsights,
  sessionStats,
  summarise,
  emptyHistogram,
} from '../src/services/analytics/aggregate';
import { csvCell, toCsv } from '../src/services/analytics/csv';
import { resolveRange, startOfDay } from '../src/services/analytics/range';
import { estimateCostMicros } from '../src/services/analytics/ai';
import type { AnalyticsEventRecord, AiRequestRecord } from '../src/domain/analytics';
import type { RequestMetricRecord } from '../src/repo/types';

const app = createApp();
const ADMIN = { 'x-admin-token': 'test-admin-token' };

beforeEach(() => {
  resetRepository();
  resetAnalyticsSessions();
  resetRequestMetrics();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('outbound network is disabled in tests');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --- Helpers ----------------------------------------------------------------

let counter = 0;

function event(overrides: Partial<AnalyticsEventRecord> = {}): AnalyticsEventRecord {
  counter += 1;
  const occurredAt = overrides.occurredAt ?? new Date().toISOString();
  return {
    id: `evt-${String(counter).padStart(6, '0')}`,
    name: 'page_view',
    receivedAt: occurredAt,
    occurredAt,
    visitorId: 'visitor-aaaaaaaaaaaa',
    sessionId: 'session-1',
    userId: null,
    path: '/',
    resourceId: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    device: 'desktop',
    props: {},
    internal: false,
    source: 'server',
    ...overrides,
  };
}

async function seed(events: AnalyticsEventRecord[]): Promise<void> {
  await createRepository().appendAnalyticsEvents(events);
}

function beacon(events: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/analytics/events')
    .set('content-type', 'application/json')
    .set('user-agent', 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36')
    .send({ visitorId: 'visitor-bbbbbbbbbbbb', ...extra, events });
}

// --- Event validation -------------------------------------------------------

describe('analytics event validation', () => {
  it('accepts a known event with the right properties', () => {
    const result = validateIngestEvent({
      id: 'evt-12345678',
      name: 'search_performed',
      occurredAt: new Date().toISOString(),
      path: '/discover',
      props: { query: 'kola nut', resultCount: 3, scope: 'places' },
    });
    expect(result.ok).toBe(true);
    expect(result.value?.props).toEqual({ query: 'kola nut', resultCount: 3, scope: 'places' });
  });

  it('refuses an event name that is not on the allowlist', () => {
    const result = validateIngestEvent({
      id: 'evt-12345678',
      name: 'revenue_inflated',
      occurredAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not recognised/i);
  });

  it('refuses an authoritative event claimed by a client', () => {
    for (const name of ['booking_completed', 'payment_verified']) {
      const result = validateIngestEvent({
        id: 'evt-12345678',
        name,
        occurredAt: new Date().toISOString(),
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/server-recorded/i);
    }
  });

  it('drops unknown properties instead of storing them', () => {
    const result = validateEventProperties('page_view', {
      title: 'Home',
      // A crafted payload trying to smuggle free text into the table.
      message: 'my password is hunter2',
      email: 'someone@example.com',
    });
    expect(result.ok).toBe(true);
    expect(result.props).toEqual({ title: 'Home' });
  });

  it('bounds string length, strips control characters and enforces enums', () => {
    const long = 'x'.repeat(500);
    const result = validateEventProperties('search_performed', {
      query: `line\u0000break${long}`,
      scope: 'everything',
      resultCount: 10_000,
    });
    expect(result.ok).toBe(true);
    // 80 characters, no NUL byte, and the out-of-range enum value is dropped.
    expect(String(result.props.query).length).toBe(80);
    expect(String(result.props.query)).not.toMatch(/\u0000/);
    expect(result.props.scope).toBeUndefined();
    expect(result.props.resultCount).toBe(10_000);
  });

  it('rejects non-numeric and out-of-range numbers', () => {
    const result = validateEventProperties('search_performed', {
      resultCount: 'many',
      query: 'ok',
    });
    expect(result.props.resultCount).toBeUndefined();
    expect(result.props.query).toBe('ok');
  });

  it('requires a plausible event id and timestamp', () => {
    expect(validateIngestEvent({ id: 'short', name: 'page_view', occurredAt: new Date().toISOString() }).ok).toBe(false);
    expect(validateIngestEvent({ id: 'evt-12345678', name: 'page_view', occurredAt: 'yesterday' }).ok).toBe(false);
  });
});

// --- Collection -------------------------------------------------------------

describe('analytics collection', () => {
  it('stores a batch, then treats the same batch as duplicates', async () => {
    const events = [
      { id: 'evt-aaaabbbb', name: 'page_view', occurredAt: new Date().toISOString(), path: '/' },
    ];
    const first = await beacon(events);
    expect(first.status).toBe(200);
    expect(first.body.data.accepted).toBe(1);

    const second = await beacon(events);
    expect(second.body.data.accepted).toBe(0);
    expect(second.body.data.duplicates).toBe(1);

    expect(await createRepository().countAnalyticsEvents()).toBe(1);
  });

  it('drops bot traffic entirely', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('content-type', 'application/json')
      .set('user-agent', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
      .send({
        visitorId: 'visitor-cccccccccccc',
        events: [{ id: 'evt-bot00001', name: 'page_view', occurredAt: new Date().toISOString() }],
      });
    expect(res.body.data.accepted).toBe(0);
    expect(await createRepository().countAnalyticsEvents()).toBe(0);
  });

  it('rejects a form post, which is not a legitimate beacon', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send('events=1');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/application\/json/i);
  });

  it('reports per-event rejections without failing the whole batch', async () => {
    const res = await beacon([
      { id: 'evt-good0001', name: 'page_view', occurredAt: new Date().toISOString() },
      { id: 'evt-bad00001', name: 'payment_verified', occurredAt: new Date().toISOString() },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(1);
    expect(res.body.data.rejected).toBe(1);
    expect(String(res.body.data.reasons[0])).toMatch(/server-recorded/i);
  });

  it('opens a new session after the inactivity timeout, in server time', async () => {
    // Anchored in the past: a future timestamp is clamped to the receive time,
    // which would collapse the three events into one session.
    const base = Date.now() - 3 * 60 * 60 * 1000;
    const repo = createRepository();
    const { collectEvents } = await import('../src/services/analytics/collect');
    const ctx = { userId: null, userAgent: 'Mozilla/5.0 Chrome/120', ip: '203.0.113.5' };

    await collectEvents(
      repo,
      { visitorId: 'visitor-dddddddddddd', events: [{ id: 'evt-sess0001', name: 'page_view', occurredAt: new Date(base).toISOString() }] },
      ctx,
    );
    await collectEvents(
      repo,
      { visitorId: 'visitor-dddddddddddd', events: [{ id: 'evt-sess0002', name: 'page_view', occurredAt: new Date(base + 5 * 60_000).toISOString() }] },
      ctx,
    );
    await collectEvents(
      repo,
      { visitorId: 'visitor-dddddddddddd', events: [{ id: 'evt-sess0003', name: 'page_view', occurredAt: new Date(base + 60 * 60_000).toISOString() }] },
      ctx,
    );

    const events = await repo.listAnalyticsEvents({
      from: new Date(base - 1000).toISOString(),
      to: new Date(base + 2 * 60 * 60_000).toISOString(),
    });
    expect(events).toHaveLength(3);
    const sessions = new Set(events.map((entry) => entry.sessionId));
    // Two sessions: the third event arrived after the 30-minute inactivity window.
    expect(sessions.size).toBe(2);
    expect(events[0]!.sessionId).toBe(events[1]!.sessionId);
    expect(events[2]!.sessionId).not.toBe(events[1]!.sessionId);
  });

  it('derives the visitor from the session cookie holder, not the payload', async () => {
    await beacon([{ id: 'evt-view0001', name: 'cultural_place_viewed', occurredAt: new Date().toISOString(), resourceId: 'freedom-park' }]);
    const stored = await createRepository().listAnalyticsEvents({
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(stored[0]!.userId).toBeNull();
    expect(stored[0]!.resourceId).toBe('freedom-park');
    expect(stored[0]!.source).toBe('server');
    expect(stored[0]!.internal).toBe(false);
  });

  it('erases a visitor\'s events when consent is withdrawn', async () => {
    await seed([event({ visitorId: 'visitor-eeeeeeeeeeee' }), event({ visitorId: 'visitor-ffffffffffff' })]);
    const res = await request(app)
      .post('/api/analytics/opt-out')
      .send({ visitorId: 'visitor-eeeeeeeeeeee' });
    expect(res.status).toBe(200);
    expect(res.body.data.erased).toBe(1);
    expect(await createRepository().countAnalyticsEvents()).toBe(1);
  });
});

// --- Aggregation ------------------------------------------------------------

describe('analytics aggregation', () => {
  it('counts unique visitors separately from page views and sessions', () => {
    const summary = summarise([
      event({ visitorId: 'v1', sessionId: 's1', name: 'page_view' }),
      event({ visitorId: 'v1', sessionId: 's1', name: 'page_view' }),
      event({ visitorId: 'v2', sessionId: 's2', name: 'page_view' }),
      event({ visitorId: 'v2', sessionId: 's2', name: 'page_view' }),
    ]);
    expect(summary.visitors).toBe(2);
    expect(summary.sessions).toBe(2);
    expect(summary.byName.page_view).toBe(4);
  });

  it('counts authenticated activity separately from anonymous visitors', async () => {
    await seed([
      event({ userId: 'user-1', visitorId: 'v1', sessionId: 's1', name: 'user_login' }),
      event({ userId: 'user-1', visitorId: 'v1', sessionId: 's1', name: 'cultural_place_viewed' }),
      event({ userId: null, visitorId: 'v2', sessionId: 's2', name: 'page_view' }),
    ]);
    const range = resolveRange({ preset: '7d' });
    const repo = createRepository();
    const events = await repo.listAnalyticsEvents({ from: range.from, to: range.to });
    const summary = summarise(events);
    expect(summary.visitors).toBe(2);
    expect(summary.signedInUsers).toBe(1);
    expect(activeUsers(events, range).dau).toBe(1);
  });

  it('excludes single-event sessions from the average instead of counting them as zero', () => {
    const base = Date.now();
    const stats = sessionStats([
      // A real session: two events, 120 seconds apart.
      event({ sessionId: 's1', occurredAt: new Date(base).toISOString() }),
      event({ sessionId: 's1', occurredAt: new Date(base + 120_000).toISOString() }),
      // A one-event session: no interval exists to average.
      event({ sessionId: 's2', occurredAt: new Date(base).toISOString() }),
    ]);
    expect(stats.sessions).toBe(2);
    expect(stats.averageEngagementSeconds).toBe(120);
    expect(stats.singleEventSessions).toBe(1);
    // Both sessions count as engaged: one lasted 120s, the other is excluded from
    // the average but still has an engagement decision made about it.
    expect(stats.engagementRatePercent).toBe(50);
  });

  it('returns a null rate rather than zero when there are no sessions', () => {
    const stats = sessionStats([]);
    expect(stats.sessions).toBe(0);
    expect(stats.averageEngagementSeconds).toBeNull();
    expect(stats.engagementRatePercent).toBeNull();
  });

  it('handles a zero denominator honestly', () => {
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(15, 10)).toBeCloseTo(50);
    expect(percentChange(5, 10)).toBeCloseTo(-50);
  });

  it('ranks search terms and separates the ones that found nothing', () => {
    const insights = searchInsights([
      event({ name: 'search_performed', props: { query: 'Masks', resultCount: 4 } }),
      event({ name: 'search_performed', props: { query: 'masks', resultCount: 2 } }),
      event({ name: 'search_performed', props: { query: 'oju olobun', resultCount: 0 } }),
    ]);
    expect(insights.searches).toBe(3);
    expect(insights.zeroResultSearches).toBe(1);
    expect(insights.top[0]).toMatchObject({ key: 'masks', count: 2 });
    expect(insights.noResults[0]).toMatchObject({ key: 'oju olobun', count: 1 });
  });

  it('recomputes percentiles from latencies bucketed by the real index', () => {
    const histogram = emptyHistogram();
    for (const ms of [5, 12, 30, 60, 80, 90, 120, 140, 200, 300]) {
      const index = latencyBucketIndex(ms);
      histogram[index] = (histogram[index] ?? 0) + 1;
    }
    // p50 lands in the 100ms bucket, p99 in the 500ms bucket.
    expect(percentileFromHistogram(histogram, 50, 300)).toBe(100);
    expect(percentileFromHistogram(histogram, 99, 300)).toBe(500);
    expect(percentileFromHistogram(emptyHistogram(), 50, null)).toBeNull();
  });

  it('rolls request metrics up with a real error rate and no fabricated latency', () => {
    const bucket = new Date().toISOString();
    const rows: RequestMetricRecord[] = [
      {
        bucket,
        route: '/api/places',
        method: 'GET',
        count: 10,
        serverErrors: 1,
        clientErrors: 2,
        latencySumMs: 500,
        latencyMaxMs: 200,
        histogram: emptyHistogram().map((_, index) => (index === 3 ? 10 : 0)),
      },
    ];
    const range = resolveRange({ preset: 'today' });
    const rollup = rollupRequests(rows, range);
    expect(rollup.requests).toBe(10);
    expect(rollup.serverErrors).toBe(1);
    expect(rollup.errorRatePercent).toBeCloseTo(10);
    expect(rollup.latencyP50Ms).toBe(100);
    expect(rollup.busiestRoutes[0]!.key).toBe('/api/places');
    expect(rollupRequests([], range).errorRatePercent).toBeNull();
  });

  it('estimates AI cost from token counts and marks unknown models unpriced', () => {
    expect(estimateCostMicros('gpt-4o-mini', 'openai', 1_000_000, 0)).toBe(150_000);
    expect(estimateCostMicros('gpt-4o-mini', 'openai', 0, 1_000_000)).toBe(600_000);
    // Local inference has no per-token charge, and an unknown model is unknown.
    expect(estimateCostMicros('gemma2', 'ollama', 10_000, 10_000)).toBe(0);
    expect(estimateCostMicros('mystery-model', 'google', 1_000, 1_000)).toBeNull();
  });

  it('rolls AI requests up: failures, latency and cost coverage', () => {
    const base = Date.now();
    const requests: AiRequestRecord[] = [
      {
        id: 'ai-1',
        feature: 'guide',
        model: 'gpt-4o-mini',
        provider: 'openai',
        ok: true,
        status: 200,
        latencyMs: 400,
        promptTokens: 1000,
        completionTokens: 500,
        providerCostMinor: null,
        estimatedCostMicros: 450,
        errorKind: null,
        createdAt: new Date(base).toISOString(),
      },
      {
        id: 'ai-2',
        feature: 'guide',
        model: 'gpt-4o-mini',
        provider: 'openai',
        ok: false,
        status: 429,
        latencyMs: 1200,
        promptTokens: null,
        completionTokens: null,
        providerCostMinor: null,
        estimatedCostMicros: null,
        errorKind: 'rate_limit',
        createdAt: new Date(base + 60_000).toISOString(),
      },
    ];
    const rollup = rollupAi(requests, resolveRange({ preset: 'today' }));
    expect(rollup.requests).toBe(2);
    expect(rollup.successful).toBe(1);
    expect(rollup.failed).toBe(1);
    expect(rollup.failureRatePercent).toBeCloseTo(50);
    expect(rollup.rateLimited).toBe(1);
    expect(rollup.promptTokens).toBe(1000);
    expect(rollup.estimatedCostMicros).toBe(450);
    // One of the two requests has no known price — said plainly, not averaged away.
    expect(rollup.costCoverage).toEqual({ pricedRequests: 1, unpricedRequests: 1 });
    expect(rollup.providerCostAvailable).toBe(false);
  });
});

// --- Date ranges ------------------------------------------------------------

describe('analytics date ranges', () => {
  it('resolves presets to a window of the same length immediately before it', () => {
    const now = new Date('2026-10-12T12:00:00.000Z');
    const range = resolveRange({ preset: '7d', now });
    expect(range.bucket).toBe('day');
    expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    // The comparison window ends one millisecond before the period starts.
    expect(new Date(range.previousTo).getTime()).toBe(new Date(range.from).getTime() - 1);
    const duration = new Date(range.to).getTime() - new Date(range.from).getTime();
    const previousDuration = new Date(range.previousTo).getTime() - new Date(range.previousFrom).getTime();
    expect(Math.abs(duration - previousDuration)).toBeLessThan(2);
  });

  it('uses a legal day boundary in the configured timezone, not UTC', () => {
    // 00:30 in Lagos on 12 October is 23:30 UTC on 11 October.
    const now = new Date('2026-10-11T23:30:00.000Z');
    const range = resolveRange({ preset: 'today', now });
    const from = new Date(range.from).toISOString();
    // Lagos is UTC+1, so the day started at 23:00 UTC the evening before.
    expect(from).toBe('2026-10-11T23:00:00.000Z');
    expect(range.bucket).toBe('hour');
  });

  it('accepts a custom range and rejects nonsense', () => {
    const range = resolveRange({ preset: 'custom', from: '2026-09-01', to: '2026-09-30' });
    expect(range.label).toMatch(/Sep/);
    expect(range.bucket).toBe('day');

    const wide = resolveRange({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' });
    // Half a year of daily points would be unreadable, so it buckets by week.
    expect(wide.bucket).toBe('week');

    expect(() => resolveRange({ preset: 'custom', from: '2026-10-01', to: '2026-09-01' })).toThrow();
    expect(() => resolveRange({ preset: 'custom', from: 'yesterday', to: 'today' })).toThrow();
    // Beyond the retention window the answer would be misleading, so it is refused.
    expect(() => resolveRange({ preset: 'custom', from: '2020-01-01', to: '2026-01-01' })).toThrow(/longer than/i);
  });

  it('filters stored events to the range', async () => {
    const now = Date.now();
    await seed([
      event({ occurredAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }),
      event({ occurredAt: new Date(now - 60 * 60 * 1000).toISOString() }),
    ]);
    const range = resolveRange({ preset: '7d' });
    const inRange = await createRepository().listAnalyticsEvents({ from: range.from, to: range.to });
    expect(inRange).toHaveLength(1);
  });
});

// --- Permissions ------------------------------------------------------------

describe('admin analytics permissions', () => {
  it('refuses unauthenticated access to every analytics endpoint', async () => {
    for (const path of [
      '/api/admin/analytics/overview',
      '/api/admin/analytics/discovery',
      '/api/admin/analytics/ai',
      '/api/admin/analytics/commerce',
      '/api/admin/analytics/health',
      '/api/admin/analytics/users',
      '/api/admin/analytics/audit',
      '/api/admin/analytics/meta',
      '/api/admin/analytics/export?dataset=overview',
    ]) {
      const res = await request(app).get(path);
      expect([401, 403], `${path} should be protected`).toContain(res.status);
    }
  });

  it('refuses a wrong admin token', async () => {
    const res = await request(app)
      .get('/api/admin/analytics/overview')
      .set('x-admin-token', 'not-the-token');
    expect(res.status).toBe(403);
  });

  it('serves the overview to a valid admin token', async () => {
    const res = await request(app).get('/api/admin/analytics/overview?preset=30d').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.range.preset).toBe('30d');
    expect(Array.isArray(res.body.data.kpis)).toBe(true);
    expect(res.body.data.freshness.generatedAt).toBeTruthy();
  });

  it('never returns password hashes or reset tokens from the users endpoint', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'viewer@example.com',
      name: 'Viewer Person',
      password: 'correct-horse-battery',
    });
    const res = await request(app).get('/api/admin/analytics/users').set(ADMIN);
    expect(res.status).toBe(200);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/passwordHash|\$2a\$|tokenHash/);
    expect(res.body.data.privacy.note).toMatch(/never returned/i);
  });

  it('rates a suspended account out of signing in, and audits the change', async () => {
    const registered = await request(app).post('/api/auth/register').send({
      email: 'suspend-me@example.com',
      name: 'Suspend Me',
      password: 'correct-horse-battery',
    });
    const userId = registered.body.data.user.id;

    const suspended = await request(app)
      .post(`/api/admin/analytics/users/${userId}/status`)
      .set(ADMIN)
      .send({ status: 'suspended', reason: 'abusive submissions' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.user.status).toBe('suspended');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'suspend-me@example.com', password: 'correct-horse-battery' });
    expect(login.status).toBe(403);

    const audit = await request(app).get('/api/admin/analytics/audit').set(ADMIN);
    const entry = audit.body.data.audit.find((row: { action: string }) => row.action === 'user.suspended');
    expect(entry).toBeTruthy();
    expect(entry.actor).toBe('admin-token');
    expect(entry.details.reason).toBe('abusive submissions');

    const restored = await request(app)
      .post(`/api/admin/analytics/users/${userId}/status`)
      .set(ADMIN)
      .send({ status: 'active' });
    expect(restored.body.data.user.status).toBe('active');
  });

  it('does not offer any way to change a role through the API', async () => {
    const registered = await request(app).post('/api/auth/register').send({
      email: 'promote-me@example.com',
      name: 'Promote Me',
      password: 'correct-horse-battery',
    });
    const userId = registered.body.data.user.id;
    const attempt = await request(app)
      .post(`/api/admin/analytics/users/${userId}/status`)
      .set(ADMIN)
      .send({ status: 'active', role: 'admin' });
    // The schema ignores unknown fields; the API itself has no role mutation.
    expect(attempt.status).toBe(200);
    const users = await request(app).get('/api/admin/analytics/users?q=promote-me').set(ADMIN);
    expect(users.body.data.rows[0].role).toBe('visitor');
  });
});

// --- Empty datasets ---------------------------------------------------------

describe('analytics with no data', () => {
  it('returns zeros, nulls and an explanation rather than inventing history', async () => {
    const res = await request(app).get('/api/admin/analytics/overview?preset=7d').set(ADMIN);
    expect(res.status).toBe(200);
    const visitors = res.body.data.kpis.find((entry: { id: string }) => entry.id === 'visitors_unique');
    expect(visitors.value).toBe(0);
    expect(visitors.previous).toBe(0);
    // Empty on both sides is "no change" — there is no percentage of zero to show.
    expect(visitors.percentChange).toBe(0);
    // A rate over an empty denominator, by contrast, is undefined.
    const changePercent = res.body.data.kpis.find((entry: { id: string }) => entry.id === 'error_rate');
    expect(changePercent.value).toBeNull();

    const engagement = res.body.data.kpis.find((entry: { id: string }) => entry.id === 'engagement_rate');
    expect(engagement.value).toBeNull();

    expect(res.body.data.freshness.collectionStart).toBeNull();
    expect(res.body.data.freshness.caveats.join(' ')).toMatch(/no events have been recorded/i);
    // The buckets exist and are genuinely zero — the caveat above is what stops
    // that reading as "traffic fell to nothing".
    expect(res.body.data.series.length).toBeGreaterThan(0);
    expect(
      res.body.data.series.every(
        (point: { visitors: number; sessions: number; pageViews: number }) =>
          point.visitors === 0 && point.sessions === 0 && point.pageViews === 0,
      ),
    ).toBe(true);
  });

  it('marks commerce as not configured instead of showing sample revenue', async () => {
    const res = await request(app).get('/api/admin/analytics/commerce').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.rollup.grossVerifiedMinor).toBe(0);
    expect(res.body.data.rollup.refundsAvailable).toBe(false);
    expect(res.body.data.rollup.refundsNote).toMatch(/no refunds yet/i);
    expect(res.body.data.payments.configured).toBe(false);
    expect(res.body.data.recentBookings).toEqual([]);
  });
});

// --- CSV --------------------------------------------------------------------

describe('csv export', () => {
  it('neutralises spreadsheet formulas and quotes properly', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    // A leading minus can start a formula too, so a string is neutralised as well.
    expect(csvCell('-2')).toBe('"\'-2"');
    // A real number keeps its numeric form so a spreadsheet can still sum it.
    expect(csvCell(-2)).toBe('-2');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('writes a header row and escapes every cell', () => {
    const csv = toCsv(
      [
        { key: 'term', header: 'search term' },
        { key: 'count', header: 'count' },
      ],
      [{ term: '=evil()', count: 3 }],
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('search term,count');
    expect(lines[1]).toBe('"\'=evil()",3');
  });

  it('exports the KPI table as a download and records who took it', async () => {
    const res = await request(app).get('/api/admin/analytics/export?dataset=overview&preset=7d').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="echoes-overview-/);
    expect(res.text.split('\r\n')[0]).toBe(
      'metric,label,value,previous_period,absolute_change,percent_change,unit,freshness,source,definition',
    );

    const audit = await request(app).get('/api/admin/analytics/audit').set(ADMIN);
    expect(
      audit.body.data.audit.some((row: { action: string }) => row.action === 'analytics.exported'),
    ).toBe(true);
  });
});

// --- Health -----------------------------------------------------------------

describe('platform health', () => {
  it('summarises request metrics without exposing internals', async () => {
    await request(app).get('/api/places');
    const { flushRequestMetrics } = await import('../src/middleware/metrics');
    await flushRequestMetrics();

    const res = await request(app).get('/api/admin/analytics/health?preset=today').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.rollup.requests).toBeGreaterThan(0);
    expect(res.body.data.logNote).toMatch(/stack traces stay in the structured logs/i);
    expect(res.body.data.integrations.deployment.available).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/process\.env|DATABASE_URL|SESSION_SECRET/);
    // The health check itself is not counted: it would swamp the aggregates.
    expect(res.body.data.rollup.busiestRoutes.every((route: { key: string }) => !route.key.includes('/api/health'))).toBe(true);
  });

  it('handles a database-style failure without inventing a passing status', async () => {
    const repo = createRepository();
    const original = repo.listRequestMetrics;
    repo.listRequestMetrics = async () => {
      throw new Error('connection terminated unexpectedly');
    };
    const res = await request(app).get('/api/admin/analytics/health').set(ADMIN);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    repo.listRequestMetrics = original;
  });
});

// --- Timezone helper --------------------------------------------------------

describe('timezone boundaries', () => {
  it('starts the day at local midnight, not UTC midnight', () => {
    const lagosMidnight = startOfDay(new Date('2026-10-12T15:00:00.000Z'), 'Africa/Lagos');
    expect(lagosMidnight.toISOString()).toBe('2026-10-11T23:00:00.000Z');
    const utcMidnight = startOfDay(new Date('2026-10-12T15:00:00.000Z'), 'UTC');
    expect(utcMidnight.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
});
