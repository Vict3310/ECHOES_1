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
  PaymentAttempt,
  Place,
  PlaceFilters,
  Story,
  StoryStatus,
} from '../domain/types';
import type {
  CreateBookingInput,
  CreatePaymentAttemptInput,
  CreateStoryInput,
  Repository,
  UserRecord,
} from './types';

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
  private bookings: Booking[] = [];
  private payments: PaymentAttempt[] = [];
  private users: UserRecord[] = [];
  private audit: AuditRecord[] = [];
  private bookingMutex = new Mutex();

  constructor(data?: { places?: Place[]; experiences?: Experience[] }) {
    this.places = data?.places ?? loadPlaces();
    this.experiences = data?.experiences ?? loadExperiences();
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

  async appendAudit(record: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<AuditRecord> {
    const entry: AuditRecord = { ...record, id: uuid(), createdAt: new Date().toISOString() };
    this.audit.push(entry);
    return entry;
  }

  async listAudit(limit: number): Promise<AuditRecord[]> {
    return [...this.audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
}
