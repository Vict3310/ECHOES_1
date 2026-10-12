/**
 * Analytics aggregation.
 *
 * Everything here is pure: it takes the rows a date-bounded query returned and
 * derives figures from them. No I/O and no hidden state — which is what makes
 * the KPI maths testable without a database, and what lets every number in the
 * dashboard be paired with the definition that produced it.
 *
 * Three habits are deliberate, because they are the difference between a console
 * that can be trusted and one that cannot:
 *
 *  - A percentage change is `null`, never `0%` or `+100%`, when the previous
 *    period was zero. There is no honest percentage against a zero denominator.
 *  - A metric with no source is reported as unavailable with the reason, rather
 *    than rendered as a zero that reads like real activity.
 *  - Rates over an empty denominator are `null`, and the UI prints an em dash.
 */

import type {
  AiRequestRecord,
  AnalyticsEventRecord,
  DeviceCategory,
  EventName,
} from '../../domain/analytics';
import { KPI_REGISTRY, type KpiDefinition } from '../../domain/analytics';
import type { Booking, Experience, PaymentAttempt, Place, Story } from '../../domain/types';
import type { RequestMetricRecord, UserRecord } from '../../repo/types';
import { bucketStart, buildBuckets, dayKey, type BucketPoint, type ResolvedRange } from './range';

/** Fixed latency bucket upper bounds, in milliseconds, for stored histograms. */
export const LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000] as const;

/** Histogram index for a latency: the first bound at or above it, else overflow. */
export function latencyBucketIndex(ms: number): number {
  for (let index = 0; index < LATENCY_BUCKETS_MS.length; index += 1) {
    if (ms <= LATENCY_BUCKETS_MS[index]!) return index;
  }
  return LATENCY_BUCKETS_MS.length;
}

export function emptyHistogram(): number[] {
  return new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
}

// --- KPI values -------------------------------------------------------------

export interface KpiValue {
  id: string;
  label: string;
  definition: string;
  source: string;
  freshness: KpiDefinition['freshness'];
  unit: KpiDefinition['unit'];
  group: KpiDefinition['group'];
  /** Current value, or null when the metric genuinely cannot be computed. */
  value: number | null;
  previous: number | null;
  absoluteChange: number | null;
  /** Null when the previous period was zero — there is no percentage of nothing. */
  percentChange: number | null;
  unavailableReason?: string;
}

/**
 * Percentage change with an explicit answer for a zero denominator.
 * Both zero is "no change"; a non-zero period after a zero one is undefined, not
 * infinite, so it is reported as null and the UI shows "new" instead of a figure.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function kpi(id: string, current: number | null, previous: number | null): KpiValue {
  const definition =
    KPI_REGISTRY.find((entry) => entry.id === id) ??
    ({
      id,
      label: id,
      definition: 'No definition is registered for this metric.',
      source: 'unknown',
      freshness: 'unavailable',
      unit: 'count',
      group: 'platform',
    } satisfies KpiDefinition);

  if (current === null) {
    return {
      id,
      label: definition.label,
      definition: definition.definition,
      source: definition.source,
      freshness: 'unavailable',
      unit: definition.unit,
      group: definition.group,
      value: null,
      previous,
      absoluteChange: null,
      percentChange: null,
      unavailableReason:
        'No data source for this metric is configured in this deployment.',
    };
  }

  return {
    id,
    label: definition.label,
    definition: definition.definition,
    source: definition.source,
    freshness: definition.freshness,
    unit: definition.unit,
    group: definition.group,
    value: current,
    previous,
    absoluteChange: previous === null ? null : current - previous,
    percentChange: previous === null ? null : percentChange(current, previous),
  };
}

// --- Event summaries --------------------------------------------------------

export interface EventSummary {
  total: number;
  byName: Record<string, number>;
  visitors: number;
  sessions: number;
  signedInUsers: number;
  usersById: Map<string, number>;
}

export function summarise(events: AnalyticsEventRecord[]): EventSummary {
  const byName: Record<string, number> = {};
  const visitors = new Set<string>();
  const sessions = new Set<string>();
  const users = new Set<string>();
  const usersById = new Map<string, number>();

  for (const event of events) {
    byName[event.name] = (byName[event.name] ?? 0) + 1;
    if (event.visitorId) visitors.add(event.visitorId);
    if (event.sessionId) sessions.add(event.sessionId);
    if (event.userId) {
      users.add(event.userId);
      usersById.set(event.userId, (usersById.get(event.userId) ?? 0) + 1);
    }
  }

  return {
    total: events.length,
    byName,
    visitors: visitors.size,
    sessions: sessions.size,
    signedInUsers: users.size,
    usersById,
  };
}

export function countOf(summary: EventSummary, ...names: EventName[]): number {
  return names.reduce((total, name) => total + (summary.byName[name] ?? 0), 0);
}

export interface SessionStats {
  sessions: number;
  engagedSessions: number;
  /** Null when there is no session to judge — a rate needs a denominator. */
  engagementRatePercent: number | null;
  averageEngagementSeconds: number | null;
  /** Sessions with a single event cannot have a duration; they are excluded. */
  singleEventSessions: number;
}

const ENGAGED_SECONDS = 10;

/**
 * Engagement is measured between the first and last event of a session. A
 * one-event session has no interval at all, so it is excluded from the average
 * rather than counted as zero seconds — counting it would pull the average down
 * with data that does not exist.
 */
export function sessionStats(events: AnalyticsEventRecord[]): SessionStats {
  const bySession = new Map<string, AnalyticsEventRecord[]>();
  for (const event of events) {
    if (!event.sessionId) continue;
    const list = bySession.get(event.sessionId);
    if (list) list.push(event);
    else bySession.set(event.sessionId, [event]);
  }

  let engaged = 0;
  let withDuration = 0;
  let totalDurationMs = 0;
  let single = 0;

  for (const list of bySession.values()) {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    let pageViews = 0;
    for (const event of list) {
      const at = Date.parse(event.occurredAt);
      if (Number.isFinite(at)) {
        first = Math.min(first, at);
        last = Math.max(last, at);
      }
      if (event.name === 'page_view' || event.name === 'cultural_place_viewed') pageViews += 1;
    }
    const durationMs = Number.isFinite(first) && Number.isFinite(last) ? last - first : 0;
    if (list.length <= 1) single += 1;
    else {
      withDuration += 1;
      totalDurationMs += durationMs;
    }
    if (durationMs >= ENGAGED_SECONDS * 1000 || pageViews > 1) engaged += 1;
  }

  const sessions = bySession.size;
  return {
    sessions,
    engagedSessions: engaged,
    engagementRatePercent: sessions === 0 ? null : (engaged / sessions) * 100,
    averageEngagementSeconds: withDuration === 0 ? null : totalDurationMs / withDuration / 1000,
    singleEventSessions: single,
  };
}

export interface ActiveUsers {
  /** Busiest single day in the period, and which day that was. */
  dau: number;
  dauDay: string | null;
  /** Distinct signed-in accounts active in the trailing 7 / 30 days of the period. */
  wau: number;
  mau: number;
}

export function activeUsers(events: AnalyticsEventRecord[], range: ResolvedRange): ActiveUsers {
  const perDay = new Map<string, Set<string>>();
  const all = new Set<string>();

  for (const event of events) {
    if (!event.userId) continue;
    const key = dayKey(new Date(event.occurredAt), range.timezone);
    const set = perDay.get(key);
    if (set) set.add(event.userId);
    else perDay.set(key, new Set([event.userId]));
  }

  let dau = 0;
  let dauDay: string | null = null;
  for (const [day, set] of perDay) {
    if (set.size > dau) {
      dau = set.size;
      dauDay = day;
    }
  }

  const to = Date.parse(range.to);
  const within = (ms: number): Set<string> => {
    const set = new Set<string>();
    for (const event of events) {
      if (!event.userId) continue;
      const at = Date.parse(event.occurredAt);
      if (Number.isFinite(at) && to - at <= ms && at <= to) set.add(event.userId);
    }
    return set;
  };

  for (const set of perDay.values()) for (const id of set) all.add(id);

  return {
    dau,
    dauDay,
    wau: within(7 * 24 * 60 * 60 * 1000).size,
    mau: within(30 * 24 * 60 * 60 * 1000).size,
  };
}

export interface SeriesPoint {
  start: string;
  label: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  placeViews: number;
  registrations: number;
  activeUsers: number;
  aiQuestions: number;
  /** The final bucket is still filling up — a dip there is not a decline. */
  partial: boolean;
}

/** Bucket-by-bucket counts, including buckets with no events. */
export function buildSeries(
  events: AnalyticsEventRecord[],
  registrations: Array<{ createdAt: string; userId: string }>,
  range: ResolvedRange,
): SeriesPoint[] {
  const points: BucketPoint[] = buildBuckets(range);
  const buckets: BucketPoint[] = [];
  const bucketIndex = new Map<number, number>();
  for (const point of points) {
    bucketIndex.set(Date.parse(point.start), buckets.length);
    buckets.push(point);
  }

  const visitors = buckets.map(() => new Set<string>());
  const sessions = buckets.map(() => new Set<string>());
  const users = buckets.map(() => new Set<string>());
  const pageViews = buckets.map(() => 0);
  const placeViews = buckets.map(() => 0);
  const aiQuestions = buckets.map(() => 0);
  const registrationsPerBucket = buckets.map(() => 0);

  for (const event of events) {
    const index = bucketIndex.get(bucketStart(new Date(event.occurredAt), range));
    const visitorSet = index === undefined ? undefined : visitors[index];
    if (index === undefined || !visitorSet) continue;
    if (event.visitorId) visitorSet.add(event.visitorId);
    if (event.sessionId) sessions[index]?.add(event.sessionId);
    if (event.userId) users[index]?.add(event.userId);
    if (event.name === 'page_view') pageViews[index] = (pageViews[index] ?? 0) + 1;
    if (event.name === 'cultural_place_viewed') placeViews[index] = (placeViews[index] ?? 0) + 1;
    if (event.name === 'ai_question_submitted') aiQuestions[index] = (aiQuestions[index] ?? 0) + 1;
    if (event.name === 'user_registered') {
      registrationsPerBucket[index] = (registrationsPerBucket[index] ?? 0) + 1;
    }
  }

  for (const registration of registrations) {
    const index = bucketIndex.get(bucketStart(new Date(registration.createdAt), range));
    if (index === undefined) continue;
    registrationsPerBucket[index] = (registrationsPerBucket[index] ?? 0) + 1;
  }

  const lastStart = buckets.length > 0 ? buckets[buckets.length - 1]!.start : null;
  const to = Date.parse(range.to);
  const lastBucketEnd = points.length > 0 ? Date.parse(points[points.length - 1]!.end) : 0;

  return buckets.map((point, index) => ({
    start: point.start,
    label: point.label,
    visitors: visitors[index]?.size ?? 0,
    sessions: sessions[index]?.size ?? 0,
    pageViews: pageViews[index] ?? 0,
    placeViews: placeViews[index] ?? 0,
    registrations: registrationsPerBucket[index] ?? 0,
    activeUsers: users[index]?.size ?? 0,
    aiQuestions: aiQuestions[index] ?? 0,
    partial: point.start === lastStart && lastBucketEnd > to,
  }));
}

// --- Rankings ---------------------------------------------------------------

export interface Ranking {
  key: string;
  label: string;
  count: number;
}

function rank(
  events: AnalyticsEventRecord[],
  select: (event: AnalyticsEventRecord) => string | null,
  limit: number,
): Ranking[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = select(event);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function topPaths(events: AnalyticsEventRecord[], limit = 10): Ranking[] {
  const views = events.filter((event) => event.name === 'page_view');
  return rank(
    views.map((event) => ({
      ...event,
      // Query strings and ids make one page look like many.
      path: (event.path ?? 'unknown').split('?')[0]!.replace(/\/[0-9a-f-]{8,}$/i, '/:id'),
    })),
    (event) => event.path,
    limit,
  );
}

export function topPlaceViews(
  events: AnalyticsEventRecord[],
  places: Place[],
  limit = 10,
): Array<Ranking & { category: string | null }> {
  const byId = new Map(places.map((place) => [place.id, place]));
  return rank(
    events.filter((event) => event.name === 'cultural_place_viewed'),
    (event) => event.resourceId ?? null,
    limit,
  ).map((row) => ({
    ...row,
    label: byId.get(row.key)?.name ?? row.label,
    category: byId.get(row.key)?.category ?? null,
  }));
}

/** Places nobody has opened in the period — an editorial queue, not a scoreboard. */
export function unviewedPlaces(
  events: AnalyticsEventRecord[],
  places: Place[],
  limit = 12,
): Array<{ id: string; name: string; category: string; sourceCount: number }> {
  const viewed = new Set<string>();
  for (const event of events) {
    if (event.name === 'cultural_place_viewed' && event.resourceId) viewed.add(event.resourceId);
  }
  return places
    .filter((place) => !viewed.has(place.id))
    .slice(0, limit)
    .map((place) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      sourceCount: place.sources.length,
    }));
}

export interface SearchInsights {
  searches: number;
  zeroResultSearches: number;
  /** Null with no searches: a rate over nothing is not zero percent. */
  zeroResultRatePercent: number | null;
  top: Ranking[];
  noResults: Ranking[];
}

function rankQueries(rows: Array<{ query: string | null }>, limit: number): Ranking[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.query) continue;
    counts.set(row.query, (counts.get(row.query) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([query, count]) => ({ key: query, label: query, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function searchInsights(events: AnalyticsEventRecord[], limit = 10): SearchInsights {
  // Queries are normalised to lower case for grouping, so "Masks" and "masks"
  // are one term rather than two — the display value stays as typed elsewhere.
  const searches = events
    .filter((event) => event.name === 'search_performed')
    .map((event) => ({
      query: typeof event.props.query === 'string' ? event.props.query.trim().toLowerCase() : null,
      resultCount: typeof event.props.resultCount === 'number' ? event.props.resultCount : null,
    }));
  const zero = searches.filter((search) => search.resultCount === 0);

  return {
    searches: searches.length,
    zeroResultSearches: zero.length,
    zeroResultRatePercent: searches.length === 0 ? null : (zero.length / searches.length) * 100,
    top: rankQueries(searches, limit),
    noResults: rankQueries(zero, limit),
  };
}

export function trafficSources(events: AnalyticsEventRecord[], limit = 8): Ranking[] {
  const visitorsBySource = new Map<string, Set<string>>();
  for (const event of events) {
    const source =
      event.utmSource?.trim().toLowerCase() ||
      (typeof event.props.referrerHost === 'string' ? event.props.referrerHost.toLowerCase() : '') ||
      (event.utmMedium?.trim().toLowerCase() ? `${event.utmMedium.toLowerCase()} (unattributed)` : '') ||
      'direct';
    const set = visitorsBySource.get(source);
    const identity = event.visitorId ?? event.sessionId ?? event.id;
    if (set) set.add(identity);
    else visitorsBySource.set(source, new Set([identity]));
  }
  return [...visitorsBySource.entries()]
    .map(([key, set]) => ({ key, label: key, count: set.size }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function deviceBreakdown(events: AnalyticsEventRecord[]): Array<Ranking & { device: DeviceCategory }> {
  const counts = new Map<DeviceCategory, number>();
  for (const event of events) counts.set(event.device, (counts.get(event.device) ?? 0) + 1);
  return [...counts.entries()]
    .map(([device, count]) => ({ key: device, label: device, count, device }))
    .sort((a, b) => b.count - a.count);
}

export function campaignBreakdown(events: AnalyticsEventRecord[], limit = 8): Ranking[] {
  return rank(events, (event) => event.utmCampaign?.toLowerCase() ?? null, limit);
}

// --- Funnel -----------------------------------------------------------------

export interface FunnelStep {
  id: string;
  label: string;
  /** Null when the step has no data source in this deployment. */
  value: number | null;
  /** Conversion from the previous step; null when it cannot be computed. */
  fromPreviousPercent: number | null;
  note?: string;
}

export function conversionFunnel(input: {
  visitors: number;
  discoveryVisitors: number;
  registrations: number;
  bookingStarts: number;
  confirmedBookings: number;
  verifiedPayments: number | null;
}): FunnelStep[] {
  const steps: Array<Omit<FunnelStep, 'fromPreviousPercent'>> = [
    {
      id: 'visitors',
      label: 'Visitors',
      value: input.visitors,
      note: 'Distinct anonymous visitor ids seen in the period.',
    },
    {
      id: 'discovery',
      label: 'Opened a place',
      value: input.discoveryVisitors,
      note: 'Visitors who opened at least one cultural place profile.',
    },
    {
      id: 'registration',
      label: 'Created an account',
      value: input.registrations,
      note: 'Accounts created in the period, from the users table.',
    },
    {
      id: 'booking_started',
      label: 'Started a booking',
      value: input.bookingStarts,
      note: 'Bookings created in the period, whether or not payment followed.',
    },
    {
      id: 'booking_completed',
      label: 'Booking confirmed',
      value: input.confirmedBookings,
      note: 'Bookings the server confirmed after verifying payment.',
    },
    {
      id: 'payment_verified',
      label: 'Payment verified',
      value: input.verifiedPayments,
      note:
        input.verifiedPayments === null
          ? 'No payment provider is configured, so no payments can be verified.'
          : 'Payments confirmed against the provider, from payment records rather than a browser redirect.',
    },
  ];

  return steps.map((step, index) => {
    const previous = index === 0 ? null : steps[index - 1]!.value;
    return {
      ...step,
      fromPreviousPercent:
        step.value === null || previous === null || previous === 0
          ? null
          : (step.value / previous) * 100,
    };
  });
}

// --- Request metrics --------------------------------------------------------

export interface RequestRollup {
  requests: number;
  serverErrors: number;
  clientErrors: number;
  errorRatePercent: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  latencyMaxMs: number | null;
  slowestRoutes: Array<Ranking & { errorRatePercent: number | null; p95Ms: number | null }>;
  busiestRoutes: Ranking[];
  series: Array<{ start: string; requests: number; serverErrors: number }>;
}

/** Percentile from a stored histogram: the bucket bound the value falls into. */
export function percentileFromHistogram(
  histogram: number[],
  percentile: number,
  overflowMaxMs: number | null,
): number | null {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  const target = Math.ceil((percentile / 100) * total);
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative >= target) {
      if (index < LATENCY_BUCKETS_MS.length) return LATENCY_BUCKETS_MS[index]!;
      return overflowMaxMs ?? LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]!;
    }
  }
  return overflowMaxMs;
}

export function rollupRequests(metrics: RequestMetricRecord[], range: ResolvedRange): RequestRollup {
  const histogram = emptyHistogram();
  let requests = 0;
  let serverErrors = 0;
  let clientErrors = 0;
  let latencyMaxMs = 0;

  const perRoute = new Map<string, { requests: number; serverErrors: number; histogram: number[]; latencyMaxMs: number }>();
  const perBucket = new Map<string, { start: string; requests: number; serverErrors: number }>();

  for (const row of metrics) {
    requests += row.count;
    serverErrors += row.serverErrors;
    clientErrors += row.clientErrors;
    latencyMaxMs = Math.max(latencyMaxMs, row.latencyMaxMs);
    for (let index = 0; index < histogram.length; index += 1) {
      histogram[index] = (histogram[index] ?? 0) + (row.histogram[index] ?? 0);
    }

    const route = perRoute.get(row.route) ?? {
      requests: 0,
      serverErrors: 0,
      histogram: emptyHistogram(),
      latencyMaxMs: 0,
    };
    route.requests += row.count;
    route.serverErrors += row.serverErrors;
    route.latencyMaxMs = Math.max(route.latencyMaxMs, row.latencyMaxMs);
    for (let index = 0; index < route.histogram.length; index += 1) {
      route.histogram[index] = (route.histogram[index] ?? 0) + (row.histogram[index] ?? 0);
    }
    perRoute.set(row.route, route);

    const bucket = new Date(bucketStart(new Date(row.bucket), range)).toISOString();
    const point = perBucket.get(bucket) ?? { start: bucket, requests: 0, serverErrors: 0 };
    point.requests += row.count;
    point.serverErrors += row.serverErrors;
    perBucket.set(bucket, point);
  }

  const routes = [...perRoute.entries()].map(([route, value]) => ({
    key: route,
    label: route,
    count: value.requests,
    errorRatePercent: value.requests === 0 ? null : (value.serverErrors / value.requests) * 100,
    p95Ms: percentileFromHistogram(value.histogram, 95, value.latencyMaxMs),
    histogram: value.histogram,
    latencyMaxMs: value.latencyMaxMs,
  }));

  return {
    requests,
    serverErrors,
    clientErrors,
    errorRatePercent: requests === 0 ? null : (serverErrors / requests) * 100,
    latencyP50Ms: percentileFromHistogram(histogram, 50, latencyMaxMs),
    latencyP95Ms: percentileFromHistogram(histogram, 95, latencyMaxMs),
    latencyP99Ms: percentileFromHistogram(histogram, 99, latencyMaxMs),
    latencyMaxMs: requests === 0 ? null : latencyMaxMs,
    slowestRoutes: routes
      .filter((route) => route.count > 0)
      .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))
      .slice(0, 8)
      .map(({ key, label, count, errorRatePercent, p95Ms }) => ({ key, label, count, errorRatePercent, p95Ms })),
    busiestRoutes: routes
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(({ key, label, count }) => ({ key, label, count })),
    series: [...perBucket.values()].sort((a, b) => a.start.localeCompare(b.start)),
  };
}

// --- AI ---------------------------------------------------------------------

export interface AiRollup {
  requests: number;
  successful: number;
  failed: number;
  failureRatePercent: number | null;
  rateLimited: number;
  timeouts: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  averageLatencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Our own estimate from published prices — never presented as a bill. */
  estimatedCostMicros: number | null;
  /** How much of the period the estimate actually covers. */
  costCoverage: { pricedRequests: number; unpricedRequests: number };
  /** Provider-reported spend, when the provider returns it. Often unavailable. */
  providerCostMinor: number | null;
  providerCostAvailable: boolean;
  costPerSuccessfulRequestMicros: number | null;
  byFeature: Array<Ranking & { failureRatePercent: number | null; estimatedCostMicros: number }>;
  byModel: Array<Ranking & { estimatedCostMicros: number }>;
  series: Array<{ start: string; label: string; requests: number; failed: number; estimatedCostMicros: number }>;
}

export function rollupAi(requests: AiRequestRecord[], range: ResolvedRange): AiRollup {
  const histogram = emptyHistogram();
  let latencySum = 0;
  let latencyMax = 0;
  let successful = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let promptAvailable = false;
  let completionAvailable = false;
  let estimatedCostMicros = 0;
  let pricedRequests = 0;
  let providerCostMinor: number | null = null;

  const byFeature = new Map<string, { requests: number; failed: number; estimatedCostMicros: number }>();
  const byModel = new Map<string, { requests: number; estimatedCostMicros: number }>();
  const perBucket = new Map<string, { start: string; requests: number; failed: number; estimatedCostMicros: number }>();

  for (const request of requests) {
    histogram[latencyBucketIndex(request.latencyMs)] =
      (histogram[latencyBucketIndex(request.latencyMs)] ?? 0) + 1;
    latencySum += request.latencyMs;
    latencyMax = Math.max(latencyMax, request.latencyMs);
    if (request.ok) successful += 1;
    if (request.promptTokens !== null) {
      promptTokens += request.promptTokens;
      promptAvailable = true;
    }
    if (request.completionTokens !== null) {
      completionTokens += request.completionTokens;
      completionAvailable = true;
    }
    const cost = request.estimatedCostMicros;
    if (cost !== null) {
      estimatedCostMicros += cost;
      pricedRequests += 1;
    }
    if (request.providerCostMinor !== null) {
      providerCostMinor = (providerCostMinor ?? 0) + request.providerCostMinor;
    }

    const feature = byFeature.get(request.feature) ?? { requests: 0, failed: 0, estimatedCostMicros: 0 };
    feature.requests += 1;
    if (!request.ok) feature.failed += 1;
    feature.estimatedCostMicros += cost ?? 0;
    byFeature.set(request.feature, feature);

    const model = byModel.get(request.model) ?? { requests: 0, estimatedCostMicros: 0 };
    model.requests += 1;
    model.estimatedCostMicros += cost ?? 0;
    byModel.set(request.model, model);

    const start = new Date(bucketStart(new Date(request.createdAt), range)).toISOString();
    const point = perBucket.get(start) ?? { start, requests: 0, failed: 0, estimatedCostMicros: 0 };
    point.requests += 1;
    if (!request.ok) point.failed += 1;
    point.estimatedCostMicros += cost ?? 0;
    perBucket.set(start, point);
  }

  const failed = requests.length - successful;
  return {
    requests: requests.length,
    successful,
    failed,
    failureRatePercent: requests.length === 0 ? null : (failed / requests.length) * 100,
    rateLimited: requests.filter((request) => request.errorKind === 'rate_limit').length,
    timeouts: requests.filter((request) => request.errorKind === 'timeout').length,
    latencyP50Ms: percentileFromHistogram(histogram, 50, latencyMax),
    latencyP95Ms: percentileFromHistogram(histogram, 95, latencyMax),
    latencyP99Ms: percentileFromHistogram(histogram, 99, latencyMax),
    averageLatencyMs: requests.length === 0 ? null : latencySum / requests.length,
    promptTokens: promptAvailable ? promptTokens : null,
    completionTokens: completionAvailable ? completionTokens : null,
    estimatedCostMicros: pricedRequests === 0 ? null : estimatedCostMicros,
    costCoverage: {
      pricedRequests,
      unpricedRequests: requests.length - pricedRequests,
    },
    providerCostMinor,
    providerCostAvailable: providerCostMinor !== null,
    costPerSuccessfulRequestMicros:
      successful === 0 || pricedRequests === 0 ? null : estimatedCostMicros / successful,
    byFeature: [...byFeature.entries()]
      .map(([feature, value]) => ({
        key: feature,
        label: feature,
        count: value.requests,
        failureRatePercent: value.requests === 0 ? null : (value.failed / value.requests) * 100,
        estimatedCostMicros: value.estimatedCostMicros,
      }))
      .sort((a, b) => b.count - a.count),
    byModel: [...byModel.entries()]
      .map(([model, value]) => ({
        key: model,
        label: model,
        count: value.requests,
        estimatedCostMicros: value.estimatedCostMicros,
      }))
      .sort((a, b) => b.count - a.count),
    series: [...perBucket.values()]
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((point) => ({
        ...point,
        label: new Date(point.start).toISOString().slice(0, 10),
      })),
  };
}

// --- Commerce ---------------------------------------------------------------

export interface CommerceRollup {
  attempts: number;
  confirmed: number;
  cancelled: number;
  failed: number;
  pendingPayment: number;
  expired: number;
  conversionRatePercent: number | null;
  popularExperiences: Array<Ranking & { revenueMinor: number }>;
  upcoming: Array<{ experienceId: string; title: string; scheduleId: string; startsAt: string; booked: number; capacity: number }>;
  grossVerifiedMinor: number;
  refundsMinor: null;
  refundsAvailable: false;
  refundsNote: string;
  netCollectedMinor: number;
  currency: string;
  failedPayments: number;
  pendingPayments: number;
  paymentProviderConfigured: boolean;
}

export function rollupCommerce(input: {
  bookings: Booking[];
  payments: PaymentAttempt[];
  experiences: Experience[];
  range: ResolvedRange;
  providerConfigured: boolean;
  currency: string;
}): CommerceRollup {
  const { bookings, payments, experiences, range } = input;
  const inRange = (iso: string): boolean => iso >= range.from && iso <= range.to;

  const periodBookings = bookings.filter((booking) => inRange(booking.createdAt));
  const confirmed = periodBookings.filter((booking) => booking.status === 'confirmed').length;
  const cancelled = periodBookings.filter((booking) => booking.status === 'cancelled').length;
  const failed = periodBookings.filter((booking) => booking.status === 'failed').length;
  const pendingPayment = periodBookings.filter((booking) => booking.status === 'pending_payment').length;
  const expired = periodBookings.filter((booking) => booking.status === 'expired').length;

  const titles = new Map(experiences.map((experience) => [experience.id, experience.title]));
  const perExperience = new Map<string, { count: number; revenueMinor: number }>();
  for (const booking of periodBookings) {
    if (booking.status !== 'confirmed') continue;
    const entry = perExperience.get(booking.experienceId) ?? { count: 0, revenueMinor: 0 };
    entry.count += 1;
    entry.revenueMinor += booking.totalMinor;
    perExperience.set(booking.experienceId, entry);
  }

  // Revenue comes from verified payments timed by the moment they were verified,
  // not from the booking row and never from a browser redirect.
  const verifiedPayments = payments.filter(
    (payment) => payment.status === 'successful' && inRange(payment.updatedAt),
  );

  return {
    attempts: periodBookings.length,
    confirmed,
    cancelled,
    failed,
    pendingPayment,
    expired,
    conversionRatePercent: periodBookings.length === 0 ? null : (confirmed / periodBookings.length) * 100,
    popularExperiences: [...perExperience.entries()]
      .map(([id, value]) => ({
        key: id,
        label: titles.get(id) ?? id,
        count: value.count,
        revenueMinor: value.revenueMinor,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    upcoming: experiences
      .flatMap((experience) =>
        experience.schedules
          .filter((schedule) => Date.parse(schedule.startsAt) > Date.now())
          .map((schedule) => ({
            experienceId: experience.id,
            title: experience.title,
            scheduleId: schedule.id,
            startsAt: schedule.startsAt,
            booked: schedule.booked,
            capacity: schedule.capacity,
          })),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 10),
    grossVerifiedMinor: verifiedPayments.reduce((sum, payment) => sum + payment.amountMinor, 0),
    refundsMinor: null,
    refundsAvailable: false,
    refundsNote:
      'The payment provider integration records no refunds yet, so none can be subtracted. Collected revenue below is gross verified payments only.',
    netCollectedMinor: verifiedPayments.reduce((sum, payment) => sum + payment.amountMinor, 0),
    currency: input.currency,
    failedPayments: payments.filter((payment) => payment.status === 'failed' && inRange(payment.updatedAt)).length,
    pendingPayments: payments.filter(
      (payment) => (payment.status === 'pending' || payment.status === 'initialised') && inRange(payment.updatedAt),
    ).length,
    paymentProviderConfigured: input.providerConfigured,
  };
}

// --- Discovery --------------------------------------------------------------

export interface DiscoveryRollup {
  placeViews: number;
  distinctPlacesViewed: number;
  mapOpens: number;
  routeRequests: number;
  routeFailures: number;
  routeFailureRatePercent: number | null;
  itineraryCreated: number;
  storySubmissionsStarted: number;
  storySubmissions: number;
  moderation: { pending: number; approved: number; rejected: number; needsCorrection: number };
  categoryPopularity: Ranking[];
}

export function rollupDiscovery(input: {
  events: AnalyticsEventRecord[];
  places: Place[];
  stories: Story[];
  range: ResolvedRange;
  topPlaceViews: Array<Ranking & { category: string | null }>;
}): DiscoveryRollup {
  const summary = summarise(input.events);
  const routeRequests = countOf(summary, 'route_requested');
  const failures = input.events.filter(
    (event) => event.name === 'route_requested' && event.props.outcome !== 'ok',
  ).length;

  const categoryViews = new Map<string, number>();
  const byId = new Map(input.places.map((place) => [place.id, place]));
  for (const event of input.events) {
    if (event.name !== 'cultural_place_viewed' || !event.resourceId) continue;
    const category = byId.get(event.resourceId)?.category ?? 'unclassified';
    categoryViews.set(category, (categoryViews.get(category) ?? 0) + 1);
  }

  const inRange = (iso: string): boolean => iso >= input.range.from && iso <= input.range.to;
  const stories = input.stories.filter((story) => inRange(story.createdAt));

  return {
    placeViews: countOf(summary, 'cultural_place_viewed'),
    distinctPlacesViewed: new Set(
      input.events
        .filter((event) => event.name === 'cultural_place_viewed')
        .map((event) => event.resourceId)
        .filter((id): id is string => Boolean(id)),
    ).size,
    mapOpens: countOf(summary, 'map_opened'),
    routeRequests,
    routeFailures: failures,
    routeFailureRatePercent: routeRequests === 0 ? null : (failures / routeRequests) * 100,
    itineraryCreated: countOf(summary, 'itinerary_created'),
    storySubmissionsStarted: countOf(summary, 'story_submission_started'),
    storySubmissions: countOf(summary, 'story_submitted'),
    moderation: {
      // The backlog is a current state, not a period figure: it counts everything
      // still waiting, however old.
      pending: input.stories.filter((story) => story.status === 'pending').length,
      approved: stories.filter((story) => story.status === 'approved').length,
      rejected: stories.filter((story) => story.status === 'rejected').length,
      needsCorrection: stories.filter((story) => story.status === 'needs_correction').length,
    },
    categoryPopularity: [...categoryViews.entries()]
      .map(([category, count]) => ({ key: category, label: category, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// --- Users ------------------------------------------------------------------

export interface UserActivity {
  lastActiveAt: string | null;
  events: number;
  sessions: number;
}

export function userActivityIndex(events: AnalyticsEventRecord[]): Map<string, UserActivity> {
  const index = new Map<string, { lastActiveAt: string | null; events: number; sessions: Set<string> }>();
  for (const event of events) {
    if (!event.userId) continue;
    const entry = index.get(event.userId) ?? { lastActiveAt: null, events: 0, sessions: new Set<string>() };
    entry.events += 1;
    if (!entry.lastActiveAt || event.occurredAt > entry.lastActiveAt) entry.lastActiveAt = event.occurredAt;
    if (event.sessionId) entry.sessions.add(event.sessionId);
    index.set(event.userId, entry);
  }
  return new Map(
    [...index.entries()].map(([id, value]) => [
      id,
      { lastActiveAt: value.lastActiveAt, events: value.events, sessions: value.sessions.size },
    ]),
  );
}

export function newUsersInRange(users: UserRecord[], range: ResolvedRange): UserRecord[] {
  return users.filter((user) => user.createdAt >= range.from && user.createdAt <= range.to);
}

export function registrationsForSeries(
  users: UserRecord[],
): Array<{ createdAt: string; userId: string }> {
  return users.map((user) => ({ createdAt: user.createdAt, userId: user.id }));
}

/** Sign-up source inferred from an account's first recorded event, when there is one. */
export function signupSourceIndex(events: AnalyticsEventRecord[]): Map<string, string> {
  const index = new Map<string, { at: string; source: string }>();
  for (const event of events) {
    if (!event.userId) continue;
    const source = event.utmSource?.trim().toLowerCase() || 'direct';
    const existing = index.get(event.userId);
    if (!existing || event.occurredAt < existing.at) index.set(event.userId, { at: event.occurredAt, source });
  }
  return new Map([...index.entries()].map(([id, value]) => [id, value.source]));
}
