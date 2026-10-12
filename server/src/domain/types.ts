/**
 * Coverage status describes what was actually found in the sources that were
 * checked. It is evidence about the checked datasets — it is never a statement
 * about whether a culture or community "knows" its own history.
 */
export type CoverageStatus =
  | 'available'
  | 'incomplete'
  | 'missing'
  | 'conflicting'
  | 'awaiting_review';

export const COVERAGE_DIMENSIONS = [
  'coordinates',
  'encyclopedicArticle',
  'structuredFacts',
  'image',
  'citations',
  'communityStory',
  'verifiedExperience',
] as const;

export type CoverageDimension = (typeof COVERAGE_DIMENSIONS)[number];

export interface CoverageEntry {
  status: CoverageStatus;
  evidence: string;
}

export interface SourceRef {
  title: string;
  publisher: string;
  url: string;
  license?: string;
  retrievedAt?: string;
  /** Result of checking the citation resolves. `null` means it could not be checked. */
  found?: boolean | null;
  /** When the citation was last checked by the ingestion pipeline. */
  checkedAt?: string;
}

/**
 * A freely-licensed image with the attribution needed to reuse it. `null` on a
 * place means no image passed the licence check — the interface falls back to
 * its designed placeholder rather than showing something we cannot credit.
 */
export interface PlaceImage {
  file: string;
  localPath: string;
  width: number;
  height: number;
  mime: string;
  license: string;
  licenseUrl: string | null;
  artist: string | null;
  credit: string | null;
  attributionRequired: boolean;
  /**
   * `place` = a confirmed, openly licensed photograph of this place.
   * `representative` = a stock image shown for atmosphere, labelled as such.
   */
  depicts?: 'place' | 'representative';
  filePageUrl: string;
  articleUrl: string;
  retrievedAt: string;
}

export type PlaceCategory =
  | 'historical-architecture'
  | 'heritage-site'
  | 'cultural-landmark'
  | 'museum'
  | 'market'
  | 'public-art'
  | 'traditional-site';

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  neighbourhood: string;
  address: string;
  coordinates: { lat: number; lng: number };
  coordinateAccuracy: 'approximate' | 'surveyed';
  summary: string;
  history: string;
  tags: string[];
  sources: SourceRef[];
  coverage: Record<CoverageDimension, CoverageEntry>;
  image?: PlaceImage | null;
}

export interface ExperienceSchedule {
  id: string;
  startsAt: string;
  capacity: number;
  booked: number;
}

export interface Experience {
  id: string;
  slug: string;
  isSampleData: boolean;
  title: string;
  organizer: string;
  placeId: string;
  summary: string;
  meetingPoint: string;
  coordinates: { lat: number; lng: number };
  durationMinutes: number;
  currency: string;
  priceMinor: number;
  cancellationTerms: string;
  accessibility: string;
  languages: string[];
  schedules: ExperienceSchedule[];
}

export type StoryStatus = 'pending' | 'approved' | 'rejected' | 'needs_correction';
export type GuideStatus = 'pending' | 'approved' | 'rejected' | 'needs_correction';
export type AttributionPreference = 'full_name' | 'pseudonym' | 'anonymous';
export type SensitivityLevel = 'standard' | 'sensitive' | 'restricted';

export interface GuideProfile {
  id: string;
  email: string | null;
  name: string;
  role: string;
  city: string;
  specialties: string[];
  bio: string;
  availability: string | null;
  priceFrom: string | null;
  /** Public path of an uploaded photograph, or null when none was provided. */
  avatarUrl: string | null;
  rating: number;
  status: GuideStatus;
  moderationNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Story {
  id: string;
  reference: string;
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
  status: StoryStatus;
  moderationNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PaymentStatus =
  | 'initialised'
  | 'pending'
  | 'successful'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'mismatched';

export interface PaymentAttempt {
  id: string;
  bookingId: string;
  reference: string;
  providerReference: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  providerStatus: string | null;
  checkoutUrl: string | null;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Booking {
  id: string;
  reference: string;
  experienceId: string;
  scheduleId: string;
  participants: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  status: BookingStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  createdAt: string;
}

export interface PlaceFilters {
  category?: PlaceCategory;
  neighbourhood?: string;
  query?: string;
  needsResearch?: boolean;
  limit?: number;
  offset?: number;
}
