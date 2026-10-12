import { env } from '../../env';
import type { Booking, Experience, PaymentAttempt, Place, Story } from '../../domain/types';
import type { AiRequestRecord, AnalyticsEventRecord } from '../../domain/analytics';
import type { Repository, RequestMetricRecord, UserRecord } from '../../repo/types';
import { analysePlace } from '../knowledge';
import { alatpayStatus } from '../payments/alatpay';
import { gemmaConfigured } from '../../env';
import type { ResolvedRange } from './range';
import { ANALYTICS_SCAN_LIMIT } from '../../domain/analytics';

export interface RangeScan {
  range: ResolvedRange;
  events: AnalyticsEventRecord[];
  previousEvents: AnalyticsEventRecord[];
  /** True when either period hit the scan cap, so figures are partial. */
  truncated: boolean;
  /** Rows actually read, so the dashboard can be explicit about the sample. */
  scanned: { current: number; previous: number };
}

/**
 * Reads both the selected period and the one before it in a single pass each.
 * Children of a range always ask for both: a figure without its comparison is
 * half an answer.
 */
export async function loadRange(repo: Repository, range: ResolvedRange): Promise<RangeScan> {
  const [events, previousEvents] = await Promise.all([
    repo.listAnalyticsEvents({ from: range.from, to: range.to }),
    repo.listAnalyticsEvents({ from: range.previousFrom, to: range.previousTo }),
  ]);

  return {
    range,
    events,
    previousEvents,
    truncated:
      events.length >= ANALYTICS_SCAN_LIMIT || previousEvents.length >= ANALYTICS_SCAN_LIMIT,
    scanned: { current: events.length, previous: previousEvents.length },
  };
}

export interface CommerceData {
  bookings: Booking[];
  payments: PaymentAttempt[];
  experiences: Experience[];
  providerConfigured: boolean;
  currency: string;
}

export async function loadCommerce(repo: Repository): Promise<CommerceData> {
  const [bookings, payments, experiences] = await Promise.all([
    repo.listBookings(),
    repo.listPaymentAttempts(),
    repo.listExperiences(),
  ]);
  return {
    bookings,
    payments,
    experiences,
    providerConfigured: alatpayStatus().configured,
    currency: env.currency,
  };
}

export interface CultureData {
  places: Place[];
  stories: Story[];
  /** Places where the checked sources leave gaps — an editorial queue. */
  incomplete: Array<{
    id: string;
    name: string;
    category: string;
    coveredDimensions: number;
    totalDimensions: number;
    needsResearch: boolean;
  }>;
}

export async function loadCulture(repo: Repository): Promise<CultureData> {
  const [places, stories] = await Promise.all([repo.listPlaces({}), repo.listStories()]);

  const incomplete = places
    .map((place) => {
      const analysis = analysePlace(place);
      return {
        id: place.id,
        name: place.name,
        category: place.category,
        coveredDimensions: analysis.coveredDimensions,
        totalDimensions: analysis.totalDimensions,
        needsResearch: analysis.needsResearch,
      };
    })
    .filter((place) => place.needsResearch)
    .sort((a, b) => a.coveredDimensions - b.coveredDimensions);

  return { places, stories, incomplete };
}

export interface AiData {
  requests: AiRequestRecord[];
  previousRequests: AiRequestRecord[];
  configured: boolean;
}

export async function loadAi(repo: Repository, range: ResolvedRange): Promise<AiData> {
  const [requests, previousRequests] = await Promise.all([
    repo.listAiRequests({ from: range.from, to: range.to }),
    repo.listAiRequests({ from: range.previousFrom, to: range.previousTo }),
  ]);
  return { requests, previousRequests, configured: gemmaConfigured() };
}

export interface PlatformData {
  metrics: RequestMetricRecord[];
  previousMetrics: RequestMetricRecord[];
}

export async function loadPlatform(repo: Repository, range: ResolvedRange): Promise<PlatformData> {
  const [metrics, previousMetrics] = await Promise.all([
    repo.listRequestMetrics({ from: range.from, to: range.to }),
    repo.listRequestMetrics({ from: range.previousFrom, to: range.previousTo }),
  ]);
  return { metrics, previousMetrics };
}

export interface UserDirectoryData {
  users: UserRecord[];
  total: number;
}

export async function loadUsers(
  repo: Repository,
  query: Parameters<Repository['listUsers']>[0],
): Promise<UserDirectoryData> {
  const page = await repo.listUsers(query);
  return { users: page.users, total: page.total };
}

/** Every account, for aggregate counts only — never sent to the browser whole. */
export async function loadAllUsers(repo: Repository): Promise<UserRecord[]> {
  const page = await repo.listUsers({ limit: 10_000, offset: 0 });
  return page.users;
}
