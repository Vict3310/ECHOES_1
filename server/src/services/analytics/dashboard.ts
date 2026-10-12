/**
 * Dashboard composition.
 *
 * Each function turns loaded rows into exactly what one part of the console
 * renders, so the route layer stays thin and the numbers stay testable. Every
 * payload carries the range it was computed for, a data-freshness stamp, and any
 * caveat that would change how a figure should be read (partial data, missing
 * history, an unavailable integration).
 */

import type { AiRequestRecord, AnalyticsEventRecord } from '../../domain/analytics';
import { env, gemmaConfigured } from '../../env';
import type { UserRecord } from '../../repo/types';
import {
  activeUsers,
  buildSeries,
  conversionFunnel,
  countOf,
  deviceBreakdown,
  kpi,
  newUsersInRange,
  percentChange,
  registrationsForSeries,
  rollupAi,
  rollupCommerce,
  rollupDiscovery,
  rollupRequests,
  searchInsights,
  sessionStats,
  signupSourceIndex,
  summarise,
  topPaths,
  topPlaceViews,
  trafficSources,
  unviewedPlaces,
  userActivityIndex,
  campaignBreakdown,
  type KpiValue,
} from './aggregate';
import { budgetStatus } from './ai';
import type { AiData, CommerceData, CultureData, PlatformData, RangeScan } from './load';
import { recentServerErrors } from '../../middleware/metrics';
import type { ResolvedRange } from './range';

export interface Freshness {
  generatedAt: string;
  timezone: string;
  /** Earliest event ever recorded — before this, an empty chart means "no data". */
  collectionStart: string | null;
  lastEventAt: string | null;
  totalEventsStored: number;
  retentionDays: number;
  /** True when a scan cap was hit, so the period's figures are a partial read. */
  partial: boolean;
  scannedEvents: { current: number; previous: number };
  caveats: string[];
}

export function freshnessFor(
  scan: RangeScan,
  coverage: { firstEventAt: string | null; lastEventAt: string | null; total: number },
): Freshness {
  const caveats: string[] = [];
  if (scan.truncated) {
    caveats.push(
      'This period holds more events than one read can scan, so the figures below are computed from a partial sample. Narrow the date range for exact totals.',
    );
  }
  if (!coverage.firstEventAt) {
    caveats.push(
      'No events have been recorded yet. Charts are empty because nothing has been collected, not because traffic is zero.',
    );
  } else if (coverage.firstEventAt > scan.range.from) {
    caveats.push(
      `Collection began on ${coverage.firstEventAt.slice(0, 10)}. Earlier dates in this range have no recorded data — they are not zero.`,
    );
  }
  if (scan.range.timezone !== 'UTC') {
    caveats.push(`Days are measured in ${scan.range.timezone}.`);
  }
  return {
    generatedAt: new Date().toISOString(),
    timezone: scan.range.timezone,
    collectionStart: coverage.firstEventAt,
    lastEventAt: coverage.lastEventAt,
    totalEventsStored: coverage.total,
    retentionDays: env.analytics.retentionDays,
    partial: scan.truncated,
    scannedEvents: scan.scanned,
    caveats,
  };
}

export interface RangePayload {
  preset: ResolvedRange['preset'];
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  bucket: ResolvedRange['bucket'];
  label: string;
  timezone: string;
}

export function rangePayload(range: ResolvedRange): RangePayload {
  return {
    preset: range.preset,
    from: range.from,
    to: range.to,
    previousFrom: range.previousFrom,
    previousTo: range.previousTo,
    bucket: range.bucket,
    label: range.label,
    timezone: range.timezone,
  };
}

export interface OverviewPayload {
  range: RangePayload;
  freshness: Freshness;
  kpis: KpiValue[];
  series: ReturnType<typeof buildSeries>;
  topPages: ReturnType<typeof topPaths>;
  topPlaces: ReturnType<typeof topPlaceViews>;
  unviewedPlaces: ReturnType<typeof unviewedPlaces>;
  trafficSources: ReturnType<typeof trafficSources>;
  devices: ReturnType<typeof deviceBreakdown>;
  campaigns: ReturnType<typeof campaignBreakdown>;
  funnel: ReturnType<typeof conversionFunnel>;
  engagement: ReturnType<typeof sessionStats> & { previous: ReturnType<typeof sessionStats> };
}

export function buildOverview(input: {
  scan: RangeScan;
  coverage: { firstEventAt: string | null; lastEventAt: string | null; total: number };
  commerce: CommerceData;
  culture: CultureData;
  users: UserRecord[];
  platform: PlatformData;
}): OverviewPayload {
  const { scan, commerce, culture, users } = input;
  const { range, events, previousEvents } = scan;

  const current = summarise(events);
  const previous = summarise(previousEvents);
  const active = activeUsers(events, range);
  const previousActive = activeUsers(previousEvents, {
    ...range,
    from: range.previousFrom,
    to: range.previousTo,
  });
  const sessions = sessionStats(events);
  const previousSessions = sessionStats(previousEvents);

  const commerceRollup = rollupCommerce({
    bookings: commerce.bookings,
    payments: commerce.payments,
    experiences: commerce.experiences,
    range,
    providerConfigured: commerce.providerConfigured,
    currency: commerce.currency,
  });
  const previousCommerce = rollupCommerce({
    bookings: commerce.bookings,
    payments: commerce.payments,
    experiences: commerce.experiences,
    range: { ...range, from: range.previousFrom, to: range.previousTo },
    providerConfigured: commerce.providerConfigured,
    currency: commerce.currency,
  });

  const platform = rollupRequests(input.platform.metrics, range);

  const newUsers = newUsersInRange(users, range).length;
  const previousNewUsers = newUsersInRange(users, {
    ...range,
    from: range.previousFrom,
    to: range.previousTo,
  }).length;
  const usersAtPreviousEnd = users.filter((user) => user.createdAt <= range.previousTo).length;

  const confirmedInRange = commerce.bookings.filter(
    (booking) => booking.status === 'confirmed' && booking.updatedAt >= range.from && booking.updatedAt <= range.to,
  ).length;
  const confirmedPrevious = commerce.bookings.filter(
    (booking) =>
      booking.status === 'confirmed' &&
      booking.updatedAt >= range.previousFrom &&
      booking.updatedAt <= range.previousTo,
  ).length;

  const platformPrevious = rollupRequests(input.platform.previousMetrics, {
    ...range,
    from: range.previousFrom,
    to: range.previousTo,
  });

  const pageViews = countOf(current, 'page_view', 'cultural_place_viewed');
  const previousPageViews = countOf(previous, 'page_view', 'cultural_place_viewed');

  const placeViews = topPlaceViews(events, culture.places, 10);
  const discovery = rollupDiscovery({
    events,
    places: culture.places,
    stories: culture.stories,
    range,
    topPlaceViews: placeViews,
  });

  const kpis: KpiValue[] = [
    kpi('users_total', users.length, usersAtPreviousEnd),
    kpi('users_new', newUsers, previousNewUsers),
    kpi('dau', active.dau, previousActive.dau),
    kpi('wau', active.wau, previousActive.wau),
    kpi('mau', active.mau, previousActive.mau),
    kpi('visitors_unique', current.visitors, previous.visitors),
    kpi('sessions', sessions.sessions, previousSessions.sessions),
    kpi('page_views', pageViews, previousPageViews),
    kpi('engagement_time', sessions.averageEngagementSeconds, previousSessions.averageEngagementSeconds),
    kpi('engagement_rate', sessions.engagementRatePercent, previousSessions.engagementRatePercent),
    kpi('place_views', discovery.placeViews, countOf(previous, 'cultural_place_viewed')),
    kpi('ai_conversations', countOf(current, 'ai_guide_opened'), countOf(previous, 'ai_guide_opened')),
    kpi('ai_questions', countOf(current, 'ai_question_submitted'), countOf(previous, 'ai_question_submitted')),
    kpi('bookings_completed', confirmedInRange, confirmedPrevious),
    kpi(
      'revenue_verified',
      commerce.providerConfigured || commerceRollup.attempts > 0 ? commerceRollup.grossVerifiedMinor : null,
      commerce.providerConfigured || previousCommerce.attempts > 0 ? previousCommerce.grossVerifiedMinor : null,
    ),
    kpi('error_rate', platform.errorRatePercent, platformPrevious.errorRatePercent),
    kpi('api_latency_p95', platform.latencyP95Ms, platformPrevious.latencyP95Ms),
  ];

  return {
    range: rangePayload(range),
    freshness: freshnessFor(scan, input.coverage),
    kpis,
    series: buildSeries(events, registrationsForSeries(users), range),
    topPages: topPaths(events),
    topPlaces: placeViews,
    unviewedPlaces: unviewedPlaces(events, culture.places),
    trafficSources: trafficSources(events),
    devices: deviceBreakdown(events),
    campaigns: campaignBreakdown(events),
    funnel: conversionFunnel({
      visitors: current.visitors,
      discoveryVisitors: new Set(
        events
          .filter((event) => event.name === 'cultural_place_viewed')
          .map((event) => event.visitorId)
          .filter((id): id is string => Boolean(id)),
      ).size,
      registrations: newUsers,
      bookingStarts: commerceRollup.attempts,
      confirmedBookings: confirmedInRange,
      verifiedPayments: commerce.providerConfigured ? commerceRollup.confirmed : null,
    }),
    engagement: { ...sessions, previous: previousSessions },
  };
}

export function buildDiscovery(input: {
  scan: RangeScan;
  culture: CultureData;
  coverage: { firstEventAt: string | null; lastEventAt: string | null; total: number };
}) {
  const { scan, culture } = input;
  const topPlaces = topPlaceViews(scan.events, culture.places, 12);
  const discovery = rollupDiscovery({
    events: scan.events,
    places: culture.places,
    stories: culture.stories,
    range: scan.range,
    topPlaceViews: topPlaces,
  });

  return {
    range: rangePayload(scan.range),
    freshness: freshnessFor(scan, input.coverage),
    summary: discovery,
    topPlaces,
    topPaths: topPaths(scan.events, 8),
    searches: searchInsights(scan.events),
    unviewedPlaces: unviewedPlaces(scan.events, culture.places, 15),
    incompleteInformation: culture.incomplete.slice(0, 15),
    stories: {
      submittedInPeriod: discovery.storySubmissions,
      startedInPeriod: discovery.storySubmissionsStarted,
      backlog: culture.stories.filter((story) => story.status === 'pending').length,
      byStatus: discovery.moderation,
      recent: culture.stories
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
        .map((story) => ({
          id: story.id,
          reference: story.reference,
          status: story.status,
          placeId: story.placeId,
          suggestedPlaceName: story.suggestedPlaceName,
          sensitivity: story.sensitivity,
          createdAt: story.createdAt,
        })),
    },
    integrity: {
      note: 'A place with few recorded views, or none at all, is a gap in what ECHOES has digitised or verified — not evidence that the cultural knowledge does not exist.',
      incompletenessIsInformationGap: true,
    },
  };
}

export function buildAiSection(input: {
  ai: AiData;
  scan: RangeScan;
  coverage: { firstEventAt: string | null; lastEventAt: string | null; total: number };
}) {
  const { ai, scan } = input;
  const rollup = rollupAi(ai.requests, scan.range);
  const previousRollup = rollupAi(ai.previousRequests, {
    ...scan.range,
    from: scan.range.previousFrom,
    to: scan.range.previousTo,
  });

  const dayKey = scan.range.to.slice(0, 10);
  const monthKey = scan.range.to.slice(0, 7);
  const spendFor = (requests: AiRequestRecord[], predicate: (request: AiRequestRecord) => boolean): number =>
    requests.filter(predicate).reduce((sum, request) => sum + (request.estimatedCostMicros ?? 0), 0);

  const budget = budgetStatus(
    // "Today" is the last day of the selected range, which is what an operator
    // looking at a live dashboard means by it.
    spendFor(ai.requests, (request) => request.createdAt.startsWith(dayKey)),
    spendFor(ai.requests, (request) => request.createdAt.startsWith(monthKey)),
  );

  const guideCalls = ai.requests.filter((request) => request.feature === 'guide').length;
  const failedToday = ai.requests.filter(
    (request) => !request.ok && request.createdAt.startsWith(dayKey),
  ).length;

  return {
    range: rangePayload(scan.range),
    freshness: freshnessFor(scan, input.coverage),
    configured: ai.configured,
    provider: env.gemma.provider,
    model: env.gemma.model,
    rollup,
    previous: {
      requests: previousRollup.requests,
      failed: previousRollup.failed,
      estimatedCostMicros: previousRollup.estimatedCostMicros,
    },
    costTrendPercent: percentChange(rollup.estimatedCostMicros ?? 0, previousRollup.estimatedCostMicros ?? 0),
    budget,
    kpis: [
      kpi('ai_questions', countOf(summarise(scan.events), 'ai_question_submitted'), null),
      {
        ...kpi('ai_success_rate', rollup.requests === 0 ? null : 100 - (rollup.failureRatePercent ?? 0), null),
        label: 'Successful AI requests',
        unit: 'percent' as const,
        definition: 'Share of provider calls that returned a usable response.',
        source: 'ai_requests.ok',
        freshness: rollup.requests === 0 ? ('unavailable' as const) : ('live' as const),
        group: 'ai' as const,
      },
    ],
    today: {
      day: dayKey,
      requests: ai.requests.filter((request) => request.createdAt.startsWith(dayKey)).length,
      failed: failedToday,
      guideCalls,
    },
    notes: [
      'Costs are estimated from published token prices, unless the provider reported an amount. They are a budgeting signal, not an invoice.',
      'Prompts, answers and any personal information inside them are never stored — only feature, model, timing, token counts and outcome.',
    ].filter(Boolean),
  };
}

export function buildUsersSection(input: {
  users: UserRecord[];
  scan: RangeScan;
  coverage: { firstEventAt: string | null; lastEventAt: string | null; total: number };
  page: { users: UserRecord[]; total: number };
}) {
  const { scan, page } = input;
  const activity = userActivityIndex(scan.events);
  const sources = signupSourceIndex(scan.events);
  const all = input.users;

  const newInRange = newUsersInRange(all, scan.range);
  const previousNew = newUsersInRange(all, {
    ...scan.range,
    from: scan.range.previousFrom,
    to: scan.range.previousTo,
  });
  const activeInRange = new Set(
    scan.events.map((event) => event.userId).filter((id): id is string => Boolean(id)),
  );

  return {
    range: rangePayload(scan.range),
    freshness: freshnessFor(scan, input.coverage),
    summary: {
      total: all.length,
      active: all.filter((user) => user.status === 'active').length,
      suspended: all.filter((user) => user.status === 'suspended').length,
      newInPeriod: newInRange.length,
      previousNewInPeriod: previousNew.length,
      newChangePercent: percentChange(newInRange.length, previousNew.length),
      activeInPeriod: activeInRange.size,
      /** Accounts with no recorded event at all — they exist, we just cannot say more. */
      withNoRecordedActivity: all.filter((user) => !activity.has(user.id)).length,
      byRole: Object.entries(
        all.reduce<Record<string, number>>((counts, user) => {
          counts[user.role] = (counts[user.role] ?? 0) + 1;
          return counts;
        }, {}),
      ).map(([role, count]) => ({ role, count })),
    },
    rows: page.users.map((user) => {
      const userEvents = activity.get(user.id);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        suspendedAt: user.suspendedAt,
        createdAt: user.createdAt,
        lastActiveAt: userEvents?.lastActiveAt ?? null,
        eventsInPeriod: userEvents?.events ?? 0,
        sessionsInPeriod: userEvents?.sessions ?? 0,
        signupSource: sources.get(user.id) ?? null,
        activityNote:
          userEvents === undefined
            ? 'No recorded activity in the selected period. It may predate collection, or the account may not have been used.'
            : null,
      };
    }),
    pagination: { total: page.total, returned: page.users.length },
    privacy: {
      note: 'Passwords, tokens and reset links are never returned by this API, and no analytics property is ever joined to a person.',
    },
  };
}

export function buildCommerceSection(input: {
  commerce: CommerceData;
  scan: RangeScan;
  coverage: { firstEventAt: string | null; lastEventAt: string | null; total: number };
}) {
  const { commerce, scan } = input;
  const rollup = rollupCommerce({
    bookings: commerce.bookings,
    payments: commerce.payments,
    experiences: commerce.experiences,
    range: scan.range,
    providerConfigured: commerce.providerConfigured,
    currency: commerce.currency,
  });
  const previous = rollupCommerce({
    bookings: commerce.bookings,
    payments: commerce.payments,
    experiences: commerce.experiences,
    range: { ...scan.range, from: scan.range.previousFrom, to: scan.range.previousTo },
    providerConfigured: commerce.providerConfigured,
    currency: commerce.currency,
  });

  const summary = summarise(scan.events);
  const confirmedInRange = commerce.bookings.filter(
    (booking) =>
      booking.status === 'confirmed' && booking.updatedAt >= scan.range.from && booking.updatedAt <= scan.range.to,
  ).length;

  return {
    range: rangePayload(scan.range),
    freshness: freshnessFor(scan, input.coverage),
    rollup,
    kpis: [
      {
        ...kpi('bookings_started', rollup.attempts, previous.attempts),
        label: 'Bookings started',
        definition: 'Booking records created in the period, whether or not payment followed.',
        source: 'bookings.createdAt',
        unit: 'count' as const,
        group: 'commerce' as const,
      },
      kpi('bookings_completed', rollup.confirmed, previous.confirmed),
      {
        ...kpi('booking_conversion', rollup.conversionRatePercent, previous.conversionRatePercent),
        label: 'Booking conversion',
        definition: 'Share of bookings created in the period that reached the confirmed state.',
        source: 'bookings.status',
        unit: 'percent' as const,
        group: 'commerce' as const,
      },
      kpi(
        'revenue_verified',
        commerce.providerConfigured || rollup.attempts > 0 ? rollup.grossVerifiedMinor : null,
        commerce.providerConfigured || previous.attempts > 0 ? previous.grossVerifiedMinor : null,
      ),
    ],
    funnel: conversionFunnel({
      visitors: summary.visitors,
      discoveryVisitors: new Set(
        scan.events
          .filter((event) => event.name === 'cultural_place_viewed')
          .map((event) => event.visitorId)
          .filter((id): id is string => Boolean(id)),
      ).size,
      registrations: countOf(summary, 'user_registered'),
      bookingStarts: rollup.attempts,
      confirmedBookings: confirmedInRange,
      verifiedPayments: commerce.providerConfigured ? rollup.confirmed : null,
    }),
    recentBookings: commerce.bookings
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((booking) => ({
        reference: booking.reference,
        status: booking.status,
        experienceId: booking.experienceId,
        experienceTitle: commerce.experiences.find((e) => e.id === booking.experienceId)?.title ?? null,
        participants: booking.participants,
        totalMinor: booking.totalMinor,
        currency: booking.currency,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        // Contact details are shown only as a masked address: an operator rarely
        // needs the full one, and it stops the dashboard becoming a data dump.
        customer: maskEmail(booking.customerEmail),
      })),
    recentPayments: commerce.payments
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 20)
      .map((payment) => ({
        reference: payment.reference,
        status: payment.status,
        providerStatus: payment.providerStatus,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        // No card data is ever stored, so there is nothing to redact here.
        reconciliation: payment.providerStatus ? 'provider-reported' : 'awaiting provider detail',
      })),
    payments: {
      configured: commerce.providerConfigured,
      note: commerce.providerConfigured
        ? 'Revenue counts only payments the server confirmed against the provider. A browser success screen is never treated as payment.'
        : 'No payment provider is configured, so no revenue can be verified. Bookings may still be created and will remain unconfirmed.',
    },
  };
}

/** `ada.okafor@example.com` → `a***@example.com`: enough to recognise, not to collect. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '—';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function buildHealthSection(input: {
  platform: PlatformData;
  ai: AiData;
  scan: RangeScan;
  coverage: { firstEventAt: string | null; lastEventAt: string | null; total: number };
  store: 'postgres' | 'memory';
  uploadsNote: string;
}) {
  const { platform, scan, ai } = input;
  const rollup = rollupRequests(platform.metrics, scan.range);
  const previous = rollupRequests(platform.previousMetrics, {
    ...scan.range,
    from: scan.range.previousFrom,
    to: scan.range.previousTo,
  });
  const aiRollup = rollupAi(ai.requests, scan.range);

  return {
    range: rangePayload(scan.range),
    freshness: freshnessFor(scan, input.coverage),
    status: rollup.serverErrors === 0 ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    store: input.store,
    rollup,
    kpis: [
      kpi('error_rate', rollup.errorRatePercent, previous.errorRatePercent),
      kpi('api_latency_p95', rollup.latencyP95Ms, previous.latencyP95Ms),
      {
        ...kpi('requests_total', rollup.requests, previous.requests),
        label: 'API requests',
        definition: 'Requests handled in the period, from per-minute aggregates rather than per-request rows.',
        source: 'request_metrics',
        unit: 'count' as const,
        group: 'platform' as const,
      },
    ],
    recentErrors: recentServerErrors(20),
    integrations: {
      ai: {
        provider: env.gemma.provider,
        model: env.gemma.model,
        configured: gemmaConfigured(),
        failureRatePercent: aiRollup.failureRatePercent,
        rateLimited: aiRollup.rateLimited,
        timeouts: aiRollup.timeouts,
        note: 'Provider errors and timeouts are counted from logged AI requests. When no provider is configured, questions are answered from stored records instead.',
      },
      routing: {
        provider: env.routing.provider,
        note: 'Route requests are counted from the route_requested event; provider failures appear in the outcomes.',
      },
      uploads: { note: input.uploadsNote },
      deployment: {
        available: false,
        note: 'No deployment metadata source is configured, so the running commit and deploy time are not shown. The uptime figure below is process uptime.',
      },
    },
    logNote:
      'Server errors are summarised above by route and correlation id. Stack traces stay in the structured logs and are never exposed here.',
  };
}
