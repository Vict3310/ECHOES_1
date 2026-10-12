import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyticsConsent,
  attachUnloadFlush,
  flush,
  initTracker,
  optOut,
  queuedEvents,
  resetTrackerForTests,
  setConsent,
  track,
  trackPageView,
  trackerState,
} from './tracker';

/**
 * These tests run in jsdom, which has no `localStorage` unless one is provided.
 * A real store is needed here because the tracker's whole privacy story — a random
 * identifier the browser keeps, a consent flag, a session id — lives in it.
 */
function withStorage(entries: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(entries));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return store;
}

interface FetchCall {
  url: string;
  body: unknown;
}

/** Records every request so a test can assert on what was actually sent. */
function stubFetch(response: (url: string) => unknown = () => ({ data: {} })): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      return {
        ok: true,
        status: 200,
        json: async () => response(url),
      } as unknown as Response;
    }),
  );
  return calls;
}

function configResponse(requireConsent = false) {
  return {
    data: {
      requireConsent,
      sessionTimeoutMinutes: 30,
      maxBatchSize: 20,
      flushIntervalMs: 10_000,
      events: ['page_view', 'session_started', 'search_performed', 'cultural_place_viewed', 'ai_question_submitted'],
    },
  };
}

beforeEach(() => {
  withStorage();
  resetTrackerForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetTrackerForTests();
  Reflect.deleteProperty(window, 'localStorage');
  // Both privacy signals are defined as own properties on `navigator` by the
  // tests below; leaving either behind would silently disable every later test.
  Reflect.deleteProperty(navigator, 'doNotTrack');
  Reflect.deleteProperty(navigator, 'globalPrivacyControl');
});

describe('tracker state', () => {
  it('starts enabled when consent is not required', async () => {
    stubFetch(() => configResponse(false));
    await expect(initTracker()).resolves.toBe('enabled');
    expect(trackerState()).toBe('enabled');
  });

  it('sends nothing until consent is granted when the API requires it', async () => {
    const calls = stubFetch(() => configResponse(true));
    await expect(initTracker()).resolves.toBe('pending_consent');

    // A queued event now would be sent the moment consent arrived, which is not
    // what asking for consent means.
    expect(track('page_view')).toBe(false);
    expect(queuedEvents()).toHaveLength(0);
    expect(await flush()).toBe(0);
    expect(calls.filter((call) => call.url.includes('/api/analytics/events'))).toHaveLength(0);

    setConsent(true);
    expect(trackerState()).toBe('enabled');
    expect(track('page_view')).toBe(true);
    // Two events go out: the page view, and the session it opened.
    expect(await flush()).toBe(2);
  });

  it('honours a browser do-not-track signal without asking', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    const calls = stubFetch(() => configResponse(false));
    await expect(initTracker()).resolves.toBe('denied');
    expect(track('page_view')).toBe(false);
    // Not even the configuration request is made.
    expect(calls).toHaveLength(0);
  });

  it('treats a global privacy control signal the same way', async () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    await expect(initTracker()).resolves.toBe('denied');
  });

  it('stays denied once consent is refused, and remembers the decision', async () => {
    stubFetch(() => configResponse(true));
    await initTracker();
    setConsent(false);

    expect(trackerState()).toBe('denied');
    expect(analyticsConsent()).toBe('denied');
    expect(track('page_view')).toBe(false);
  });
});

describe('what gets sent', () => {
  it('validates event names against the allowlist the server publishes', async () => {
    stubFetch(() => configResponse(false));
    await initTracker();

    expect(track('page_view')).toBe(true);
    // Not on the allowlist: refused before it ever reaches the network.
    expect(track('payment_verified')).toBe(false);
    expect(track('made_up_metric')).toBe(false);
  });

  it('bounds property values and drops undefined ones', async () => {
    const calls = stubFetch(() => configResponse(false));
    await initTracker();
    track('search_performed', { query: 'x'.repeat(300), resultCount: 4, other: undefined });
    await flush();

    const beacon = calls.find((call) => call.url.includes('/api/analytics/events'))!;
    const body = beacon.body as { events: Array<{ props: Record<string, unknown> }> };
    const search = body.events.find((event) => event.props.query) ?? body.events[0]!;
    expect(String(search.props.query).length).toBe(80);
    expect(search.props).not.toHaveProperty('other');
  });

  it('attaches the visitor id and never a user identifier', async () => {
    const calls = stubFetch(() => configResponse(false));
    await initTracker();
    track('page_view');
    await flush();

    const beacon = calls.find((call) => call.url.includes('/api/analytics/events'))!;
    const body = beacon.body as Record<string, unknown>;
    expect(typeof body.visitorId).toBe('string');
    expect(String(body.visitorId)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    // No question text, no email, no account id anywhere in the payload.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/@|password|userId|question/i);
  });

  it('opens a session on the first event and reuses it within the timeout', async () => {
    stubFetch(() => configResponse(false));
    await initTracker();

    track('page_view');
    track('cultural_place_viewed', { placeName: 'Freedom Park' }, 'freedom-park');

    const names = queuedEvents().map((event) => event.name);
    expect(names.filter((name) => name === 'session_started')).toHaveLength(1);
    expect(queuedEvents()[0]!.props).toMatchObject({ landingPath: expect.any(String) });
  });

  it('does not record the same page twice in a row', async () => {
    stubFetch(() => configResponse(false));
    await initTracker();

    trackPageView('/discover');
    trackPageView('/discover');
    trackPageView('/places/freedom-park');

    const views = queuedEvents().filter((event) => event.name === 'page_view');
    expect(views).toHaveLength(2);
  });
});

describe('events that happen before the configuration arrives', () => {
  it('keeps a page view reported on the way in, and sends it once started', async () => {
    const calls = stubFetch(() => configResponse(false));

    // A direct load renders — and reports its page view — before the config
    // request can resolve. Dropping it would lose the landing page of a visit.
    trackPageView('/discover');
    trackPageView('/discover');
    expect(queuedEvents().filter((event) => event.name === 'page_view')).toHaveLength(1);

    await expect(initTracker()).resolves.toBe('enabled');
    await vi.waitFor(async () => {
      expect(calls.some((call) => call.url.includes('/api/analytics/events'))).toBe(true);
    });

    const beacon = calls.find((call) => call.url.includes('/api/analytics/events'))!;
    const body = beacon.body as { events: Array<{ name: string; path: string }> };
    const views = body.events.filter((event) => event.name === 'page_view');
    // Counted once, and the path recorded is the location it happened at.
    expect(views).toHaveLength(1);
    expect(views[0]!.path).toBe(window.location.pathname);
  });

  it('discards that page view if it turns out consent is required', async () => {
    const calls = stubFetch(() => configResponse(true));
    trackPageView('/discover');
    expect(queuedEvents().filter((event) => event.name === 'page_view')).toHaveLength(1);

    await expect(initTracker()).resolves.toBe('pending_consent');
    // Holding it would mean sending before consent the moment consent arrived.
    expect(queuedEvents()).toHaveLength(0);
    expect(calls.filter((call) => call.url.includes('/api/analytics/events'))).toHaveLength(0);
  });
});

describe('sending', () => {
  it('sends a batch and reports how many events went', async () => {
    const calls = stubFetch(() => configResponse(false));
    await initTracker();
    track('page_view');
    track('page_view');

    expect(await flush()).toBeGreaterThanOrEqual(2);
    const beacons = calls.filter((call) => call.url.includes('/api/analytics/events'));
    expect(beacons).toHaveLength(1);
  });

  it('never resends a batch that the server rejected as invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/analytics/config')) {
          return { ok: true, status: 200, json: async () => configResponse(false) } as unknown as Response;
        }
        return { ok: false, status: 400, json: async () => ({}) } as unknown as Response;
      }),
    );
    await initTracker();
    track('page_view');

    expect(await flush()).toBe(0);
    // Dropped, not retried in a loop: a 4xx batch will never be accepted.
    expect(queuedEvents()).toHaveLength(0);
  });

  it('keeps the batch when the failure looks transient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/analytics/config')) {
          return { ok: true, status: 200, json: async () => configResponse(false) } as unknown as Response;
        }
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      }),
    );
    await initTracker();
    track('page_view');

    expect(await flush()).toBe(0);
    expect(queuedEvents().length).toBeGreaterThan(0);
  });

  it('sends the first batch of a visit promptly rather than waiting for a throttled timer', async () => {
    const calls = stubFetch(() => configResponse(false));
    await initTracker();
    track('page_view');

    // Browsers throttle intervals in background tabs, so a page view must not
    // depend on the interval alone to reach the API.
    await vi.waitFor(
      async () => {
        expect(calls.filter((call) => call.url.includes('/api/analytics/events')).length).toBeGreaterThan(0);
      },
      { timeout: 5_000 },
    );
  });

  it('flushes with a beacon when the tab is hidden, and cleans up after itself', async () => {
    const calls = stubFetch(() => configResponse(false));
    await initTracker();
    const detach = attachUnloadFlush();

    track('page_view');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.includes('/api/analytics/events'))).toBe(true);
    });

    const before = calls.length;
    detach();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls.length).toBe(before);
    Reflect.deleteProperty(document, 'visibilityState');
  });
});

describe('withdrawing consent', () => {
  it('erases what was collected and stops collecting', async () => {
    const calls = stubFetch(() => configResponse(false));
    await initTracker();
    track('page_view');
    await flush();

    const beaconsBefore = calls.filter((call) => call.url.includes('/api/analytics/events')).length;
    const result = await optOut();

    expect(result.erased).toBeGreaterThanOrEqual(0);
    expect(calls.some((call) => call.url.includes('/api/analytics/opt-out'))).toBe(true);
    expect(trackerState()).toBe('opted_out');
    expect(track('page_view')).toBe(false);
    // A later flush sends nothing, even though the visitor id was also cleared.
    expect(await flush()).toBe(0);
    expect(calls.filter((call) => call.url.includes('/api/analytics/events'))).toHaveLength(beaconsBefore);
  });

  it('stays opted out across a reload', async () => {
    stubFetch(() => configResponse(false));
    await initTracker();
    await optOut();
    resetTrackerForTests();

    await expect(initTracker()).resolves.toBe('opted_out');
  });
});
