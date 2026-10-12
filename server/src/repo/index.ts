import { PrismaClient } from '@prisma/client';
import { databaseConfigured } from '../env';
import { logger as log } from '../lib/logger';
import { ApiError } from '../lib/errors';
import { MemoryRepository } from './memory';
import { PrismaStore } from './prismaStore';
import type { CreateBookingInput, Repository } from './types';

/**
 * Composes reference data (places + experiences, read from version-controlled
 * JSON) with a transactional store (memory in dev/test, PostgreSQL when
 * DATABASE_URL is configured).
 */
class HybridRepository implements Repository {
  constructor(
    private readonly reference: MemoryRepository,
    private readonly store: PrismaStore,
  ) {}

  listPlaces: Repository['listPlaces'] = (f) => this.reference.listPlaces(f);
  getPlace: Repository['getPlace'] = (id) => this.reference.getPlace(id);
  listExperiences: Repository['listExperiences'] = () => this.reference.listExperiences();
  getExperience: Repository['getExperience'] = (id) => this.reference.getExperience(id);
  getSchedule: Repository['getSchedule'] = (e, s) => this.reference.getSchedule(e, s);

  async createBooking(input: CreateBookingInput) {
    const experience = await this.reference.getExperience(input.experienceId);
    if (!experience) throw ApiError.notFound('Experience not found.');
    const schedule = experience.schedules.find((s) => s.id === input.scheduleId);
    if (!schedule) throw ApiError.notFound('That date is not available for this experience.');
    return this.store.reserveBooking({
      experienceId: experience.id,
      scheduleId: schedule.id,
      participants: input.participants,
      unitPriceMinor: experience.priceMinor,
      currency: experience.currency,
      baselineBooked: schedule.booked,
      capacity: schedule.capacity,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      notes: input.notes,
    });
  }

  getBooking: Repository['getBooking'] = (id) => this.store.getBooking(id);
  getBookingByReference: Repository['getBookingByReference'] = (r) =>
    this.store.getBookingByReference(r);
  listBookings: Repository['listBookings'] = (s) => this.store.listBookings(s);
  updateBookingStatus: Repository['updateBookingStatus'] = (id, s) =>
    this.store.updateBookingStatus(id, s);
  seatsBooked: Repository['seatsBooked'] = (s) => this.store.seatsBooked(s);

  createPaymentAttempt: Repository['createPaymentAttempt'] = (i) =>
    this.store.createPaymentAttempt(i);
  getPaymentAttemptByReference: Repository['getPaymentAttemptByReference'] = (r) =>
    this.store.getPaymentAttemptByReference(r);
  listPaymentAttempts: Repository['listPaymentAttempts'] = (b) => this.store.listPaymentAttempts(b);
  updatePaymentAttempt: Repository['updatePaymentAttempt'] = (id, p) =>
    this.store.updatePaymentAttempt(id, p);

  createStory: Repository['createStory'] = (i) => this.store.createStory(i);
  listStories: Repository['listStories'] = (s) => this.store.listStories(s);
  listStoriesForPlace: Repository['listStoriesForPlace'] = (p, s) =>
    this.store.listStoriesForPlace(p, s);
  getStory: Repository['getStory'] = (id) => this.store.getStory(id);

  async moderateStory(
    id: string,
    patch: Parameters<Repository['moderateStory']>[1],
  ): Promise<Awaited<ReturnType<Repository['moderateStory']>>> {
    return this.store.moderateStory(id, patch);
  }

  async createUser(input: Parameters<Repository['createUser']>[0]) {
    try {
      return await this.store.createUser(input);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('An account with that email already exists.');
      }
      throw error;
    }
  }
  getUserByEmail: Repository['getUserByEmail'] = (e) => this.store.getUserByEmail(e);
  getUserById: Repository['getUserById'] = (id) => this.store.getUserById(id);
  updateUserPassword: Repository['updateUserPassword'] = (id, hash) =>
    this.store.updateUserPassword(id, hash);
  createPasswordReset: Repository['createPasswordReset'] = (i) => this.store.createPasswordReset(i);
  getPasswordReset: Repository['getPasswordReset'] = (h) => this.store.getPasswordReset(h);
  consumePasswordReset: Repository['consumePasswordReset'] = (id, userId) =>
    this.store.consumePasswordReset(id, userId);
  createGuideProfile: Repository['createGuideProfile'] = (input) => this.reference.createGuideProfile(input);
  listGuideProfiles: Repository['listGuideProfiles'] = (status) => this.reference.listGuideProfiles(status);
  getGuideProfile: Repository['getGuideProfile'] = (id) => this.reference.getGuideProfile(id);
  moderateGuideProfile: Repository['moderateGuideProfile'] = (id, patch) =>
    this.reference.moderateGuideProfile(id, patch);
  appendAudit: Repository['appendAudit'] = (r) => this.store.appendAudit(r);
  listAudit: Repository['listAudit'] = (l) => this.store.listAudit(l);
  listUsers: Repository['listUsers'] = (q) => this.store.listUsers(q);
  updateUserStatus: Repository['updateUserStatus'] = (id, s) => this.store.updateUserStatus(id, s);

  // Analytics follows the transactional store: it is user activity, not
  // version-controlled reference data.
  appendAnalyticsEvents: Repository['appendAnalyticsEvents'] = (e) =>
    this.store.appendAnalyticsEvents(e);
  listAnalyticsEvents: Repository['listAnalyticsEvents'] = (r) => this.store.listAnalyticsEvents(r);
  countAnalyticsEvents: Repository['countAnalyticsEvents'] = () => this.store.countAnalyticsEvents();
  purgeAnalyticsBefore: Repository['purgeAnalyticsBefore'] = (c) => this.store.purgeAnalyticsBefore(c);
  deleteAnalyticsEventsForVisitor: Repository['deleteAnalyticsEventsForVisitor'] = (v) =>
    this.store.deleteAnalyticsEventsForVisitor(v);
  analyticsCoverage: Repository['analyticsCoverage'] = () => this.store.analyticsCoverage();
  appendAiRequest: Repository['appendAiRequest'] = (r) => this.store.appendAiRequest(r);
  listAiRequests: Repository['listAiRequests'] = (r) => this.store.listAiRequests(r);
  recordRequestMetrics: Repository['recordRequestMetrics'] = (r) => this.store.recordRequestMetrics(r);
  listRequestMetrics: Repository['listRequestMetrics'] = (r) => this.store.listRequestMetrics(r);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

let cached: Repository | null = null;

export function createRepository(): Repository {
  if (cached) return cached;

  const reference = new MemoryRepository();

  if (!databaseConfigured()) {
    log.info({ store: 'memory' }, 'DATABASE_URL not set — using the in-memory transactional store.');
    cached = reference;
    return cached;
  }

  try {
    const prisma = new PrismaClient({ log: ['warn', 'error'] });
    cached = new HybridRepository(reference, new PrismaStore(prisma));
    log.info({ store: 'postgres' }, 'Using PostgreSQL for transactional data.');
  } catch (error) {
    log.error({ err: error }, 'Failed to initialise Prisma — falling back to the memory store.');
    cached = reference;
  }
  return cached;
}

/** Test helper: drop the cached repository so a fresh one is built. */
export function resetRepository(): void {
  cached = null;
}

export { MemoryRepository } from './memory';
export type { Repository } from './types';
