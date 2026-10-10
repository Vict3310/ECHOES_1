import {
  PrismaClient,
  type BookingStatus as PrismaBookingStatus,
  type PaymentStatus as PrismaPaymentStatus,
  type StoryStatus as PrismaStoryStatus,
  type UserRole as PrismaUserRole,
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
import type { CreatePaymentAttemptInput, CreateStoryInput, UserRecord } from './types';

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
}

// --- Mappers -----------------------------------------------------------------

type BookingRow = Awaited<ReturnType<PrismaClient['booking']['create']>>;
type PaymentRow = Awaited<ReturnType<PrismaClient['paymentAttempt']['create']>>;
type UserRow = Awaited<ReturnType<PrismaClient['user']['create']>>;
type StoryRow = Awaited<ReturnType<PrismaClient['story']['create']>>;

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
