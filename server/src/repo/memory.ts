import { ApiError } from '../lib/errors';
import { bookingReference, storyReference, uuid } from '../lib/ids';
import { loadExperiences, loadPlaces } from '../data/dataset';
import { analysePlace } from '../services/knowledge';
import type {
  AuditRecord,
  Booking,
  BookingStatus,
  Experience,
  ExperienceSchedule,
  GuideProfile,
  GuideStatus,
  PaymentAttempt,
  Place,
  PlaceFilters,
  Story,
  StoryStatus,
} from '../domain/types';
import type {
  CreateBookingInput,
  CreateGuideProfileInput,
  CreatePaymentAttemptInput,
  CreateStoryInput,
  PasswordResetRecord,
  Repository,
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
} from '../domain/analytics';

/** Serialises async critical sections so seat reservations cannot race. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class MemoryRepository implements Repository {
  private places: Place[];
  private experiences: Experience[];
  private stories: Story[] = [];
  private guideProfiles: GuideProfile[] = [];
  private bookings: Booking[] = [];
  private payments: PaymentAttempt[] = [];
  private users: UserRecord[] = [];
  private passwordResets: PasswordResetRecord[] = [];
  private audit: AuditRecord[] = [];
  private analyticsEvents: AnalyticsEventRecord[] = [];
  /** Dedupe key for analytics events, so a retried batch is a no-op. */
  private eventIds = new Set<string>();
  private aiRequests: AiRequestRecord[] = [];
  private requestMetrics = new Map<string, RequestMetricRecord>();
  private bookingMutex = new Mutex();

  constructor(data?: { places?: Place[]; experiences?: Experience[] }) {
    this.places = data?.places ?? loadPlaces();
    this.experiences = data?.experiences ?? loadExperiences();
    this.guideProfiles = [
      {
        id: 'ada-okafor',
        email: 'ada@example.com',
        name: 'Ada Okafor',
        role: 'Heritage storyteller',
        city: 'Lagos Island',
        specialties: ['Colonial history', 'Food routes', 'Walks'],
        bio: 'Specialises in short, deeply local heritage walks across Marina, Onikan, and the old city core.',
        availability: 'Tue–Sun',
        priceFrom: '₦18,000',
        avatarUrl: null,
        rating: 4.9,
        status: 'approved',
        moderationNote: 'Seeded as an approved city guide.',
        reviewedBy: 'system',
        reviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'kunle-adebayo',
        email: 'kunle@example.com',
        name: 'Kunle Adebayo',
        role: 'Culture guide',
        city: 'Yaba',
        specialties: ['Art', 'Film', 'Night life'],
        bio: 'Connects travellers to cultural institutions, neighbourhood stories and contemporary Lagos energy.',
        availability: 'Wed–Mon',
        priceFrom: '₦16,000',
        avatarUrl: null,
        rating: 4.8,
        status: 'approved',
        moderationNote: 'Seeded as an approved city guide.',
        reviewedBy: 'system',
        reviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'bisi-eze',
        email: 'bisi@example.com',
        name: 'Bisi Eze',
        role: 'Food and community host',
        city: 'Lekki',
        specialties: ['Street food', 'Cultural dining', 'Market tours'],
        bio: 'Turns food into a social and historical experience, from market stalls to hidden local favourites.',
        availability: 'Daily',
        priceFrom: '₦20,000',
        avatarUrl: null,
        rating: 5.0,
        status: 'approved',
        moderationNote: 'Seeded as an approved city guide.',
        reviewedBy: 'system',
        reviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'kehinde-bello',
        email: 'kehinde@example.com',
        name: 'Kehinde Bello',
        role: 'History and faith routes',
        city: 'Abeokuta',
        specialties: ['Historical architecture', 'Faith heritage', 'Slow travel'],
        bio: 'Builds thoughtful pathways through old city spaces, family histories and architecture stories.',
        availability: 'Thu–Sun',
        priceFrom: '₦15,000',
        avatarUrl: null,
        rating: 4.7,
        status: 'approved',
        moderationNote: 'Seeded as an approved city guide.',
        reviewedBy: 'system',
        reviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  async listPlaces(filters: PlaceFilters): Promise<Place[]> {
    let items = [...this.places];

    if (filters.category) items = items.filter((p) => p.category === filters.category);
    if (filters.neighbourhood) {
      const wanted = filters.neighbourhood.toLowerCase();
      items = items.filter((p) => p.neighbourhood.toLowerCase() === wanted);
    }
    if (filters.query) {
      const q = filters.query.trim().toLowerCase();
      items = items.filter((p) =>
        [p.name, p.summary, p.history, p.neighbourhood, p.category, ...p.tags]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    if (filters.needsResearch) {
      items = items.filter((p) => analysePlace(p).needsResearch);
    }

    items.sort((a, b) => a.name.localeCompare(b.name));
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  async getPlace(id: string): Promise<Place | null> {
    return this.places.find((p) => p.id === id) ?? null;
  }

  async listExperiences(): Promise<Experience[]> {
    return [...this.experiences];
  }

  async getExperience(id: string): Promise<Experience | null> {
    return (
      this.experiences.find((e) => e.id === id || e.slug === id) ?? null
    );
  }

  async getSchedule(experienceId: string, scheduleId: string): Promise<ExperienceSchedule | null> {
    const experience = await this.getExperience(experienceId);
    if (!experience) return null;
    return experience.schedules.find((s) => s.id === scheduleId) ?? null;
  }

  async seatsBooked(scheduleId: string): Promise<number> {
    return this.bookings
      .filter(
        (b) =>
          b.scheduleId === scheduleId &&
          (b.status === 'confirmed' || b.status === 'pending_payment'),
      )
      .reduce((sum, b) => sum + b.participants, 0);
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    return this.bookingMutex.run(async () => {
      const experience = await this.getExperience(input.experienceId);
      if (!experience) throw ApiError.notFound('Experience not found.');
      const schedule = experience.schedules.find((s) => s.id === input.scheduleId);
      if (!schedule) throw ApiError.notFound('That date is not available for this experience.');

      const alreadyBooked = schedule.booked + (await this.seatsBooked(schedule.id));
      const remaining = schedule.capacity - alreadyBooked;
      if (input.participants > remaining) {
        throw ApiError.conflict(
          remaining <= 0
            ? 'This date is fully booked.'
            : `Only ${remaining} place${remaining === 1 ? ' remains' : 's remain'} on this date.`,
          { remaining, capacity: schedule.capacity },
        );
      }

      const now = new Date().toISOString();
      const booking: Booking = {
        id: uuid(),
        reference: bookingReference(),
        experienceId: experience.id,
        scheduleId: schedule.id,
        participants: input.participants,
        unitPriceMinor: experience.priceMinor,
        totalMinor: experience.priceMinor * input.participants,
        currency: experience.currency,
        status: 'pending_payment',
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };
      this.bookings.push(booking);
      return booking;
    });
  }

  async getBooking(id: string): Promise<Booking | null> {
    return this.bookings.find((b) => b.id === id) ?? null;
  }

  async getBookingByReference(reference: string): Promise<Booking | null> {
    return this.bookings.find((b) => b.reference === reference) ?? null;
  }

  async listBookings(status?: BookingStatus): Promise<Booking[]> {
    const items = status ? this.bookings.filter((b) => b.status === status) : [...this.bookings];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateBookingStatus(id: string, status: BookingStatus): Promise<Booking> {
    const booking = await this.getBooking(id);
    if (!booking) throw ApiError.notFound('Booking not found.');
    booking.status = status;
    booking.updatedAt = new Date().toISOString();
    return booking;
  }

  async createPaymentAttempt(input: CreatePaymentAttemptInput): Promise<PaymentAttempt> {
    const now = new Date().toISOString();
    const attempt: PaymentAttempt = {
      id: uuid(),
      bookingId: input.bookingId,
      reference: input.reference,
      providerReference: input.providerReference ?? null,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: input.status,
      providerStatus: input.providerStatus ?? null,
      checkoutUrl: input.checkoutUrl,
      payload: input.payload ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.payments.push(attempt);
    return attempt;
  }

  async getPaymentAttemptByReference(reference: string): Promise<PaymentAttempt | null> {
    return this.payments.find((p) => p.reference === reference) ?? null;
  }

  async listPaymentAttempts(bookingId?: string): Promise<PaymentAttempt[]> {
    const items = bookingId
      ? this.payments.filter((p) => p.bookingId === bookingId)
      : [...this.payments];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updatePaymentAttempt(
    id: string,
    patch: Partial<
      Pick<PaymentAttempt, 'status' | 'providerStatus' | 'providerReference' | 'checkoutUrl' | 'payload'>
    >,
  ): Promise<PaymentAttempt> {
    const attempt = this.payments.find((p) => p.id === id);
    if (!attempt) throw ApiError.notFound('Payment attempt not found.');
    Object.assign(attempt, patch, { updatedAt: new Date().toISOString() });
    return attempt;
  }

  async createStory(input: CreateStoryInput): Promise<Story> {
    const now = new Date().toISOString();
    const story: Story = {
      id: uuid(),
      reference: storyReference(),
      ...input,
      status: 'pending',
      moderationNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
    };
    this.stories.push(story);
    return story;
  }

  async listStories(status?: StoryStatus): Promise<Story[]> {
    const items = status ? this.stories.filter((s) => s.status === status) : [...this.stories];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listStoriesForPlace(placeId: string, status: StoryStatus = 'approved'): Promise<Story[]> {
    return this.stories
      .filter((s) => s.placeId === placeId && s.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getStory(id: string): Promise<Story | null> {
    return this.stories.find((s) => s.id === id || s.reference === id) ?? null;
  }

  async moderateStory(
    id: string,
    patch: { status: StoryStatus; moderationNote: string | null; reviewedBy: string },
  ): Promise<Story> {
    const story = await this.getStory(id);
    if (!story) throw ApiError.notFound('Story not found.');
    story.status = patch.status;
    story.moderationNote = patch.moderationNote;
    story.reviewedBy = patch.reviewedBy;
    story.reviewedAt = new Date().toISOString();
    return story;
  }

  async createGuideProfile(input: CreateGuideProfileInput): Promise<GuideProfile> {
    const now = new Date().toISOString();
    const slug = input.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'guide';

    const profile: GuideProfile = {
      id: `${slug}-${Date.now()}`,
      email: input.email ?? null,
      name: input.name.trim(),
      role: input.role.trim(),
      city: input.city.trim(),
      specialties: (input.specialties ?? []).slice(0, 6).map((item) => item.trim()).filter(Boolean),
      bio: input.bio.trim(),
      availability: input.availability?.trim() ?? 'Flexible',
      priceFrom: input.priceFrom?.trim() ?? '₦15,000',
      avatarUrl: input.avatarUrl?.trim() || null,
      rating: 4.8,
      status: input.status ?? 'pending',
      moderationNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.guideProfiles.unshift(profile);
    return profile;
  }

  async listGuideProfiles(status?: GuideStatus): Promise<GuideProfile[]> {
    const items = status ? this.guideProfiles.filter((profile) => profile.status === status) : [...this.guideProfiles];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getGuideProfile(id: string): Promise<GuideProfile | null> {
    return this.guideProfiles.find((profile) => profile.id === id) ?? null;
  }

  async moderateGuideProfile(
    id: string,
    patch: { status: GuideStatus; moderationNote: string | null; reviewedBy: string },
  ): Promise<GuideProfile> {
    const profile = await this.getGuideProfile(id);
    if (!profile) throw ApiError.notFound('Guide profile not found.');
    profile.status = patch.status;
    profile.moderationNote = patch.moderationNote;
    profile.reviewedBy = patch.reviewedBy;
    profile.reviewedAt = new Date().toISOString();
    profile.updatedAt = profile.reviewedAt;
    return profile;
  }

  async createUser(input: {
    email: string;
    name: string;
    passwordHash: string;
    role: UserRecord['role'];
  }): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    const existing = this.users.find((u) => u.email === email);
    if (existing) throw ApiError.conflict('An account with that email already exists.');
    const user: UserRecord = {
      id: uuid(),
      email,
      name: input.name,
      passwordHash: input.passwordHash,
      role: input.role,
      status: 'active',
      suspendedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    return user;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const wanted = email.trim().toLowerCase();
    return this.users.find((u) => u.email === wanted) ?? null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw ApiError.notFound('Account not found.');
    user.passwordHash = passwordHash;
  }

  async listUsers(query: UserListQuery): Promise<UserPage> {
    const needle = query.q?.trim().toLowerCase() ?? '';
    const filtered = this.users.filter((user) => {
      if (query.role && user.role !== query.role) return false;
      if (query.status && user.status !== query.status) return false;
      if (needle) {
        const haystack = `${user.name} ${user.email}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const sort = query.sort ?? 'createdAt';
    const direction = query.direction === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort(
      (a, b) => a[sort].localeCompare(b[sort]) * direction,
    );
    return {
      users: sorted.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
    };
  }

  async updateUserStatus(id: string, status: UserStatus): Promise<UserRecord | null> {
    const user = this.users.find((u) => u.id === id);
    if (!user) return null;
    user.status = status;
    user.suspendedAt = status === 'suspended' ? new Date().toISOString() : null;
    return user;
  }

  async createPasswordReset(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<PasswordResetRecord> {
    const record: PasswordResetRecord = {
      id: uuid(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.passwordResets.push(record);
    return record;
  }

  async getPasswordReset(tokenHash: string): Promise<PasswordResetRecord | null> {
    return this.passwordResets.find((reset) => reset.tokenHash === tokenHash) ?? null;
  }

  async consumePasswordReset(id: string, userId: string): Promise<void> {
    const usedAt = new Date().toISOString();
    for (const reset of this.passwordResets) {
      // Consuming one link invalidates every other outstanding link for that user.
      if (reset.id === id || (reset.userId === userId && reset.usedAt === null)) {
        reset.usedAt = usedAt;
      }
    }
  }

  async appendAudit(record: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<AuditRecord> {
    const entry: AuditRecord = { ...record, id: uuid(), createdAt: new Date().toISOString() };
    this.audit.push(entry);
    return entry;
  }

  async listAudit(limit: number): Promise<AuditRecord[]> {
    return [...this.audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  // --- Analytics -------------------------------------------------------------

  async appendAnalyticsEvents(events: AnalyticsEventRecord[]): Promise<number> {
    let written = 0;
    for (const event of events) {
      // A retried batch, or the same event sent twice, must not be counted twice.
      if (this.eventIds.has(event.id)) continue;
      this.eventIds.add(event.id);
      this.analyticsEvents.push(event);
      written += 1;
    }
    return written;
  }

  async listAnalyticsEvents(range: { from: string; to: string }): Promise<AnalyticsEventRecord[]> {
    return this.analyticsEvents
      .filter((event) => event.occurredAt >= range.from && event.occurredAt <= range.to)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .slice(0, ANALYTICS_SCAN_LIMIT);
  }

  async countAnalyticsEvents(): Promise<number> {
    return this.analyticsEvents.length;
  }

  async purgeAnalyticsBefore(cutoffIso: string): Promise<number> {
    const before = this.analyticsEvents.length;
    this.analyticsEvents = this.analyticsEvents.filter((event) => event.occurredAt >= cutoffIso);
    this.eventIds = new Set(this.analyticsEvents.map((event) => event.id));
    for (const [key, row] of this.requestMetrics) {
      if (row.bucket < cutoffIso) this.requestMetrics.delete(key);
    }
    return before - this.analyticsEvents.length;
  }

  async deleteAnalyticsEventsForVisitor(visitorId: string): Promise<number> {
    const before = this.analyticsEvents.length;
    this.analyticsEvents = this.analyticsEvents.filter((event) => event.visitorId !== visitorId);
    this.eventIds = new Set(this.analyticsEvents.map((event) => event.id));
    return before - this.analyticsEvents.length;
  }

  async analyticsCoverage(): Promise<{
    firstEventAt: string | null;
    lastEventAt: string | null;
    total: number;
  }> {
    if (this.analyticsEvents.length === 0) {
      return { firstEventAt: null, lastEventAt: null, total: 0 };
    }
    const times = this.analyticsEvents.map((event) => event.occurredAt).sort();
    return {
      firstEventAt: times[0] ?? null,
      lastEventAt: times[times.length - 1] ?? null,
      total: this.analyticsEvents.length,
    };
  }

  async appendAiRequest(record: AiRequestRecord): Promise<void> {
    this.aiRequests.push(record);
  }

  async listAiRequests(range: { from: string; to: string }): Promise<AiRequestRecord[]> {
    return this.aiRequests
      .filter((row) => row.createdAt >= range.from && row.createdAt <= range.to)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async recordRequestMetrics(rows: RequestMetricRecord[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.bucket}|${row.route}|${row.method}`;
      const existing = this.requestMetrics.get(key);
      if (!existing) {
        this.requestMetrics.set(key, { ...row, histogram: [...row.histogram] });
        continue;
      }
      existing.count += row.count;
      existing.serverErrors += row.serverErrors;
      existing.clientErrors += row.clientErrors;
      existing.latencySumMs += row.latencySumMs;
      existing.latencyMaxMs = Math.max(existing.latencyMaxMs, row.latencyMaxMs);
      existing.histogram = existing.histogram.map((value, index) => value + (row.histogram[index] ?? 0));
    }
  }

  async listRequestMetrics(range: { from: string; to: string }): Promise<RequestMetricRecord[]> {
    return [...this.requestMetrics.values()]
      .filter((row) => row.bucket >= range.from && row.bucket <= range.to)
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  }
}
