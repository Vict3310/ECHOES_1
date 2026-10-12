export type CoverageStatus =
  | 'available'
  | 'incomplete'
  | 'missing'
  | 'conflicting'
  | 'awaiting_review';

export type CoverageDimension =
  | 'coordinates'
  | 'encyclopedicArticle'
  | 'structuredFacts'
  | 'image'
  | 'citations'
  | 'communityStory'
  | 'verifiedExperience';

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
  /** Whether the citation was confirmed to resolve. `null` = could not be checked. */
  found?: boolean | null;
  /** When the citation was last checked by the ingestion pipeline. */
  checkedAt?: string;
}

/** A freely-licensed image plus the attribution required to reuse it. */
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

/** A guide profile as the marketplace and the dashboard receive it. */
export interface GuideSummary {
  id: string;
  name: string;
  role: string;
  city: string;
  rating: number;
  specialties: string[];
  bio: string;
  availability: string;
  priceFrom: string;
  /** Path this API serves the guide's uploaded photograph from, or null. */
  avatarUrl: string | null;
}

export type PlaceCategory =
  | 'historical-architecture'
  | 'heritage-site'
  | 'cultural-landmark'
  | 'museum'
  | 'market'
  | 'public-art'
  | 'traditional-site';

export interface KnowledgeGap {
  dimension: CoverageDimension;
  status: CoverageStatus;
  label: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string;
  contributionHint: string;
}

export interface KnowledgeAnalysis {
  placeId: string;
  statuses: Record<CoverageDimension, CoverageStatus>;
  gaps: KnowledgeGap[];
  needsResearch: boolean;
  coveredDimensions: number;
  totalDimensions: number;
  explanation: string;
}

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
  knowledge?: KnowledgeAnalysis;
  publishedStories?: number;
  pendingStories?: number;
  distanceKm?: number;
}

export interface CommunityStory {
  id: string;
  reference: string;
  body: string;
  period: string | null;
  sourceContext: string;
  attribution: 'full_name' | 'pseudonym' | 'anonymous';
  contributor: string;
  reviewedAt: string | null;
  status: string;
}

export interface ScheduleAvailability {
  scheduleId: string;
  startsAt: string;
  capacity?: number;
  remaining: number;
  soldOut: boolean;
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
  schedules: ScheduleAvailability[];
  placeName?: string | null;
  neighbourhood?: string | null;
  bookedOut?: boolean;
}

export interface Citation {
  id: string;
  kind: 'place' | 'source' | 'community-story';
  title: string;
  publisher?: string;
  url?: string;
  retrievedAt?: string;
  excerpt: string;
  placeId?: string;
}

export interface AnswerResult {
  answer: string;
  citations: Citation[];
  evidenceStatus: 'sufficient' | 'insufficient' | 'conflicting';
  followUpQuestions: string[];
  mode: 'gemma' | 'retrieval-only';
  provider: string;
  model: string;
  latencyMs: number;
  limitations: string[];
  placesUsed: Array<{ id: string; name: string; category: string }>;
  integrity?: string[];
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  mode: 'walking' | 'driving';
  provider: string;
  providerNote: string;
  limitations: string[];
  googleMapsUrl: string;
  navigationNote: string;
}

export interface ItineraryStop {
  placeId: string;
  name: string;
  category: PlaceCategory;
  neighbourhood: string;
  coordinates: { lat: number; lng: number };
  reason: string;
  suggestedVisitMinutes: number;
  sourceLinks: Array<{ title: string; publisher: string; url: string }>;
  openGaps: string[];
}

export interface ItineraryLeg {
  fromPlaceId: string;
  toPlaceId: string;
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
}

export interface ItineraryResult {
  title: string;
  summary: string;
  mode: 'gemma' | 'heuristic';
  provider: string;
  model: string;
  transportMode: 'walking' | 'driving';
  stops: ItineraryStop[];
  legs: ItineraryLeg[];
  totals: {
    visitMinutes: number;
    travelSeconds: number | null;
    totalMinutes: number | null;
    distanceMeters: number | null;
  };
  withinAvailableTime: boolean | null;
  limitations: string[];
  googleMapsUrl: string;
  routingProviderNote: string | null;
  generatedAt: string;
  notes?: {
    travelTimeSource: string;
    visitDurationsAreSuggestions: boolean;
    openingHours: string;
    liveTraffic: string;
  };
}

export interface ProviderStatus {
  environment: 'sandbox' | 'live';
  configured: boolean;
  missing: string[];
  simulationAllowed: boolean;
  transportReady: boolean;
}

export interface HealthStatus {
  status: string;
  time: string;
  uptimeSeconds: number;
  store: 'memory' | 'postgres';
  integrations: {
    gemma: {
      primaryModel: string;
      provider: string;
      model: string;
      configured: boolean;
      healthy: boolean;
      detail: string;
    };
    routing: { provider: string; baseUrl: string; productionReady: boolean };
    alatpay: ProviderStatus;
    database: { configured: boolean; note: string };
  };
}

export interface BookingSummary {
  reference: string;
  status: string;
  experienceId: string;
  scheduleId: string;
  participants: number;
  totalMinor: number;
  currency: string;
}

export interface CheckoutResult {
  booking: BookingSummary;
  payment: {
    reference: string;
    mode: 'provider' | 'simulated';
    checkoutUrl: string;
    status: string;
    simulated: boolean;
  };
  next: string;
  provider: ProviderStatus;
}
