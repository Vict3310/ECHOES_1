/**
 * Types and formatters for the analytics console.
 *
 * The formatters exist so a number is never printed raw: an operator reading
 * "1.2e+6" or "0.073" has to stop and convert it, and a metric that needs
 * converting before it can be read is a metric that gets misread.
 */

export type Freshness = 'live' | 'delayed' | 'estimated' | 'unavailable';
export type KpiUnit = 'count' | 'percent' | 'seconds' | 'currency' | 'milliseconds';
export type KpiGroup = 'audience' | 'engagement' | 'discovery' | 'ai' | 'commerce' | 'platform';

export interface KpiValue {
  id: string;
  label: string;
  definition: string;
  source: string;
  freshness: Freshness;
  unit: KpiUnit;
  group: KpiGroup;
  value: number | null;
  previous: number | null;
  absoluteChange: number | null;
  /** Null when the previous period was zero: there is no percentage of nothing. */
  percentChange: number | null;
  unavailableReason?: string;
}

export interface RangePayload {
  preset: 'today' | '7d' | '30d' | '90d' | 'custom';
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  bucket: 'hour' | 'day' | 'week';
  label: string;
  timezone: string;
}

export interface DataFreshness {
  generatedAt: string;
  timezone: string;
  collectionStart: string | null;
  lastEventAt: string | null;
  totalEventsStored: number;
  retentionDays: number;
  partial: boolean;
  scannedEvents: { current: number; previous: number };
  caveats: string[];
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
  partial: boolean;
}

export interface Ranking {
  key: string;
  label: string;
  count: number;
}

export interface FunnelStep {
  id: string;
  label: string;
  value: number | null;
  fromPreviousPercent: number | null;
  note?: string;
}

export interface SessionStats {
  sessions: number;
  engagedSessions: number;
  engagementRatePercent: number | null;
  averageEngagementSeconds: number | null;
  singleEventSessions: number;
}

export interface OverviewPayload {
  range: RangePayload;
  freshness: DataFreshness;
  kpis: KpiValue[];
  series: SeriesPoint[];
  topPages: Ranking[];
  topPlaces: Array<Ranking & { category: string | null }>;
  unviewedPlaces: Array<{ id: string; name: string; category: string; sourceCount: number }>;
  trafficSources: Ranking[];
  devices: Array<Ranking & { device: string }>;
  campaigns: Ranking[];
  funnel: FunnelStep[];
  engagement: SessionStats & { previous: SessionStats };
}

export interface DiscoveryPayload {
  range: RangePayload;
  freshness: DataFreshness;
  summary: {
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
  };
  topPlaces: Array<Ranking & { category: string | null }>;
  topPaths: Ranking[];
  searches: {
    searches: number;
    zeroResultSearches: number;
    zeroResultRatePercent: number | null;
    top: Ranking[];
    noResults: Ranking[];
  };
  unviewedPlaces: Array<{ id: string; name: string; category: string; sourceCount: number }>;
  incompleteInformation: Array<{
    id: string;
    name: string;
    category: string;
    coveredDimensions: number;
    totalDimensions: number;
    needsResearch: boolean;
  }>;
  stories: {
    submittedInPeriod: number;
    startedInPeriod: number;
    backlog: number;
    byStatus: { pending: number; approved: number; rejected: number; needsCorrection: number };
    recent: Array<{
      id: string;
      reference: string;
      status: string;
      placeId: string | null;
      suggestedPlaceName: string | null;
      sensitivity: string;
      createdAt: string;
    }>;
  };
  integrity: { note: string; incompletenessIsInformationGap: boolean };
}

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
  estimatedCostMicros: number | null;
  costCoverage: { pricedRequests: number; unpricedRequests: number };
  providerCostMinor: number | null;
  providerCostAvailable: boolean;
  costPerSuccessfulRequestMicros: number | null;
  byFeature: Array<Ranking & { failureRatePercent: number | null; estimatedCostMicros: number }>;
  byModel: Array<Ranking & { estimatedCostMicros: number }>;
  series: Array<{ start: string; label: string; requests: number; failed: number; estimatedCostMicros: number }>;
}

export interface BudgetStatus {
  configured: boolean;
  daily: { limitMicros: number; spentMicros: number; percentUsed: number | null; exceeded: boolean };
  monthly: { limitMicros: number; spentMicros: number; percentUsed: number | null; exceeded: boolean };
  alertThresholdPercent: number;
  alerting: boolean;
  currency: 'USD';
  note: string;
}

export interface AiPayload {
  range: RangePayload;
  freshness: DataFreshness;
  configured: boolean;
  provider: string;
  model: string;
  rollup: AiRollup;
  previous: { requests: number; failed: number; estimatedCostMicros: number | null };
  costTrendPercent: number | null;
  budget: BudgetStatus;
  kpis: KpiValue[];
  today: { day: string; requests: number; failed: number; guideCalls: number };
  notes: string[];
}

export interface CommercePayload {
  range: RangePayload;
  freshness: DataFreshness;
  rollup: {
    attempts: number;
    confirmed: number;
    cancelled: number;
    failed: number;
    pendingPayment: number;
    expired: number;
    conversionRatePercent: number | null;
    popularExperiences: Array<Ranking & { revenueMinor: number }>;
    upcoming: Array<{
      experienceId: string;
      title: string;
      scheduleId: string;
      startsAt: string;
      booked: number;
      capacity: number;
    }>;
    grossVerifiedMinor: number;
    refundsMinor: null;
    refundsAvailable: false;
    refundsNote: string;
    netCollectedMinor: number;
    currency: string;
    failedPayments: number;
    pendingPayments: number;
    paymentProviderConfigured: boolean;
  };
  kpis: KpiValue[];
  funnel: FunnelStep[];
  recentBookings: Array<{
    reference: string;
    status: string;
    experienceTitle: string | null;
    participants: number;
    totalMinor: number;
    currency: string;
    createdAt: string;
    updatedAt: string;
    customer: string;
  }>;
  recentPayments: Array<{
    reference: string;
    status: string;
    providerStatus: string | null;
    amountMinor: number;
    currency: string;
    createdAt: string;
    updatedAt: string;
    reconciliation: string;
  }>;
  payments: { configured: boolean; note: string };
}

export interface UsersPayload {
  range: RangePayload;
  freshness: DataFreshness;
  summary: {
    total: number;
    active: number;
    suspended: number;
    newInPeriod: number;
    previousNewInPeriod: number;
    newChangePercent: number | null;
    activeInPeriod: number;
    withNoRecordedActivity: number;
    byRole: Array<{ role: string; count: number }>;
  };
  rows: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    status: 'active' | 'suspended';
    suspendedAt: string | null;
    createdAt: string;
    lastActiveAt: string | null;
    eventsInPeriod: number;
    sessionsInPeriod: number;
    signupSource: string | null;
    activityNote: string | null;
  }>;
  pagination: { total: number; returned: number };
  privacy: { note: string };
}

export interface HealthPayload {
  range: RangePayload;
  freshness: DataFreshness;
  status: string;
  uptimeSeconds: number;
  store: string;
  rollup: {
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
  };
  kpis: KpiValue[];
  recentErrors: Array<{
    at: string;
    route: string;
    method: string;
    status: number;
    code: string;
    requestId: string | null;
    message: string;
  }>;
  integrations: Record<string, Record<string, unknown>>;
  logNote: string;
}

// --- Formatting -------------------------------------------------------------

const numberFormat = new Intl.NumberFormat('en-GB');

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return numberFormat.format(Math.round(value * 100) / 100);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatMilliseconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(2)} s`;
}

export function formatMoneyMinor(minor: number | null | undefined, currency = 'NGN'): string {
  if (minor === null || minor === undefined) return '—';
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: major < 1_000 ? 2 : 0,
    }).format(major);
  } catch {
    return `${currency} ${numberFormat.format(major)}`;
  }
}

export function formatMicrosUsd(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return '—';
  const dollars = micros / 1_000_000;
  if (dollars === 0) return '$0.00';
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

/** Renders a KPI value according to its unit, never as a bare float. */
export function formatKpiValue(
  value: number | null,
  unit: KpiUnit,
  currency = 'NGN',
): string {
  if (value === null || value === undefined) return '—';
  switch (unit) {
    case 'percent':
      return formatPercent(value);
    case 'seconds':
      return formatDuration(value);
    case 'milliseconds':
      return formatMilliseconds(value);
    case 'currency':
      return formatMoneyMinor(value, currency);
    default:
      return formatCount(value);
  }
}

export interface ChangeDisplay {
  direction: 'up' | 'down' | 'flat' | 'unknown' | 'new';
  text: string;
  absoluteText: string;
  title: string;
}

/**
 * Describes a period-over-period change.
 *
 * `new` is its own state: activity in a period that follows a zero one has no
 * percentage, and printing "+100%" or "∞" there would be a made-up number.
 */
export function changeDisplay(kpi: KpiValue, currency = 'NGN'): ChangeDisplay {
  if (kpi.value === null) {
    return { direction: 'unknown', text: 'no data', absoluteText: '—', title: kpi.unavailableReason ?? 'Unavailable.' };
  }
  if (kpi.previous === null) {
    return { direction: 'unknown', text: 'no comparison', absoluteText: '—', title: 'No earlier period to compare against.' };
  }
  const absoluteText = formatKpiValue(Math.abs(kpi.absoluteChange ?? 0), kpi.unit, currency);

  if (kpi.percentChange === null) {
    return {
      direction: kpi.value > 0 ? 'new' : 'flat',
      text: kpi.value > 0 ? 'new activity' : 'no change',
      absoluteText,
      title:
        'The previous period recorded nothing, so there is no percentage to compare — the change is shown as an absolute figure.',
    };
  }
  if (kpi.percentChange === 0) {
    return { direction: 'flat', text: 'no change', absoluteText, title: 'Identical to the previous period.' };
  }
  return {
    direction: kpi.percentChange > 0 ? 'up' : 'down',
    text: `${kpi.percentChange > 0 ? '+' : ''}${kpi.percentChange.toFixed(1)}%`,
    absoluteText,
    title: `Previous period: ${formatKpiValue(kpi.previous, kpi.unit, currency)}`,
  };
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: 'live',
  delayed: 'delayed',
  estimated: 'estimated',
  unavailable: 'unavailable',
};

export const FRESHNESS_STYLE: Record<Freshness, string> = {
  live: 'border-brand-deep/25 bg-brand-soft/60 text-brand-deep',
  delayed: 'border-[#C8973F]/30 bg-[#C8973F]/10 text-[#7A5518]',
  estimated: 'border-black/15 bg-black/[0.04] text-black/55',
  unavailable: 'border-[#B4432A]/25 bg-[#B4432A]/[0.07] text-[#7A2C1B]',
};

export const RANGE_PRESETS: Array<{ id: 'today' | '7d' | '30d' | '90d' | 'custom'; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'custom', label: 'Custom range' },
];
