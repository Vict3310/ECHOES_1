import type {
  AnswerResult,
  CheckoutResult,
  Experience,
  HealthStatus,
  ItineraryResult,
  Place,
  ProviderStatus,
  RouteResult,
} from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiClientError(
      'The ECHOES API could not be reached. Check that the server is running.',
      0,
      'network_error',
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: unknown } })?.error;
    throw new ApiClientError(
      error?.message ?? `Request failed with HTTP ${response.status}.`,
      response.status,
      error?.code ?? 'request_failed',
      error?.details,
    );
  }

  return ((payload as { data?: T })?.data ?? (payload as T)) as T;
}

export const api = {
  health: () => request<HealthStatus>('/api/health'),

  places: (params: {
    category?: string;
    neighbourhood?: string;
    q?: string;
    needsResearch?: boolean;
    limit?: number;
  } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '' || value === false) continue;
      query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<{ places: Place[]; disclaimer: string; sourcesChecked: string[] }>(
      `/api/places${suffix}`,
    );
  },

  categories: () =>
    request<{ categories: Array<{ category: string; count: number }> }>('/api/places/categories'),

  neighbourhoods: () =>
    request<{ neighbourhoods: Array<{ neighbourhood: string; count: number }> }>(
      '/api/places/neighbourhoods',
    ),

  place: (id: string) =>
    request<{
      place: Place;
      communityStories: import('./types').CommunityStory[];
      experiences: Experience[];
      nearby: Array<{ id: string; name: string; category: string; distanceKm: number }>;
      sourcesChecked: string[];
    }>(`/api/places/${encodeURIComponent(id)}`),

  nearby: (lat: number, lng: number, radiusKm = 6) =>
    request<{ places: Place[] }>(
      `/api/places/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`,
    ),

  experiences: () =>
    request<{ experiences: Experience[]; provider: ProviderStatus; notice: string }>(
      '/api/experiences',
    ),

  experience: (id: string) =>
    request<{ experience: Experience; provider: ProviderStatus }>(
      `/api/experiences/${encodeURIComponent(id)}`,
    ),

  ask: (question: string, placeId?: string | null) =>
    request<AnswerResult>('/api/ai/answer', {
      method: 'POST',
      body: JSON.stringify({ question, placeId: placeId ?? null }),
    }),

  narration: (placeId: string) =>
    request<{
      placeId: string;
      placeName: string;
      script: string;
      mode: 'gemma' | 'records';
      model: string;
      audio: { provider: string; note: string };
      sources: import('./types').SourceRef[];
      qualifications: { coverageExplanation: string; communityAccountsAreUnverified: boolean };
    }>('/api/ai/narration', { method: 'POST', body: JSON.stringify({ placeId }) }),

  directions: (from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'walking' | 'driving') =>
    request<RouteResult>('/api/directions', {
      method: 'POST',
      body: JSON.stringify({ from, to, mode }),
    }),

  plan: (input: {
    start: { lat: number; lng: number; label: string };
    interests: string[];
    availableMinutes: number;
    transportMode: 'walking' | 'driving';
    maxStops: number;
    accessibilityNotes?: string;
  }) =>
    request<ItineraryResult>('/api/itineraries/plan', {
      method: 'POST',
      body: JSON.stringify({ ...input, budgetMinor: null }),
    }),

  submitStory: (input: Record<string, unknown>) =>
    request<{
      reference: string;
      status: string;
      sensitivity: string;
      message: string;
      reviewProcess: string[];
    }>('/api/stories', { method: 'POST', body: JSON.stringify(input) }),

  storyStatus: (reference: string, email?: string) =>
    request<{
      reference: string;
      status: string;
      moderationNote?: string | null;
      note?: string;
      body?: string;
    }>(`/api/stories/${encodeURIComponent(reference)}${email ? `?email=${encodeURIComponent(email)}` : ''}`),

  book: (input: {
    experienceId: string;
    scheduleId: string;
    participants: number;
    customerName: string;
    customerEmail: string;
    customerPhone?: string | null;
    notes?: string | null;
  }) => request<CheckoutResult>('/api/bookings', { method: 'POST', body: JSON.stringify(input) }),

  booking: (reference: string, email: string) =>
    request<{
      booking: {
        reference: string;
        status: string;
        participants: number;
        totalMinor: number;
        currency: string;
        customerEmail: string;
      };
      experienceTitle: string | null;
      payments: Array<{ reference: string; status: string; providerStatus: string | null; amountMinor: number }>;
    }>(`/api/bookings/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`),

  verifyPayment: (reference: string) =>
    request<{ verified: boolean; reason: string; message: string; booking: { reference: string; status: string } }>(
      `/api/payments/verify/${encodeURIComponent(reference)}`,
    ),

  simulatePayment: (reference: string, outcome: string) =>
    request<{
      simulated: boolean;
      verified: boolean;
      reason: string;
      message: string;
      booking: { reference: string; status: string };
      warning: string;
    }>(`/api/payments/simulate/${encodeURIComponent(reference)}`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    }),

  admin: {
    overview: (token: string) =>
      request<{
        counts: Record<string, number>;
        paymentsProvider: ProviderStatus;
        sourcesChecked: string[];
      }>('/api/admin/overview', { headers: { 'x-admin-token': token } }),

    stories: (token: string, status = 'pending') =>
      request<{ stories: import('./types').CommunityStory[] }>(
        `/api/admin/stories?status=${status}`,
        { headers: { 'x-admin-token': token } },
      ),

    moderate: (token: string, id: string, body: { status: string; moderationNote?: string | null }) =>
      request<{ story: import('./types').CommunityStory }>(`/api/admin/stories/${id}/moderate`, {
        method: 'POST',
        headers: { 'x-admin-token': token },
        body: JSON.stringify(body),
      }),

    payments: (token: string) =>
      request<{
        payments: Array<{
          reference: string;
          status: string;
          providerStatus: string | null;
          amountMinor: number;
          currency: string;
          bookingReference: string | null;
          bookingStatus: string | null;
          amountMatchesBooking: boolean | null;
          unresolved: boolean;
        }>;
        provider: ProviderStatus;
      }>('/api/admin/payments', { headers: { 'x-admin-token': token } }),

    dataQuality: (token: string) =>
      request<{
        places: Array<{
          id: string;
          name: string;
          category: string;
          needsResearch: boolean;
          coveredDimensions: number;
          totalDimensions: number;
          gaps: import('./types').KnowledgeGap[];
        }>;
        probableDuplicates: Array<{
          a: { id: string; name: string };
          b: { id: string; name: string };
          nameSimilarity: number;
          distanceKm: number | null;
          reason: string;
        }>;
        duplicatePolicy: string;
      }>('/api/admin/data-quality', { headers: { 'x-admin-token': token } }),
  },
};
