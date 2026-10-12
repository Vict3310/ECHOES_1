import type {
  AnswerResult,
  CheckoutResult,
  Experience,
  GuideSummary,
  HealthStatus,
  ItineraryResult,
  Place,
  ProviderStatus,
  RouteResult,
} from './types';
import type {
  AiPayload,
  CommercePayload,
  DiscoveryPayload,
  HealthPayload,
  OverviewPayload,
  UsersPayload,
} from './analytics';

export interface AnalyticsRangeQuery {
  preset?: 'today' | '7d' | '30d' | '90d' | 'custom';
  from?: string;
  to?: string;
}

function rangeQuery(range: AnalyticsRangeQuery): string {
  const params = new URLSearchParams();
  if (range.preset) params.set('preset', range.preset);
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

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
  // A FormData body must keep the browser's own content type: it carries the
  // multipart boundary, and setting the header manually breaks the upload.
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init?.body && !isFormData ? { 'content-type': 'application/json' } : {}),
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
  auth: {
    register: (input: { email: string; name: string; password: string; role?: 'visitor' | 'organizer' }) =>
      request<{ user: { id: string; name: string; email: string; role: string }; token: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    login: (input: { email: string; password: string }) =>
      request<{ user: { id: string; name: string; email: string; role: string }; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    me: (token: string) =>
      request<{ user: { id: string; name: string; email: string; role: string } }>('/api/auth/me', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
    /** Always answers the same way, whether or not the address has an account. */
    requestPasswordReset: (input: { email: string }) =>
      request<{ message: string; expiresInMinutes: number }>('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    confirmPasswordReset: (input: { token: string; password: string }) =>
      request<{ message: string }>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

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

  guides: () =>
    request<{ guides: GuideSummary[] }>('/api/guides'),

  /** Applies to become a guide. The profile stays pending until it is reviewed. */
  applyAsGuide: (
    token: string,
    input: {
      name: string;
      role: string;
      city: string;
      specialties: string[];
      bio: string;
      availability?: string | null;
      priceFrom?: string | null;
      avatarUrl?: string | null;
    },
  ) =>
    request<{ guide: GuideSummary }>('/api/guides', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }),

  uploads: {
    /**
     * Sends one image and returns the path the API serves it from. The server
     * decides the type from the file's own bytes, so the returned URL may have a
     * different extension than the file that was picked.
     */
    image: (file: File, token: string) => {
      const form = new FormData();
      form.append('image', file);
      return request<{ url: string; filename: string; mime: string; bytes: number }>('/api/uploads', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
    },
  },

  guide: (id: string) =>
    request<{ guide: GuideSummary }>(`/api/guides/${encodeURIComponent(id)}`),

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

  bookings: (token?: string, email?: string) =>
    request<{
      bookings: Array<{
        id: string;
        reference: string;
        status: string;
        experienceId: string;
        experienceTitle: string;
        scheduleId: string;
        participants: number;
        totalMinor: number;
        currency: string;
        customerName: string;
        customerEmail: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>(`/api/bookings${email ? `?email=${encodeURIComponent(email)}` : ''}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),

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

    guides: (token: string, status = 'pending') =>
      request<{ guides: Array<{ id: string; name: string; role: string; city: string; rating: number; specialties: string[]; bio: string; availability: string | null; priceFrom: string | null; status: string; moderationNote: string | null; reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string }> }>(
        `/api/admin/guides?status=${status}`,
        { headers: { 'x-admin-token': token } },
      ),

    moderate: (token: string, id: string, body: { status: string; moderationNote?: string | null }) =>
      request<{ story: import('./types').CommunityStory }>(`/api/admin/stories/${id}/moderate`, {
        method: 'POST',
        headers: { 'x-admin-token': token },
        body: JSON.stringify(body),
      }),

    moderateGuide: (token: string, id: string, body: { status: string; moderationNote?: string | null }) =>
      request<{ guide: { id: string; name: string; role: string; city: string; rating: number; specialties: string[]; bio: string; availability: string | null; priceFrom: string | null; status: string; moderationNote: string | null; reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string } }>(`/api/admin/guides/${id}/moderate`, {
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

  /**
   * The analytics console. Every call is authorised on the server; the token here
   * is what the operator holds, not what grants access.
   */
  adminAnalytics: {
    meta: (token: string) =>
      request<{
        timezone: string;
        retentionDays: number;
        requireConsent: boolean;
        adminEmailsConfigured: boolean;
        payments: ProviderStatus;
        store: string;
      }>('/api/admin/analytics/meta', { headers: { 'x-admin-token': token } }),

    overview: (token: string, range: AnalyticsRangeQuery) =>
      request<OverviewPayload>(`/api/admin/analytics/overview${rangeQuery(range)}`, {
        headers: { 'x-admin-token': token },
      }),

    discovery: (token: string, range: AnalyticsRangeQuery) =>
      request<DiscoveryPayload>(`/api/admin/analytics/discovery${rangeQuery(range)}`, {
        headers: { 'x-admin-token': token },
      }),

    ai: (token: string, range: AnalyticsRangeQuery) =>
      request<AiPayload>(`/api/admin/analytics/ai${rangeQuery(range)}`, {
        headers: { 'x-admin-token': token },
      }),

    commerce: (token: string, range: AnalyticsRangeQuery) =>
      request<CommercePayload>(`/api/admin/analytics/commerce${rangeQuery(range)}`, {
        headers: { 'x-admin-token': token },
      }),

    health: (token: string, range: AnalyticsRangeQuery) =>
      request<HealthPayload>(`/api/admin/analytics/health${rangeQuery(range)}`, {
        headers: { 'x-admin-token': token },
      }),

    users: (
      token: string,
      range: AnalyticsRangeQuery,
      filters: { q?: string; role?: string; status?: string; page?: number; perPage?: number } = {},
    ) => {
      const params = new URLSearchParams();
      if (range.preset) params.set('preset', range.preset);
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      if (filters.q) params.set('q', filters.q);
      if (filters.role) params.set('role', filters.role);
      if (filters.status) params.set('status', filters.status);
      if (filters.page) params.set('page', String(filters.page));
      if (filters.perPage) params.set('perPage', String(filters.perPage));
      return request<UsersPayload>(`/api/admin/analytics/users?${params.toString()}`, {
        headers: { 'x-admin-token': token },
      });
    },

    setUserStatus: (token: string, id: string, body: { status: 'active' | 'suspended'; reason?: string }) =>
      request<{ user: { id: string; status: string }; note: string }>(
        `/api/admin/analytics/users/${id}/status`,
        { method: 'POST', headers: { 'x-admin-token': token }, body: JSON.stringify(body) },
      ),

    place: (token: string, id: string, range: AnalyticsRangeQuery) =>
      request<{
        range: { from: string; to: string; label: string };
        place: {
          id: string;
          name: string;
          category: string;
          neighbourhood: string | null;
          sources: number;
          coverage: { coveredDimensions: number; totalDimensions: number; needsResearch: boolean };
        };
        views: { total: number; visitors: number; byDevice: Record<string, number> };
        stories: { total: number; approved: number; pending: number };
        integrity: { note: string };
      }>(`/api/admin/analytics/places/${id}${rangeQuery(range)}`, {
        headers: { 'x-admin-token': token },
      }),

    audit: (token: string, limit = 100) =>
      request<{
        audit: Array<{
          id: string;
          actor: string;
          action: string;
          entityType: string;
          entityId: string;
          details: unknown;
          createdAt: string;
        }>;
        note: string;
      }>(`/api/admin/analytics/audit?limit=${limit}`, { headers: { 'x-admin-token': token } }),

    /**
     * Export as a file.
     *
     * Fetched rather than linked so the admin token stays in a header: putting it
     * in a query string would write it into browser history and server logs.
     */
    exportCsv: async (
      token: string,
      dataset: 'overview' | 'discovery' | 'ai' | 'users' | 'audit' | 'bookings',
      range: AnalyticsRangeQuery,
    ): Promise<{ blob: Blob; filename: string }> => {
      const params = new URLSearchParams();
      if (range.preset) params.set('preset', range.preset);
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      params.set('dataset', dataset);
      const response = await fetch(`${BASE}/api/admin/analytics/export?${params.toString()}`, {
        headers: { 'x-admin-token': token },
        credentials: 'include',
      });
      if (!response.ok) {
        throw new ApiClientError(`The export failed with HTTP ${response.status}.`, response.status, 'export_failed');
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      return { blob: await response.blob(), filename: match?.[1] ?? `echoes-${dataset}.csv` };
    },
  },
};
