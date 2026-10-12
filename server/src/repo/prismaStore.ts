import {
  PrismaClient,
  type BookingStatus as PrismaBookingStatus,
  type PaymentStatus as PrismaPaymentStatus,
  type Prisma,
  type StoryStatus as PrismaStoryStatus,
  type UserRole as PrismaUserRole,
  type UserStatus as PrismaUserStatus,
} from '@prisma/client';
import { ApiError } from '../lib/errors';
import { bookingReference, storyReference } from '../lib/ids';
import type {
  AuditRecord,
  Booking,
  BookingStatus,
  PaymentAttempt,
  PaymentStatus,
  Story,
  StoryStatus,
} from '../domain/types';
import type {
  CreatePaymentAttemptInput,
  CreateStoryInput,
  PasswordResetRecord,
  RequestMetricRecord,
  UserListQuery,
  UserPage,
  UserRecord,
  UserStatus,
} from './types';
import {
  ANALYTICS_SCAN_LIMIT,
  type AiRequestRecord,
  type AnalyticsEventRecord,
  type DeviceCategory,
  type EventName,
  type EventProps,
} from '../domain/analytics';
import { logger as log } from '../lib/logger';

export interface ReserveBookingArgs {
  experienceId: string;
  scheduleId: string;
  participants: number;
  unitPriceMinor: number;
  currency: string;
  /** Total seats already taken by the sample dataset for this schedule. */
  baselineBooked: number;
  capacity: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
}

/**
 * Transactional store. Reference data (places, experiences) deliberately stays
 * out of here — see the header of prisma/schema.prisma for why.
 */
export class PrismaStore {
  constructor(private readonly prisma: PrismaClient) {}

  // --- Bookings --------------------------------------------------------------

  /**
   * Reserves seats inside a transaction guarded by a Postgres advisory lock on
   * the schedule id, so two concurrent checkouts cannot oversell a date.
   */
  async reserveBooking(args: ReserveBookingArgs): Promise<Booking> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${args.scheduleId}))`;

      const rows = await tx.booking.aggregate({
        where: {
          scheduleId: args.scheduleId,
          status: { in: ['pending_payment', 'confirmed'] },
        },
        _sum: { participants: true },
      });
      const taken = args.baselineBooked + (rows._sum.participants ?? 0);
      const remaining = args.capacity - taken;
      if (args.participants > remaining) {
        throw ApiError.conflict(
          remaining <= 0
          ? 'This date is fully booked.'
          : `Only ${remaining} place${remaining === 1 ? ' remains' : 's remain'} on this date.`,
          { remaining, capacity: args.capacity },
        );
      }

      const created = await tx.booking.create({
        data: {
          reference: bookingReference(),
          experienceId: args.experienceId,
          scheduleId: args.scheduleId,
          participants: args.participants,
          unitPriceMinor: args.unitPriceMinor,
          totalMinor: args.unitPriceMinor * args.participants,
          currency: args.currency,
          status: 'pending_payment',
          customerName: args.customerName,
          customerEmail: args.customerEmail,
          customerPhone: args.customerPhone,
          notes: args.notes,
        },
      });
      return mapBooking(created);
    });
  }

  async getBooking(id: string): Promise<Booking | null> {
    const row = await this.prisma.booking.findUnique({ where: { id } });
    return row ? mapBooking(row) : null;
  }

  async getBookingByReference(reference: string): Promise<Booking | null> {
    const row = await this.prisma.booking.findUnique({ where: { reference } });
    return row ? mapBooking(row) : null;
  }

  async listBookings(status?: BookingStatus): Promise<Booking[]> {
    const rows = await this.prisma.booking.findMany({
      where: status ? { status: status as PrismaBookingStatus } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapBooking);
  }

  async updateBookingStatus(id: string, status: BookingStatus): Promise<Booking> {
    const row = await this.prisma.booking.update({
      where: { id },
      data: { status: status as PrismaBookingStatus },
    });
    return mapBooking(row);
  }

  async seatsBooked(scheduleId: string): Promise<number> {
    const rows = await this.prisma.booking.aggregate({
      where: { scheduleId, status: { in: ['pending_payment', 'confirmed'] } },
      _sum: { participants: true },
    });
    return rows._sum.participants ?? 0;
  }

  // --- Payments --------------------------------------------------------------

  async createPaymentAttempt(input: CreatePaymentAttemptInput): Promise<PaymentAttempt> {
    const row = await this.prisma.paymentAttempt.create({
      data: {
        bookingId: input.bookingId,
        reference: input.reference,
        providerReference: input.providerReference ?? null,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: input.status as PrismaPaymentStatus,
        providerStatus: input.providerStatus ?? null,
        checkoutUrl: input.checkoutUrl,
        payload: (input.payload ?? null) as never,
      },
    });
    return mapPayment(row);
  }

  async getPaymentAttemptByReference(reference: string): Promise<PaymentAttempt | null> {
    const row = await this.prisma.paymentAttempt.findUnique({ where: { reference } });
    return row ? mapPayment(row) : null;
  }

  async listPaymentAttempts(bookingId?: string): Promise<PaymentAttempt[]> {
    const rows = await this.prisma.paymentAttempt.findMany({
      where: bookingId ? { bookingId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapPayment);
  }

  async updatePaymentAttempt(
    id: string,
    patch: Partial<
      Pick<PaymentAttempt, 'status' | 'providerStatus' | 'providerReference' | 'checkoutUrl' | 'payload'>
    >,
  ): Promise<PaymentAttempt> {
    const row = await this.prisma.paymentAttempt.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status as PrismaPaymentStatus } : {}),
        ...(patch.providerStatus !== undefined ? { providerStatus: patch.providerStatus } : {}),
        ...(patch.providerReference !== undefined ? { providerReference: patch.providerReference } : {}),
        ...(patch.checkoutUrl !== undefined ? { checkoutUrl: patch.checkoutUrl } : {}),
        ...(patch.payload !== undefined ? { payload: patch.payload as never } : {}),
      },
    });
    return mapPayment(row);
  }

  // --- Stories ---------------------------------------------------------------

  async createStory(input: CreateStoryInput): Promise<Story> {
    const row = await this.prisma.story.create({
      data: {
        reference: storyReference(),
        placeId: input.placeId,
        suggestedPlace: input.suggestedPlaceName,
        body: input.body,
        sourceContext: input.sourceContext,
        period: input.period,
        attribution: input.attribution,
        contributorName: input.contributorName,
        contributorEmail: input.contributorEmail,
        consentPublication: input.consentPublication,
        consentTerms: input.consentTerms,
        sensitivity: input.sensitivity,
        mediaUrls: input.mediaUrls,
        status: 'pending',
      },
    });
    return mapStory(row, null);
  }

  async listStories(status?: StoryStatus): Promise<Story[]> {
    const rows = await this.prisma.story.findMany({
      where: status ? { status: status as PrismaStoryStatus } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => mapStory(row, null));
  }

  async listStoriesForPlace(placeId: string, status: StoryStatus = 'approved'): Promise<Story[]> {
    const rows = await this.prisma.story.findMany({
      where: { placeId, status: status as PrismaStoryStatus },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => mapStory(row, null));
  }

  async getStory(id: string): Promise<Story | null> {
    const row = await this.prisma.story.findFirst({
      where: { OR: [{ id }, { reference: id }] },
      include: { reviewedBy: { select: { name: true } } },
    });
    return row ? mapStory(row, row.reviewedBy?.name ?? null) : null;
  }

  async moderateStory(
    id: string,
    patch: { status: StoryStatus; moderationNote: string | null; reviewedBy: string },
  ): Promise<Story> {
    const row = await this.prisma.story.update({
      where: { id },
      data: {
        status: patch.status as PrismaStoryStatus,
        moderationNote: patch.moderationNote,
        reviewedBy: { connect: { email: patch.reviewedBy } },
        reviewedAt: new Date(),
      },
    });
    return mapStory(row, patch.reviewedBy);
  }

  // --- Users -----------------------------------------------------------------

  async createUser(input: {
    email: string;
    name: string;
    passwordHash: string;
    role: UserRecord['role'];
  }): Promise<UserRecord> {
    const row = await this.prisma.user.create({
      data: {
        email: input.email.trim().toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role as PrismaUserRole,
      },
    });
    return mapUser(row);
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    return row ? mapUser(row) : null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? mapUser(row) : null;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    } catch (error) {
      if (isMissingRecord(error)) throw ApiError.notFound('Account not found.');
      throw error;
    }
  }

  async listUsers(query: UserListQuery): Promise<UserPage> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role as PrismaUserRole } : {}),
      ...(query.status ? { status: query.status as PrismaUserStatus } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const orderBy = { [query.sort ?? 'createdAt']: query.direction ?? 'desc' } as Prisma.UserOrderByWithRelationInput;

    // Counted and paged in the database: the browser never receives the whole table.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy, skip: query.offset, take: query.limit }),
      this.prisma.user.count({ where }),
    ]);
    return { users: rows.map(mapUser), total };
  }

  async updateUserStatus(id: string, status: UserStatus): Promise<UserRecord | null> {
    try {
      const row = await this.prisma.user.update({
        where: { id },
        data: { status: status as PrismaUserStatus, suspendedAt: status === 'suspended' ? new Date() : null },
      });
      return mapUser(row);
    } catch (error) {
      if (isMissingRecord(error)) return null;
      throw error;
    }
  }

  // --- Password resets -------------------------------------------------------

  async createPasswordReset(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<PasswordResetRecord> {
    const row = await this.prisma.passwordResetToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: new Date(input.expiresAt),
      },
    });
    return mapPasswordReset(row);
  }

  async getPasswordReset(tokenHash: string): Promise<PasswordResetRecord | null> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    return row ? mapPasswordReset(row) : null;
  }

  async consumePasswordReset(id: string, userId: string): Promise<void> {
    const usedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id }, data: { usedAt } }),
      // Any other outstanding link for this account dies with it.
      this.prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt },
      }),
    ]);
  }

  // --- Audit -----------------------------------------------------------------

  async appendAudit(record: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<AuditRecord> {
    const row = await this.prisma.auditLog.create({
      data: {
        actor: record.actor,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        details: (record.details ?? null) as never,
      },
    });
    return {
      id: row.id,
      actor: row.actor,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listAudit(limit: number): Promise<AuditRecord[]> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // --- Analytics events ------------------------------------------------------

  async appendAnalyticsEvents(events: AnalyticsEventRecord[]): Promise<number> {
    if (events.length === 0) return 0;
    const result = await this.prisma.analyticsEvent.createMany({
      data: events.map((event) => ({
        id: event.id,
        name: event.name,
        receivedAt: new Date(event.receivedAt),
        occurredAt: new Date(event.occurredAt),
        visitorId: event.visitorId,
        sessionId: event.sessionId,
        userId: event.userId,
        path: event.path,
        resourceId: event.resourceId,
        utmSource: event.utmSource,
        utmMedium: event.utmMedium,
        utmCampaign: event.utmCampaign,
        device: event.device,
        props: event.props as never,
        internal: event.internal,
      })),
      // Unique ids make a retried batch a no-op instead of double counting.
      skipDuplicates: true,
    });
    return result.count;
  }

  async listAnalyticsEvents(range: { from: string; to: string }): Promise<AnalyticsEventRecord[]> {
    const rows = await this.prisma.analyticsEvent.findMany({
      where: { occurredAt: { gte: new Date(range.from), lte: new Date(range.to) } },
      orderBy: { occurredAt: 'asc' },
      take: ANALYTICS_SCAN_LIMIT,
    });
    if (rows.length === ANALYTICS_SCAN_LIMIT) {
      log.warn(
        { from: range.from, to: range.to, limit: ANALYTICS_SCAN_LIMIT },
        'Analytics read hit the scan limit — figures for this range are partial. Narrow the date range or add daily rollups.',
      );
    }
    return rows.map(mapAnalyticsEvent);
  }

  async countAnalyticsEvents(): Promise<number> {
    return this.prisma.analyticsEvent.count();
  }

  async purgeAnalyticsBefore(cutoffIso: string): Promise<number> {
    const cutoff = new Date(cutoffIso);
    const [events, metrics] = await this.prisma.$transaction([
      this.prisma.analyticsEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
      this.prisma.requestMetric.deleteMany({ where: { bucket: { lt: cutoff } } }),
    ]);
    return events.count + metrics.count;
  }

  async deleteAnalyticsEventsForVisitor(visitorId: string): Promise<number> {
    const result = await this.prisma.analyticsEvent.deleteMany({ where: { visitorId } });
    return result.count;
  }

  async analyticsCoverage(): Promise<{
    firstEventAt: string | null;
    lastEventAt: string | null;
    total: number;
  }> {
    const [first, last, total] = await Promise.all([
      this.prisma.analyticsEvent.findFirst({ orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
      this.prisma.analyticsEvent.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
      this.prisma.analyticsEvent.count(),
    ]);
    return {
      firstEventAt: first ? first.occurredAt.toISOString() : null,
      lastEventAt: last ? last.occurredAt.toISOString() : null,
      total,
    };
  }

  // --- AI request log --------------------------------------------------------

  async appendAiRequest(record: AiRequestRecord): Promise<void> {
    await this.prisma.aiRequest.create({
      data: {
        id: record.id,
        feature: record.feature,
        model: record.model,
        provider: record.provider,
        ok: record.ok,
        status: record.status,
        latencyMs: record.latencyMs,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        providerCostMinor: record.providerCostMinor,
        estimatedCostMicros: record.estimatedCostMicros,
        errorKind: record.errorKind,
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async listAiRequests(range: { from: string; to: string }): Promise<AiRequestRecord[]> {
    const rows = await this.prisma.aiRequest.findMany({
      where: { createdAt: { gte: new Date(range.from), lte: new Date(range.to) } },
      orderBy: { createdAt: 'asc' },
      take: ANALYTICS_SCAN_LIMIT,
    });
    return rows.map(mapAiRequest);
  }

  // --- Platform request metrics ---------------------------------------------

  async recordRequestMetrics(rows: RequestMetricRecord[]): Promise<void> {
    for (const row of rows) {
      const existing = await this.prisma.requestMetric.findUnique({
        where: { bucket_route_method: { bucket: new Date(row.bucket), route: row.route, method: row.method } },
      });
      if (!existing) {
        await this.prisma.requestMetric.create({
          data: {
            bucket: new Date(row.bucket),
            route: row.route,
            method: row.method,
            count: row.count,
            serverErrors: row.serverErrors,
            clientErrors: row.clientErrors,
            latencySumMs: row.latencySumMs,
            latencyMaxMs: row.latencyMaxMs,
            histogram: row.histogram,
          },
        });
        continue;
      }
      await this.prisma.requestMetric.update({
        where: { id: existing.id },
        data: {
          count: existing.count + row.count,
          serverErrors: existing.serverErrors + row.serverErrors,
          clientErrors: existing.clientErrors + row.clientErrors,
          latencySumMs: existing.latencySumMs + row.latencySumMs,
          latencyMaxMs: Math.max(existing.latencyMaxMs, row.latencyMaxMs),
          histogram: existing.histogram.map((value, index) => value + (row.histogram[index] ?? 0)),
        },
      });
    }
  }

  async listRequestMetrics(range: { from: string; to: string }): Promise<RequestMetricRecord[]> {
    const rows = await this.prisma.requestMetric.findMany({
      where: { bucket: { gte: new Date(range.from), lte: new Date(range.to) } },
      orderBy: { bucket: 'asc' },
    });
    return rows.map((row) => ({
      bucket: row.bucket.toISOString(),
      route: row.route,
      method: row.method,
      count: row.count,
      serverErrors: row.serverErrors,
      clientErrors: row.clientErrors,
      latencySumMs: row.latencySumMs,
      latencyMaxMs: row.latencyMaxMs,
      histogram: row.histogram,
    }));
  }
}

// --- Mappers -----------------------------------------------------------------

type BookingRow = Awaited<ReturnType<PrismaClient['booking']['create']>>;
type PaymentRow = Awaited<ReturnType<PrismaClient['paymentAttempt']['create']>>;
type UserRow = Awaited<ReturnType<PrismaClient['user']['create']>>;
type StoryRow = Awaited<ReturnType<PrismaClient['story']['create']>>;
type PasswordResetRow = Awaited<ReturnType<PrismaClient['passwordResetToken']['create']>>;

/** Prisma's "record to update does not exist" error code. */
function isMissingRecord(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2025'
  );
}

function mapPasswordReset(row: PasswordResetRow): PasswordResetRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt ? row.usedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    reference: row.reference,
    experienceId: row.experienceId,
    scheduleId: row.scheduleId,
    participants: row.participants,
    unitPriceMinor: row.unitPriceMinor,
    totalMinor: row.totalMinor,
    currency: row.currency,
    status: row.status as BookingStatus,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPayment(row: PaymentRow): PaymentAttempt {
  return {
    id: row.id,
    bookingId: row.bookingId,
    reference: row.reference,
    providerReference: row.providerReference,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status as PaymentStatus,
    providerStatus: row.providerStatus,
    checkoutUrl: row.checkoutUrl,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    role: row.role as UserRecord['role'],
    status: (row.status ?? 'active') as UserRecord['status'],
    suspendedAt: row.suspendedAt ? row.suspendedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

type AnalyticsEventRow = Awaited<ReturnType<PrismaClient['analyticsEvent']['create']>>;
type AiRequestRow = Awaited<ReturnType<PrismaClient['aiRequest']['create']>>;

function mapAnalyticsEvent(row: AnalyticsEventRow): AnalyticsEventRecord {
  return {
    id: row.id,
    name: row.name as EventName,
    receivedAt: row.receivedAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    visitorId: row.visitorId,
    sessionId: row.sessionId,
    userId: row.userId,
    path: row.path,
    resourceId: row.resourceId,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    device: row.device as DeviceCategory,
    props: (row.props ?? {}) as EventProps,
    internal: row.internal,
    source: 'server',
  };
}

function mapAiRequest(row: AiRequestRow): AiRequestRecord {
  return {
    id: row.id,
    feature: row.feature as AiRequestRecord['feature'],
    model: row.model,
    provider: row.provider,
    ok: row.ok,
    status: row.status,
    latencyMs: row.latencyMs,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    providerCostMinor: row.providerCostMinor,
    estimatedCostMicros: row.estimatedCostMicros,
    errorKind: row.errorKind as AiRequestRecord['errorKind'],
    createdAt: row.createdAt.toISOString(),
  };
}

function mapStory(
  row: StoryRow & { reviewedById?: string | null },
  reviewerName: string | null,
): Story {
  return {
    id: row.id,
    reference: row.reference,
    placeId: row.placeId,
    suggestedPlaceName: row.suggestedPlace,
    body: row.body,
    sourceContext: row.sourceContext,
    period: row.period,
    attribution: row.attribution,
    contributorName: row.contributorName,
    contributorEmail: row.contributorEmail,
    consentPublication: row.consentPublication,
    consentTerms: row.consentTerms,
    sensitivity: row.sensitivity,
    mediaUrls: row.mediaUrls,
    status: row.status as StoryStatus,
    moderationNote: row.moderationNote,
    reviewedBy: reviewerName,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
