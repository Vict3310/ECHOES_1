import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Admin from '../../pages/Admin';
import { formatKpiValue, changeDisplay, type OverviewPayload, type UsersPayload } from '../../lib/analytics';

/**
 * The console is tested through its own interface: what an operator sees, clicks
 * and is told. Requests are stubbed, so these assertions are about the contract
 * between the page and the API rather than about a live server.
 */

function kpi(overrides: Partial<OverviewPayload['kpis'][number]> = {}): OverviewPayload['kpis'][number] {
  return {
    id: 'visitors_unique',
    label: 'Unique visitors',
    definition: 'Distinct anonymous visitor ids seen in the period.',
    source: 'analytics_events.visitorId',
    freshness: 'live',
    unit: 'count',
    group: 'audience',
    value: 120,
    previous: 100,
    absoluteChange: 20,
    percentChange: 20,
    ...overrides,
  };
}

const freshness = {
  generatedAt: new Date('2026-10-12T10:00:00.000Z').toISOString(),
  timezone: 'Africa/Lagos',
  collectionStart: '2026-09-01T00:00:00.000Z',
  lastEventAt: '2026-10-12T09:59:00.000Z',
  totalEventsStored: 4210,
  retentionDays: 400,
  partial: false,
  scannedEvents: { current: 100, previous: 90 },
  caveats: [],
};

function overviewPayload(): OverviewPayload {
  return {
    range: {
      preset: '30d',
      from: '2026-09-13T00:00:00.000Z',
      to: '2026-10-12T10:00:00.000Z',
      previousFrom: '2026-08-14T00:00:00.000Z',
      previousTo: '2026-09-12T23:59:59.999Z',
      bucket: 'day',
      label: '13 Sep – 12 Oct 2026',
      timezone: 'Africa/Lagos',
    },
    freshness,
    kpis: [
      kpi(),
      kpi({
        id: 'users_new',
        label: 'New users',
        group: 'audience',
        value: 0,
        previous: 0,
        absoluteChange: 0,
        percentChange: 0,
      }),
      kpi({
        id: 'revenue_verified',
        label: 'Verified revenue',
        group: 'commerce',
        unit: 'currency',
        value: 250_000,
        previous: 0,
        absoluteChange: 250_000,
        // No honest percentage against a zero period.
        percentChange: null,
      }),
      kpi({
        id: 'engagement_rate',
        label: 'Engagement rate',
        group: 'engagement',
        unit: 'percent',
        value: null,
        previous: null,
        absoluteChange: null,
        percentChange: null,
        freshness: 'unavailable',
        unavailableReason: 'No data source for this metric is configured in this deployment.',
      }),
    ],
    series: [
      { start: '2026-10-10T00:00:00.000Z', label: '10 Oct', visitors: 10, sessions: 12, pageViews: 30, placeViews: 8, registrations: 1, activeUsers: 3, aiQuestions: 2, partial: false },
      { start: '2026-10-11T00:00:00.000Z', label: '11 Oct', visitors: 14, sessions: 16, pageViews: 40, placeViews: 11, registrations: 2, activeUsers: 4, aiQuestions: 5, partial: false },
    ],
    topPages: [{ key: '/discover', label: '/discover', count: 40 }],
    topPlaces: [{ key: 'freedom-park', label: 'Freedom Park', count: 12, category: 'heritage-site' }],
    unviewedPlaces: [{ id: 'sungbo-erodo', name: 'Sungbo Eredo', category: 'heritage-site', sourceCount: 1 }],
    trafficSources: [{ key: 'direct', label: 'direct', count: 30 }],
    devices: [{ key: 'desktop', label: 'desktop', count: 20, device: 'desktop' }],
    campaigns: [],
    funnel: [
      { id: 'visitors', label: 'Visitors', value: 120, fromPreviousPercent: null, note: 'Distinct ids.' },
      { id: 'payment_verified', label: 'Payment verified', value: null, fromPreviousPercent: null, note: 'No payment provider is configured.' },
    ],
    engagement: {
      sessions: 15,
      engagedSessions: 9,
      engagementRatePercent: 60,
      averageEngagementSeconds: 84,
      singleEventSessions: 4,
      previous: {
        sessions: 14,
        engagedSessions: 7,
        engagementRatePercent: 50,
        averageEngagementSeconds: 70,
        singleEventSessions: 5,
      },
    },
  };
}

function usersPayload(): UsersPayload {
  return {
    range: overviewPayload().range,
    freshness,
    summary: {
      total: 12,
      active: 11,
      suspended: 1,
      newInPeriod: 3,
      previousNewInPeriod: 2,
      newChangePercent: 50,
      activeInPeriod: 5,
      withNoRecordedActivity: 7,
      byRole: [{ role: 'visitor', count: 10 }, { role: 'organizer', count: 2 }],
    },
    rows: [
      {
        id: 'user-1',
        name: 'Ada Okafor',
        email: 'ada@example.com',
        role: 'visitor',
        status: 'active',
        suspendedAt: null,
        createdAt: '2026-09-20T10:00:00.000Z',
        lastActiveAt: '2026-10-11T09:00:00.000Z',
        eventsInPeriod: 12,
        sessionsInPeriod: 3,
        signupSource: 'direct',
        activityNote: null,
      },
      {
        id: 'user-2',
        name: 'Bola Ade',
        email: 'bola@example.com',
        role: 'organizer',
        status: 'suspended',
        suspendedAt: '2026-10-01T10:00:00.000Z',
        createdAt: '2026-08-01T10:00:00.000Z',
        lastActiveAt: null,
        eventsInPeriod: 0,
        sessionsInPeriod: 0,
        signupSource: null,
        activityNote: 'No recorded activity in the selected period.',
      },
    ],
    pagination: { total: 12, returned: 2 },
    privacy: { note: 'Passwords, tokens and reset links are never returned by this API.' },
  };
}

const requests: Array<{ url: string; method: string; body: unknown }> = [];

/** Routes the console's requests to canned payloads. */
function stubApi(overrides: { failSection?: string; requireConsent?: boolean } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });

      if (overrides.failSection && url.includes(overrides.failSection)) {
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          text: async () => JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong on the server.' } }),
        } as unknown as Response;
      }

      let data: unknown = {};
      if (url.includes('/api/admin/analytics/meta')) {
        data = {
          timezone: 'Africa/Lagos',
          retentionDays: 400,
          requireConsent: overrides.requireConsent ?? false,
          adminEmailsConfigured: false,
          payments: { configured: false, missing: [] },
          store: 'memory',
        };
      } else if (url.includes('/api/admin/analytics/overview')) {
        data = overviewPayload();
      } else if (url.includes('/api/admin/analytics/users')) {
        data = usersPayload();
      } else if (url.includes('/api/admin/analytics/discovery')) {
        data = {
          ...overviewPayload(),
          summary: {
            placeViews: 30,
            distinctPlacesViewed: 6,
            mapOpens: 9,
            routeRequests: 4,
            routeFailures: 1,
            routeFailureRatePercent: 25,
            itineraryCreated: 2,
            storySubmissionsStarted: 5,
            storySubmissions: 2,
            moderation: { pending: 3, approved: 1, rejected: 0, needsCorrection: 1 },
            categoryPopularity: [{ key: 'heritage-site', label: 'heritage-site', count: 12 }],
          },
          topPaths: [],
          searches: {
            searches: 12,
            zeroResultSearches: 4,
            zeroResultRatePercent: 33.3,
            top: [{ key: 'masks', label: 'masks', count: 5 }],
            noResults: [{ key: 'sungbo eredo', label: 'sungbo eredo', count: 3 }],
          },
          unviewedPlaces: [],
          incompleteInformation: [],
          stories: {
            submittedInPeriod: 2,
            startedInPeriod: 5,
            backlog: 3,
            byStatus: { pending: 3, approved: 1, rejected: 0, needsCorrection: 1 },
            recent: [],
          },
          integrity: { note: 'A gap in the record is not proof the knowledge is absent.', incompletenessIsInformationGap: true },
        };
      } else if (url.includes('/api/admin/analytics/audit')) {
        data = { audit: [], note: 'Audit rows are append-only.' };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ data }),
        json: async () => ({ data }),
      } as unknown as Response;
    }),
  );
}

function renderConsole() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The console's own sidebar links home and back to Discover, so it is rendered
  // inside a router exactly as the app renders it.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Admin />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Renders with a stored token and waits only for the shell, not for data. */
async function unlockShell(): Promise<void> {
  sessionStorage.setItem('echoes.adminToken', 'test-admin-token');
  window.location.hash = '';
  renderConsole();
  await screen.findByRole('button', { name: /overview/i });
}

async function unlock(): Promise<void> {
  await unlockShell();
  // The section list renders immediately; the first figures arrive with the query.
  await screen.findByText('Unique visitors');
}

/** KPI cards carry a stable `data-kpi` hook so a test can assert inside one card. */
function kpiCard(id: string): HTMLElement {
  const card = document.querySelector(`[data-kpi="${id}"]`);
  if (!card) throw new Error(`no KPI card rendered for ${id}`);
  return card as HTMLElement;
}

beforeEach(() => {
  requests.length = 0;
  sessionStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.location.hash = '';
});

describe('the token gate', () => {
  it('asks for a token and explains where the security boundary is', () => {
    stubApi();
    renderConsole();

    expect(screen.getByLabelText(/admin token/i)).toBeInTheDocument();
    expect(screen.getByText(/authorises the request on the server/i)).toBeInTheDocument();
    // The sections need a token, but the console's own sidebar is already there.
    expect(screen.queryByRole('navigation', { name: /console sections/i })).toBeNull();
  });

  it('still gives the locked console its own sidebar and a way back to the site', () => {
    stubApi();
    renderConsole();

    const sidebar = screen.getByRole('navigation', { name: 'Console' });
    expect(within(sidebar).getByText(/console is locked/i)).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: /back to discover/i })).toHaveAttribute('href', '/discover');
    expect(within(sidebar).getByRole('link', { name: /ECHOES home/i })).toHaveAttribute('href', '/');
  });
});

describe('navigation', () => {
  it('lists the sections, grouped for the two kinds of work', async () => {
    stubApi();
    await unlock();

    const nav = screen.getByRole('navigation', { name: /console sections/i });
    for (const label of ['Overview', 'Cultural discovery', 'AI operations', 'Bookings & revenue', 'Users', 'System health', 'Moderation', 'Payment reconciliation', 'Data quality', 'Audit log']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByText('Analytics')).toBeInTheDocument();
    expect(within(nav).getByText('Operations')).toBeInTheDocument();
  });

  it('carries its own sidebar, with the way back to Discover at its foot', async () => {
    stubApi();
    await unlock();

    const nav = screen.getByRole('navigation', { name: /console sections/i });
    const back = within(nav).getByRole('link', { name: /back to discover/i });
    expect(back).toHaveAttribute('href', '/discover');
    // The console links home from its own sidebar rather than relying on the site rail.
    expect(within(nav).getByRole('link', { name: /ECHOES home/i })).toHaveAttribute('href', '/');
  });

  it('marks the current section and follows the URL hash', async () => {
    stubApi();
    await unlock();

    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('13 Sep – 12 Oct 2026 · compared with the equivalent preceding period')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    expect(window.location.hash).toBe('#users');
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('the date range', () => {
  it('re-fetches the selected period for every section', async () => {
    stubApi();
    await unlock();

    requests.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    await waitFor(() => {
      expect(requests.some((request) => request.url.includes('preset=7d'))).toBe(true);
    });
    // The selection is shared: the overview is not the only panel with a window.
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('accepts a custom range', async () => {
    stubApi();
    await unlock();

    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    requests.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(
        requests.some((request) => request.url.includes('from=2026-09-01') && request.url.includes('to=2026-09-30')),
      ).toBe(true);
    });
  });
});

describe('KPI cards', () => {
  it('shows the value, the comparison and how the metric is defined', async () => {
    stubApi();
    await unlock();

    const card = within(kpiCard('visitors_unique'));
    expect(card.getByText('120')).toBeInTheDocument();
    expect(card.getByText(/\+20.0%/)).toBeInTheDocument();
    expect(card.getByText('live')).toBeInTheDocument();

    // Provenance is behind a disclosure rather than absent: one click, and the
    // definition, its source and the previous period are all readable.
    expect(card.queryByText(/Distinct anonymous visitor ids/)).toBeNull();
    fireEvent.click(card.getByRole('button', { name: /definition/i }));
    expect(card.getByText(/Distinct anonymous visitor ids/)).toBeInTheDocument();
    expect(card.getByText(/analytics_events\.visitorId/)).toBeInTheDocument();
    expect(card.getByText(/previous period: 100/)).toBeInTheDocument();
  });

  it('says "new activity" instead of inventing a percentage over a zero period', async () => {
    stubApi();
    await unlock();

    const card = within(kpiCard('revenue_verified'));
    expect(card.getByText(/new activity/)).toBeInTheDocument();
    expect(card.queryByText(/%/)).toBeNull();
  });

  it('marks a metric with no source as unavailable rather than zero', async () => {
    stubApi();
    await unlock();

    const card = within(kpiCard('engagement_rate'));
    expect(card.getByText('—')).toBeInTheDocument();
    expect(card.getByText('unavailable')).toBeInTheDocument();
    fireEvent.click(card.getByRole('button', { name: /definition/i }));
    expect(card.getByText(/No data source/)).toBeInTheDocument();
  });

  it('opens the section a card belongs to', async () => {
    stubApi();
    await unlock();

    fireEvent.click(screen.getByRole('button', { name: 'Open commerce' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bookings & revenue' })).toBeInTheDocument();
  });
});

describe('charts and funnel', () => {
  it('labels the chart and reports the period it covers', async () => {
    stubApi();
    await unlock();

    const chart = await screen.findByRole('img', { name: /Unique visitors and sessions over time/ });
    expect(chart).toBeInTheDocument();
    expect(within(chart.parentElement as HTMLElement).getByText('Visitors')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('shows a funnel step with no source as a dash, with the reason', async () => {
    stubApi();
    await unlock();

    const row = (await screen.findByText('Payment verified')).closest('tr')!;
    // The count is a dash rather than a zero, and the reason is in the same row.
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(row).getByText('No payment provider is configured.')).toBeInTheDocument();
  });

  it('lists places with no recorded views as a gap, with the framing that explains it', async () => {
    stubApi();
    await unlock();

    expect(await screen.findByText('Sungbo Eredo')).toBeInTheDocument();
    expect(screen.getByText(/not evidence that these places lack history/i)).toBeInTheDocument();
  });
});

describe('errors and empty states', () => {
  it('reports a failed section with a retry that works', async () => {
    stubApi({ failSection: '/api/admin/analytics/overview' });
    // Deliberately not the usual helper: the figures never arrive in this case.
    await unlockShell();

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
    stubApi();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Unique visitors')).toBeInTheDocument();
  });

  it('announces partial data instead of presenting a truncated read as exact', async () => {
    stubApi();
    await unlock();

    const payload = overviewPayload();
    payload.freshness = {
      ...freshness,
      partial: true,
      caveats: ['This period holds more events than one read can scan, so the figures below are computed from a partial sample. Narrow the date range for exact totals.'],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const data = url.includes('/meta')
          ? { timezone: 'Africa/Lagos', retentionDays: 400, requireConsent: false, adminEmailsConfigured: false, payments: {}, store: 'memory' }
          : payload;
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data }), text: async () => JSON.stringify({ data }) } as unknown as Response;
      }),
    );

    cleanup();
    renderConsole();
    expect(await screen.findByText(/Partial data/i)).toBeInTheDocument();
  });
});

describe('users', () => {
  it('shows activity, and says plainly when there is none to show', async () => {
    stubApi();
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    expect(screen.getByText('bola@example.com')).toBeInTheDocument();
    // Both the column and the cell say it: the fact is stated, not left blank.
    expect(screen.getAllByText(/no recorded activity/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Passwords, tokens and reset links are never returned/)).toBeInTheDocument();
  });

  it('asks for a reason and records it when suspending an account', async () => {
    stubApi();
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    fireEvent.click(await screen.findByRole('button', { name: /Suspend Ada Okafor/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot sign in/i)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: /Suspend account/ });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/i), {
      target: { value: 'repeated abusive submissions' },
    });
    requests.length = 0;
    fireEvent.click(confirm);

    await waitFor(() => {
      const call = requests.find((request) => request.url.includes('/users/user-1/status'));
      expect(call?.method).toBe('POST');
      expect(call?.body).toEqual({ status: 'suspended', reason: 'repeated abusive submissions' });
    });
  });

  it('offers reactivation for a suspended account', async () => {
    stubApi();
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    expect(await screen.findByRole('button', { name: /Reactivate Bola Ade/ })).toBeInTheDocument();
  });

  it('offers no way to change a role, because the API cannot', async () => {
    stubApi();
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    await screen.findByText('Ada Okafor');
    expect(screen.queryByRole('button', { name: /make admin|promote|change role/i })).toBeNull();
    expect(screen.getByText(/Roles are fixed/)).toBeInTheDocument();
  });
});

describe('formatting helpers', () => {
  it('formats every unit rather than printing a raw float', () => {
    expect(formatKpiValue(1234, 'count')).toBe('1,234');
    expect(formatKpiValue(12.345, 'percent')).toBe('12.3%');
    expect(formatKpiValue(150, 'seconds')).toBe('2m 30s');
    expect(formatKpiValue(182.4, 'milliseconds')).toBe('182 ms');
    expect(formatKpiValue(250_000, 'currency', 'NGN')).toMatch(/2,500/);
    expect(formatKpiValue(null, 'count')).toBe('—');
  });

  it('describes a change honestly in every case', () => {
    expect(changeDisplay(kpi()).direction).toBe('up');
    expect(changeDisplay(kpi({ value: 80, previous: 100, percentChange: -20 })).direction).toBe('down');
    expect(changeDisplay(kpi({ value: 10, previous: 0, percentChange: null })).text).toBe('new activity');
    expect(changeDisplay(kpi({ value: 0, previous: 0, percentChange: 0 })).text).toBe('no change');
    expect(changeDisplay(kpi({ value: null, percentChange: null })).direction).toBe('unknown');
  });
});
