import type {
  AuditRecord,
  AttributionPreference,
  Booking,
  BookingStatus,
  Experience,
  ExperienceSchedule,
  PaymentAttempt,
  PaymentStatus,
  Place,
  PlaceFilters,
  SensitivityLevel,
  GuideProfile,
  GuideStatus,
  Story,
  StoryStatus,
} from '../domain/types';
import type { AiRequestRecord, AnalyticsEventRecord } from '../domain/analytics';

export type UserRole = 'visitor' | 'contributor' | 'organizer' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  /**
   * Suspension is a moderation state, not a deletion: the row stays so the audit
   * trail remains readable, and a suspended account cannot sign in.
   */
  status: UserStatus;
  suspendedAt: string | null;
  createdAt: string;
}

/** Bounded, server-side query for the users table — never a full table scan. */
export interface UserListQuery {
  q?: string | null;
  role?: UserRole | null;
  status?: UserStatus | null;
  sort?: 'createdAt' | 'name' | 'email' | 'role';
  direction?: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface UserPage {
  users: UserRecord[];
  /** Total matching the filter, for pagination — counted in the database, not in the browser. */
  total: number;
}

/**
 * One minute of request activity for one route pattern.
 *
 * Individual requests are never stored. Latencies are kept as counts per fixed
 * bucket, so an exact-ish percentile can be recomputed for any date range
 * without a row per request and without keeping raw IPs or payloads.
 */
export interface RequestMetricRecord {
  /** ISO timestamp truncated to the minute. */
  bucket: string;
  route: string;
  method: string;
  count: number;
  serverErrors: number;
  clientErrors: number;
  latencySumMs: number;
  latencyMaxMs: number;
  /** One count per latency bucket, plus a final overflow bucket. */
  histogram: number[];
}

/**
 * A single-use password reset. Only the hash of the emailed token is stored, so a
 * database leak does not hand out working reset links, and `usedAt` makes a
 * second use of the same link impossible even if it was intercepted.
 */
export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface CreateStoryInput {
  placeId: string | null;
  suggestedPlaceName: string | null;
  body: string;
  sourceContext: string;
  period: string | null;
  attribution: AttributionPreference;
  contributorName: string | null;
  contributorEmail: string | null;
  consentPublication: boolean;
  consentTerms: boolean;
  sensitivity: SensitivityLevel;
  mediaUrls: string[];
}

export interface CreateBookingInput {
  experienceId: string;
  scheduleId: string;
  participants: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
}

export interface CreateGuideProfileInput {
  name: string;
  email?: string | null;
  role: string;
  city: string;
  specialties: string[];
  bio: string;
  availability?: string | null;
  priceFrom?: string | null;
  avatarUrl?: string | null;
  status?: GuideStatus;
}

export interface CreatePaymentAttemptInput {
  bookingId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  checkoutUrl: string | null;
  providerReference?: string | null;
  providerStatus?: string | null;
  payload?: unknown;
}

export interface Repository {
  // --- Cultural places -------------------------------------------------------
  listPlaces(filters: PlaceFilters): Promise<Place[]>;
  getPlace(id: string): Promise<Place | null>;

  // --- Experiences -----------------------------------------------------------
  listExperiences(): Promise<Experience[]>;
  getExperience(id: string): Promise<Experience | null>;
  getSchedule(experienceId: string, scheduleId: string): Promise<ExperienceSchedule | null>;

  // --- Bookings --------------------------------------------------------------
  /** Reserve seats atomically. Throws ApiError.conflict when capacity is exceeded. */
  createBooking(input: CreateBookingInput): Promise<Booking>;
  getBooking(id: string): Promise<Booking | null>;
  getBookingByReference(reference: string): Promise<Booking | null>;
  listBookings(status?: BookingStatus): Promise<Booking[]>;
  updateBookingStatus(id: string, status: BookingStatus): Promise<Booking>;
  seatsBooked(scheduleId: string): Promise<number>;

  // --- Payments --------------------------------------------------------------
  createPaymentAttempt(input: CreatePaymentAttemptInput): Promise<PaymentAttempt>;
  getPaymentAttemptByReference(reference: string): Promise<PaymentAttempt | null>;
  listPaymentAttempts(bookingId?: string): Promise<PaymentAttempt[]>;
  updatePaymentAttempt(
    id: string,
    patch: Partial<Pick<PaymentAttempt, 'status' | 'providerStatus' | 'providerReference' | 'checkoutUrl' | 'payload'>>,
  ): Promise<PaymentAttempt>;

  // --- Community stories -----------------------------------------------------
  createStory(input: CreateStoryInput): Promise<Story>;
  listStories(status?: StoryStatus): Promise<Story[]>;
  listStoriesForPlace(placeId: string, status?: StoryStatus): Promise<Story[]>;
  getStory(id: string): Promise<Story | null>;
  moderateStory(
    id: string,
    patch: { status: StoryStatus; moderationNote: string | null; reviewedBy: string },
  ): Promise<Story>;

  // --- Guide profiles --------------------------------------------------------
  createGuideProfile(input: CreateGuideProfileInput): Promise<GuideProfile>;
  listGuideProfiles(status?: GuideStatus): Promise<GuideProfile[]>;
  getGuideProfile(id: string): Promise<GuideProfile | null>;
  moderateGuideProfile(
    id: string,
    patch: { status: GuideStatus; moderationNote: string | null; reviewedBy: string },
  ): Promise<GuideProfile>;

  // --- Users / auth ----------------------------------------------------------
  createUser(input: { email: string; name: string; passwordHash: string; role: UserRole }): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  listUsers(query: UserListQuery): Promise<UserPage>;
  updateUserStatus(id: string, status: UserStatus): Promise<UserRecord | null>;

  createPasswordReset(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<PasswordResetRecord>;
  /** Looks up a reset by the hash of the token presented, never by the token itself. */
  getPasswordReset(tokenHash: string): Promise<PasswordResetRecord | null>;
  /** Marks a reset used and invalidates every other outstanding reset for that user. */
  consumePasswordReset(id: string, userId: string): Promise<void>;

  // --- Audit -----------------------------------------------------------------
  appendAudit(record: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<AuditRecord>;
  listAudit(limit: number): Promise<AuditRecord[]>;

  // --- Analytics events ------------------------------------------------------
  /**
   * Appends events, ignoring any whose id is already stored. Returns the number
   * of rows actually written, so a duplicated delivery cannot inflate a count.
   */
  appendAnalyticsEvents(events: AnalyticsEventRecord[]): Promise<number>;
  /** Date-bounded read; the caller always passes a range. */
  listAnalyticsEvents(range: { from: string; to: string }): Promise<AnalyticsEventRecord[]>;
  countAnalyticsEvents(): Promise<number>;
  /** Retention: removes raw events older than the cutoff. Returns rows removed. */
  purgeAnalyticsBefore(cutoffIso: string): Promise<number>;
  /**
   * Erases one visitor's raw events. This is the counterpart of consent: if a
   * visitor withdraws, what was collected about them goes with it.
   */
  deleteAnalyticsEventsForVisitor(visitorId: string): Promise<number>;
  /**
   * How far back collection actually reaches. The dashboard uses this to say
   * "no data" for periods that predate tracking, rather than drawing a zero.
   */
  analyticsCoverage(): Promise<{ firstEventAt: string | null; lastEventAt: string | null; total: number }>;

  // --- AI request log --------------------------------------------------------
  appendAiRequest(record: AiRequestRecord): Promise<void>;
  listAiRequests(range: { from: string; to: string }): Promise<AiRequestRecord[]>;

  // --- Platform request metrics ---------------------------------------------
  /** Adds to the existing minute bucket for a route rather than replacing it. */
  recordRequestMetrics(rows: RequestMetricRecord[]): Promise<void>;
  listRequestMetrics(range: { from: string; to: string }): Promise<RequestMetricRecord[]>;
}
