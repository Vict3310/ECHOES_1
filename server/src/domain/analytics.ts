/**
 * Analytics domain — the vocabulary the whole analytics system reports against.
 *
 * Two rules drive everything here:
 *
 *  1. An event that is not on this allowlist is not stored. The client cannot
 *     invent a metric, and property values are validated and length-bounded so a
 *     crafted payload cannot smuggle free text (a question, an email, a precise
 *     location) into the analytics tables.
 *
 *  2. Authoritative facts — a completed booking, a verified payment — are
 *     recorded by the server when the transaction actually happens, never from a
 *     client beacon. `authoritative: 'server'` marks those; the ingest route
 *     refuses to accept them from a browser, so a forged beacon can never
 *     inflate revenue.
 */

export const EVENT_NAMES = [
  'page_view',
  'session_started',
  'user_registered',
  'user_login',
  'user_logout',
  'search_performed',
  'cultural_place_viewed',
  'map_opened',
  'route_requested',
  'ai_guide_opened',
  'ai_question_submitted',
  'itinerary_created',
  'story_submission_started',
  'story_submitted',
  'booking_started',
  'booking_completed',
  'payment_verified',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export type Freshness = 'live' | 'delayed' | 'estimated' | 'unavailable';
export type DeviceCategory = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';

export type PropSpec =
  | { kind: 'string'; maxLength: number; enum?: readonly string[] }
  | { kind: 'number'; min: number; max: number; integer?: boolean }
  | { kind: 'boolean' };

export interface EventSpec {
  /** Shown in the dashboard so a metric can always be traced to its definition. */
  description: string;
  /**
   * Only the named properties survive. Free text is allowed only where it is
   * genuinely needed (`search_performed.query`, bounded and stored as-is) and
   * message contents, credentials and payment details are never among them.
   */
  props: Record<string, PropSpec>;
  /** A client may not claim this happened; only the server may record it. */
  authoritative?: 'server';
}

const str = (maxLength: number, values?: readonly string[]): PropSpec =>
  values ? { kind: 'string', maxLength, enum: values } : { kind: 'string', maxLength };
const num = (min: number, max: number, integer = false): PropSpec => ({
  kind: 'number',
  min,
  max,
  integer,
});
const bool: PropSpec = { kind: 'boolean' };

export const EVENT_SPECS: Record<EventName, EventSpec> = {
  page_view: {
    description: 'A document or client route rendered for a visitor.',
    props: { title: str(120), referrerHost: str(120) },
  },
  session_started: {
    description: 'A new browsing session began (first event, or after the inactivity timeout).',
    props: { landingPath: str(200) },
  },
  user_registered: {
    description: 'An account was created.',
    props: {},
  },
  user_login: {
    description: 'A successful sign-in.',
    props: {},
  },
  user_logout: {
    description: 'The visitor ended their session deliberately.',
    props: {},
  },
  search_performed: {
    description: 'A search was run. The query is stored, but never the results.',
    props: {
      query: str(80),
      resultCount: num(0, 10_000, true),
      scope: str(16, ['all', 'places', 'experiences', 'stories']),
    },
  },
  cultural_place_viewed: {
    description: 'A cultural place profile was opened.',
    props: { placeId: str(200), placeName: str(160) },
  },
  map_opened: {
    description: 'The map view was opened or interacted with.',
    props: { interaction: str(24, ['open', 'pan', 'zoom', 'select']) },
  },
  route_requested: {
    description: 'A travel route between places was requested.',
    props: {
      destinationPlaceId: str(200),
      stops: num(0, 50, true),
      outcome: str(16, ['ok', 'failed', 'unavailable']),
    },
  },
  ai_guide_opened: {
    description: 'The cultural guide panel was opened. Question text is never sent here.',
    props: { surface: str(24, ['place', 'discover', 'home', 'account']) },
  },
  ai_question_submitted: {
    description:
      'A question was submitted to an AI feature. Only the feature, outcome and latency are recorded — never the question or the answer.',
    props: {
      feature: str(24, ['guide', 'itinerary', 'translate']),
      outcome: str(16, ['ok', 'failed', 'rate_limited']),
    },
  },
  itinerary_created: {
    description: 'An itinerary was generated or saved.',
    props: { stops: num(0, 50, true) },
  },
  story_submission_started: {
    description: 'A contributor opened the story submission form.',
    props: {},
  },
  story_submitted: {
    description: 'A community story was submitted for moderation.',
    props: { placeId: str(200), hasPlace: bool },
  },
  booking_started: {
    description: 'An experience booking was started.',
    props: { experienceId: str(200), participants: num(1, 100, true) },
  },
  booking_completed: {
    description: 'A booking reached the confirmed state. Recorded by the server only.',
    props: { experienceId: str(200), participants: num(1, 100, true) },
    authoritative: 'server',
  },
  payment_verified: {
    description:
      'A payment was verified against the provider and the booking confirmed. Recorded by the server only; revenue is never inferred from a browser redirect.',
    props: { currency: str(8) },
    authoritative: 'server',
  },
};

export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && (EVENT_NAMES as readonly string[]).includes(value);
}

/** Events a browser is allowed to submit. */
export function isClientEvent(value: unknown): value is EventName {
  return isEventName(value) && EVENT_SPECS[value].authoritative !== 'server';
}

export type EventProps = Record<string, string | number | boolean>;

export interface AnalyticsEventRecord {
  /** Server-assigned id; also the dedupe key for client-supplied event ids. */
  id: string;
  name: EventName;
  /** Server clock when the row was written. */
  receivedAt: string;
  /** Client clock for the moment it happened, clamped to a sane window. */
  occurredAt: string;
  visitorId: string | null;
  sessionId: string | null;
  userId: string | null;
  path: string | null;
  resourceId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  device: DeviceCategory;
  props: EventProps;
  /** Admin, health-check and bot traffic is flagged, not silently mixed in. */
  internal: boolean;
  /** Always 'server' for stored rows: the server stamps receipt time and identity. */
  source: 'server';
}

export interface IngestEvent {
  /** Client-generated, stable per event; the dedupe key. */
  id: string;
  name: EventName;
  occurredAt: string;
  path?: string | null;
  resourceId?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
  props?: EventProps;
}

// --- AI request log ---------------------------------------------------------

export interface AiRequestRecord {
  id: string;
  feature: 'guide' | 'itinerary' | 'translate';
  model: string;
  provider: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Provider-reported spend when the provider returns it; otherwise null. */
  providerCostMinor: number | null;
  /**
   * Our own estimate from published token prices, in USD micros.
   * Null when no price is known for the model — an unknown cost is reported as
   * unknown, never as zero, because a confident zero would understate the bill.
   */
  estimatedCostMicros: number | null;
  errorKind: 'timeout' | 'rate_limit' | 'provider' | 'config' | 'unknown' | null;
  createdAt: string;
}

// --- KPI registry -----------------------------------------------------------

export type KpiUnit = 'count' | 'percent' | 'seconds' | 'currency' | 'milliseconds';

export interface KpiDefinition {
  id: string;
  label: string;
  /** Plain-language definition shown in the dashboard tooltip. */
  definition: string;
  /** Where the number comes from, so it can be checked. */
  source: string;
  freshness: Freshness;
  unit: KpiUnit;
  group: 'audience' | 'engagement' | 'discovery' | 'ai' | 'commerce' | 'platform';
  /** A KPI that cannot be computed yet says so instead of showing a zero. */
  availability?: 'not_configured' | 'needs_data';
}

export const KPI_REGISTRY: KpiDefinition[] = [
  {
    id: 'users_total',
    label: 'Registered users',
    definition: 'Accounts that exist right now, including suspended ones.',
    source: 'users table',
    freshness: 'live',
    unit: 'count',
    group: 'audience',
  },
  {
    id: 'users_new',
    label: 'New users',
    definition: 'Accounts created inside the selected period.',
    source: 'users.createdAt',
    freshness: 'live',
    unit: 'count',
    group: 'audience',
  },
  {
    id: 'dau',
    label: 'Daily active users',
    definition:
      'Distinct signed-in accounts with at least one recorded event on the busiest day of the period.',
    source: 'analytics_events.userId',
    freshness: 'live',
    unit: 'count',
    group: 'audience',
  },
  {
    id: 'wau',
    label: 'Weekly active users',
    definition: 'Distinct signed-in accounts active in the last 7 days of the period.',
    source: 'analytics_events.userId',
    freshness: 'live',
    unit: 'count',
    group: 'audience',
  },
  {
    id: 'mau',
    label: 'Monthly active users',
    definition: 'Distinct signed-in accounts active in the last 30 days of the period.',
    source: 'analytics_events.userId',
    freshness: 'live',
    unit: 'count',
    group: 'audience',
  },
  {
    id: 'visitors_unique',
    label: 'Unique visitors',
    definition:
      'Distinct anonymous visitor ids seen in the period. A visitor id is a random value stored in the browser; it is not a user account.',
    source: 'analytics_events.visitorId',
    freshness: 'live',
    unit: 'count',
    group: 'audience',
  },
  {
    id: 'sessions',
    label: 'Sessions',
    definition: 'Distinct sessions. A session ends after 30 minutes without an event.',
    source: 'analytics_events.sessionId',
    freshness: 'live',
    unit: 'count',
    group: 'engagement',
  },
  {
    id: 'page_views',
    label: 'Page views',
    definition: 'page_view and cultural_place_viewed events.',
    source: 'analytics_events',
    freshness: 'live',
    unit: 'count',
    group: 'engagement',
  },
  {
    id: 'engagement_time',
    label: 'Average engagement time',
    definition:
      'Mean time between a session\'s first and last event, over sessions with at least two events. Sessions with a single event are excluded rather than counted as zero.',
    source: 'analytics_events (session boundaries)',
    freshness: 'estimated',
    unit: 'seconds',
    group: 'engagement',
  },
  {
    id: 'engagement_rate',
    label: 'Engagement rate',
    definition:
      'Share of sessions that lasted 10 seconds or longer or saw more than one page. The inverse of a bounce rate.',
    source: 'analytics_events (session boundaries)',
    freshness: 'estimated',
    unit: 'percent',
    group: 'engagement',
  },
  {
    id: 'place_views',
    label: 'Place detail views',
    definition: 'Cultural place profile views.',
    source: 'analytics_events.cultural_place_viewed',
    freshness: 'live',
    unit: 'count',
    group: 'discovery',
  },
  {
    id: 'ai_conversations',
    label: 'AI conversations',
    definition: 'Times the cultural guide was opened. One conversation may contain several questions.',
    source: 'analytics_events.ai_guide_opened',
    freshness: 'live',
    unit: 'count',
    group: 'ai',
  },
  {
    id: 'ai_questions',
    label: 'AI questions',
    definition: 'Questions submitted to an AI feature, successful or not.',
    source: 'analytics_events.ai_question_submitted',
    freshness: 'live',
    unit: 'count',
    group: 'ai',
  },
  {
    id: 'bookings_completed',
    label: 'Completed bookings',
    definition: 'Bookings in the confirmed state. Recorded by the server when the booking confirms.',
    source: 'bookings table',
    freshness: 'live',
    unit: 'count',
    group: 'commerce',
  },
  {
    id: 'revenue_verified',
    label: 'Verified revenue',
    definition:
      'Sum of successful payments confirmed against the payment provider, net of refunds. Never taken from a browser success screen.',
    source: 'payment_attempts (successful) minus refunds',
    freshness: 'live',
    unit: 'currency',
    group: 'commerce',
  },
  {
    id: 'error_rate',
    label: 'API error rate',
    definition: 'Share of API requests that returned 5xx in the period.',
    source: 'request_metrics',
    freshness: 'live',
    unit: 'percent',
    group: 'platform',
  },
  {
    id: 'api_latency_p95',
    label: 'API latency (p95)',
    definition:
      '95th percentile server response time — 5% of requests are slower than this. Recomputed from per-minute latency histograms, so the value is accurate to the bucket width.',
    source: 'request_metrics (per-minute histogram)',
    freshness: 'estimated',
    unit: 'milliseconds',
    group: 'platform',
  },
];

export function kpiDefinition(id: string): KpiDefinition | undefined {
  return KPI_REGISTRY.find((kpi) => kpi.id === id);
}

// --- Collection constants ---------------------------------------------------

/** Sessions break after this much inactivity, counted from the last event. */
export const SESSION_INACTIVITY_MINUTES = 30;

/** Raw analytics rows older than this are pruned by the retention job. */
export const EVENT_RETENTION_DAYS = 400;

/**
 * Most recent rows any single analytics read will materialise.
 *
 * This is a guard rail, not a target: a range that exceeds it is reported to the
 * dashboard as partial rather than silently answering from a truncated sample.
 * Past this volume the right move is a daily rollup table, not a bigger limit.
 */
export const ANALYTICS_SCAN_LIMIT = 50_000;

/**
 * How far in the past a client-supplied timestamp may sit before the server
 * substitutes its own clock. An offline queue is legitimate, so this is
 * generous — but an event older than a day cannot be placed in a session, and a
 * wrong clock must not scatter events across history.
 */
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

/** How far into the future a client-supplied timestamp may sit before we clamp it. */
export const MAX_FUTURE_DRIFT_MS = 60 * 1000;

/** Bots we recognise by user agent. Deliberately conservative and readable. */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|headlesschrome|curl|wget|python-requests|node-fetch|axios\/|monitor|uptime|pingdom|healthcheck/i;

export function classifyDevice(userAgent: string | undefined | null): DeviceCategory {
  const ua = userAgent ?? '';
  if (!ua) return 'unknown';
  if (BOT_PATTERN.test(ua)) return 'bot';
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android.*mobile|windows phone/i.test(ua)) return 'mobile';
  if (/mozilla|chrome|safari|firefox|edg/i.test(ua)) return 'desktop';
  return 'unknown';
}

export function isBotUserAgent(userAgent: string | undefined | null): boolean {
  return classifyDevice(userAgent) === 'bot';
}

// --- Validation -------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  value?: {
    name: EventName;
    props: EventProps;
    path: string | null;
    resourceId: string | null;
    utm: { source: string | null; medium: string | null; campaign: string | null } | null;
    occurredAt: string;
  };
}

/** Bounded, control-character-free, and never a nested structure. */
function sanitiseString(raw: unknown, spec: Extract<PropSpec, { kind: 'string' }>): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!trimmed) return null;
  const bounded = trimmed.slice(0, spec.maxLength);
  if (spec.enum && !spec.enum.includes(bounded)) return null;
  return bounded;
}

export function validateEventProperties(
  name: EventName,
  raw: unknown,
): { ok: true; props: EventProps } | { ok: false; reason: string } {
  const spec = EVENT_SPECS[name];
  const input = (raw ?? {}) as Record<string, unknown>;
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'props must be an object' };
  }

  const props: EventProps = {};
  for (const [key, value] of Object.entries(input)) {
    const propSpec = spec.props[key];
    // Unknown properties are dropped rather than stored: the allowlist is the schema.
    if (!propSpec) continue;
    if (propSpec.kind === 'string') {
      const clean = sanitiseString(value, propSpec);
      if (clean !== null) props[key] = clean;
      continue;
    }
    if (propSpec.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value < propSpec.min || value > propSpec.max) continue;
      props[key] = propSpec.integer ? Math.round(value) : value;
      continue;
    }
    if (typeof value === 'boolean') props[key] = value;
  }
  return { ok: true, props };
}

/** Validates one inbound client event, dropping anything outside the allowlist. */
export function validateIngestEvent(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'event must be an object' };
  }
  const input = raw as Record<string, unknown>;

  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(id)) {
    return { ok: false, reason: 'event id must be 8-80 characters of [A-Za-z0-9_.:-]' };
  }

  if (!isEventName(input.name)) return { ok: false, reason: 'event name is not recognised' };
  if (!isClientEvent(input.name)) {
    return { ok: false, reason: `${input.name} is server-recorded and cannot be submitted by a client` };
  }
  const name = input.name;

  const occurred = typeof input.occurredAt === 'string' ? Date.parse(input.occurredAt) : NaN;
  if (!Number.isFinite(occurred)) return { ok: false, reason: 'occurredAt must be an ISO timestamp' };

  const properties = validateEventProperties(name, input.props);
  if (!properties.ok) return { ok: false, reason: properties.reason };

  const path = typeof input.path === 'string' ? input.path.slice(0, 300) : null;
  const resourceId = typeof input.resourceId === 'string' ? input.resourceId.slice(0, 200) : null;

  const utmInput = (input.utm ?? null) as Record<string, unknown> | null;
  const utm =
    utmInput && typeof utmInput === 'object'
      ? {
          source: typeof utmInput.source === 'string' ? utmInput.source.slice(0, 80) : null,
          medium: typeof utmInput.medium === 'string' ? utmInput.medium.slice(0, 80) : null,
          campaign: typeof utmInput.campaign === 'string' ? utmInput.campaign.slice(0, 80) : null,
        }
      : null;

  return {
    ok: true,
    value: {
      name,
      props: properties.props,
      path,
      resourceId,
      utm,
      // The server stamps receipt time independently; the client value is only
      // used to order events within a session.
      occurredAt: new Date(occurred).toISOString(),
    },
  };
}
