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
  Story,
  StoryStatus,
} from '../domain/types';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'visitor' | 'contributor' | 'organizer' | 'moderator' | 'admin';
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

  // --- Users / auth ----------------------------------------------------------
  createUser(input: { email: string; name: string; passwordHash: string; role: UserRecord['role'] }): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;

  // --- Audit -----------------------------------------------------------------
  appendAudit(record: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<AuditRecord>;
  listAudit(limit: number): Promise<AuditRecord[]>;
}
