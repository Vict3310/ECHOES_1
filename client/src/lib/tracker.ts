/**
 * First-party analytics tracker.
 *
 * What it sends: an event name from the server's allowlist, a timestamp, the
 * current path, and at most the few properties that event defines. What it never
 * sends: anything typed into the product, an email address, a precise location,
 * or a third-party identifier. There is no vendor script, no cross-site pixel and
 * no cookie — identifiers live in this browser's own storage.
 *
 * Consent is honest in both directions: when consent is required, nothing is sent
 * until it is granted, and `optOut()` erases what was already collected rather
 * than just stopping future sends.
 */

const VISITOR_KEY = 'echoes.visitorId';
const SESSION_KEY = 'echoes.session';
const CONSENT_KEY = 'echoes.analyticsConsent';
const OPT_OUT_KEY = 'echoes.analyticsOptOut';

/**
 * Mirrors the server allowlist for the case where the config request fails: the
 * server still validates everything, so a stale list here cannot invent a metric.
 */
const FALLBACK_EVENTS = [
  'page_view',
  'session_started',
  'user_registered',
  'user_login',
  'user_logout',
  'search_performed',
  'cultural_place_viewed',
  'map_opened',
  'route_requested',
  'ai_guide_opened',
  'ai_question_submitted',
  'itinerary_created',
  'story_submission_started',
  'story_submitted',
  'booking_started',
] as const;

export type TrackerState =
  /** Started, but the configuration has not arrived yet. Events may be queued. */
  | 'initialising'
  | 'pending_consent'
  | 'denied'
  | 'enabled'
  | 'opted_out'
  /** No browser storage at all — nothing can be identified or queued. */
  | 'unsupported';

export interface TrackProperties {
  [key: string]: string | number | boolean | undefined;
}

interface QueuedEvent {
  id: string;
  name: string;
  occurredAt: string;
  path: string;
  resourceId?: string | null;
  props?: Record<string, string | number | boolean>;
}

let allowed: Set<string> = new Set(FALLBACK_EVENTS);
let configLoaded = false;
let queue: QueuedEvent[] = [];
// The module is usable before its configuration arrives: events that happen in
// that window are queued rather than dropped. A direct page load renders, and
// therefore reports its page view, before the config request can resolve.
let state: TrackerState = 'initialising';
let flushTimer: number | null = null;
let requireConsent = false;
let sessionTimeoutMs = 30 * 60 * 1000;
let maxBatchSize = 20;
let lastPath: string | null = null;
let lastPathAt = 0;

function storage(): {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
} | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    // Private-mode browsers can throw on write; that must not break the page.
    const probe = '__echoes_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return {
      get: (key) => window.localStorage.getItem(key),
      set: (key, value) => window.localStorage.setItem(key, value),
      remove: (key) => window.localStorage.removeItem(key),
    };
  } catch {
    return null;
  }
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Fall through to the Math.random path below.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(16, '0');
}

function visitorId(): string | null {
  const store = storage();
  if (!store) return null;
  const existing = store.get(VISITOR_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const created = randomId();
  store.set(VISITOR_KEY, created);
  return created;
}

interface SessionState {
  id: string;
  lastAt: number;
}

function readSession(): SessionState | null {
  const store = storage();
  const raw = store?.get(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionState;
    if (typeof parsed?.id === 'string' && typeof parsed?.lastAt === 'number') return parsed;
  } catch {
    return null;
  }
  return null;
}

/**
 * A session ends after inactivity, and the timeout is shared with the server
 * (which assigns the authoritative session id anyway). A new session here also
 * emits `session_started`, which is what records the landing path.
 */
function currentSession(now: number): { session: SessionState; started: boolean } {
  const store = storage();
  const existing = readSession();
  if (existing && now - existing.lastAt <= sessionTimeoutMs) {
    const updated = { id: existing.id, lastAt: now };
    store?.set(SESSION_KEY, JSON.stringify(updated));
    return { session: updated, started: false };
  }
  const created = { id: randomId(), lastAt: now };
  store?.set(SESSION_KEY, JSON.stringify(created));
  return { session: created, started: true };
}

function privacySignalsOptOut(): boolean {
  if (typeof navigator === 'undefined') return false;
  const global = navigator as Navigator & { globalPrivacyControl?: boolean };
  return navigator.doNotTrack === '1' || global.globalPrivacyControl === true;
}

function explicitlyOptedOut(): boolean {
  return storage()?.get(OPT_OUT_KEY) === 'true';
}

/** The state the UI should render for a consent banner or a settings toggle. */
export function trackerState(): TrackerState {
  return state;
}

export function analyticsConsent(): 'granted' | 'denied' | null {
  const value = storage()?.get(CONSENT_KEY);
  return value === 'granted' || value === 'denied' ? value : null;
}

let initPromise: Promise<TrackerState> | null = null;

/**
 * Starts the tracker. Idempotent: several components may ask for it, and they all
 * receive the same first result rather than each re-fetching the configuration.
 */
export function initTracker(options: { apiBase?: string } = {}): Promise<TrackerState> {
  if (!initPromise) initPromise = doInit(options);
  return initPromise;
}

async function doInit(options: { apiBase?: string } = {}): Promise<TrackerState> {
  if (typeof window === 'undefined') {
    state = 'unsupported';
    return state;
  }

  if (explicitlyOptedOut()) {
    queue = [];
    state = 'opted_out';
    return state;
  }
  if (privacySignalsOptOut()) {
    // A browser-level "do not track" is treated as a decision, not a suggestion.
    queue = [];
    state = 'denied';
    return state;
  }

  const base = options.apiBase ?? '';
  try {
    const response = await fetch(`${base}/api/analytics/config`, { credentials: 'include' });
    if (response.ok) {
      const payload = (await response.json()) as {
        data?: {
          requireConsent?: boolean;
          sessionTimeoutMinutes?: number;
          maxBatchSize?: number;
          flushIntervalMs?: number;
          events?: string[];
        };
      };
      const config = payload.data;
      if (config) {
        requireConsent = Boolean(config.requireConsent);
        sessionTimeoutMs = (config.sessionTimeoutMinutes ?? 30) * 60 * 1000;
        maxBatchSize = config.maxBatchSize ?? 20;
        if (Array.isArray(config.events) && config.events.length > 0) allowed = new Set(config.events);
        if (config.flushIntervalMs) startFlushTimer(config.flushIntervalMs);
      }
    }
  } catch {
    // Offline or blocked: the fallback allowlist keeps behaviour sane, and the
    // server validates every event regardless.
  }

  configLoaded = true;

  const consent = analyticsConsent();
  if (requireConsent && consent !== 'granted') {
    // Events queued before we knew consent was required are discarded: keeping
    // them would mean sending before consent, which is the whole point of asking.
    queue = [];
    state = 'pending_consent';
    return state;
  }
  if (consent === 'denied') {
    queue = [];
    state = 'denied';
    return state;
  }

  state = 'enabled';
  startFlushTimer(10_000);
  // Anything queued while the configuration was in flight goes now.
  if (queue.length > 0) void flush();
  return state;
}

export function setConsent(granted: boolean): void {
  const store = storage();
  store?.set(CONSENT_KEY, granted ? 'granted' : 'denied');
  if (granted) {
    store?.remove(OPT_OUT_KEY);
    state = 'enabled';
    startFlushTimer(10_000);
    void flush();
    return;
  }
  state = 'denied';
  queue = [];
}

/** Withdraws consent and erases what was collected for this browser. */
export async function optOut(options: { apiBase?: string } = {}): Promise<{ erased: number }> {
  const store = storage();
  const id = store?.get(VISITOR_KEY) ?? null;
  queue = [];
  state = 'opted_out';
  store?.set(OPT_OUT_KEY, 'true');
  store?.set(CONSENT_KEY, 'denied');
  store?.remove(VISITOR_KEY);
  store?.remove(SESSION_KEY);

  if (!id) return { erased: 0 };
  try {
    const response = await fetch(`${options.apiBase ?? ''}/api/analytics/opt-out`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId: id }),
    });
    if (!response.ok) return { erased: 0 };
    const payload = (await response.json()) as { data?: { erased?: number } };
    return { erased: payload.data?.erased ?? 0 };
  } catch {
    // The local decision stands even if the erasure request could not be sent.
    return { erased: 0 };
  }
}

let firstFlushScheduled = false;

function scheduleFirstFlush(): void {
  if (firstFlushScheduled || typeof window === 'undefined') return;
  firstFlushScheduled = true;
  window.setTimeout(() => {
    void flush();
  }, 3_000);
}

function startFlushTimer(intervalMs: number): void {
  if (flushTimer !== null || typeof window === 'undefined') return;
  flushTimer = window.setInterval(() => {
    void flush();
  }, Math.max(intervalMs, 2_000));
}

/**
 * Queues one event. Returns false when the tracker is not in a state that allows
 * collection, so a caller can tell whether it was recorded.
 */
export function track(name: string, props: TrackProperties = {}, resourceId?: string | null): boolean {
  // `initialising` is allowed: the event happened, and the allowlist below is
  // already the conservative one. Everything else is a decision to send nothing.
  if (state !== 'enabled' && state !== 'initialising') return false;
  if (!allowed.has(name)) return false;

  const now = Date.now();
  const { started } = currentSession(now);
  if (started) {
    queue.push({
      id: randomId(),
      name: 'session_started',
      occurredAt: new Date(now).toISOString(),
      path: typeof window === 'undefined' ? '/' : window.location.pathname,
      props: { landingPath: typeof window === 'undefined' ? '/' : window.location.pathname },
    });
  }

  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    // Strings are bounded here as well as on the server, so a long title cannot
    // turn one page view into a large upload.
    clean[key] = typeof value === 'string' ? value.slice(0, 80) : value;
  }

  queue.push({
    id: randomId(),
    name,
    occurredAt: new Date(now).toISOString(),
    path: typeof window === 'undefined' ? '/' : window.location.pathname,
    resourceId: resourceId ?? null,
    props: clean,
  });

  if (queue.length >= maxBatchSize) void flush();
  // A timer alone is not enough: browsers throttle intervals in background and
  // hidden tabs, so a visit could go unreported for a minute. The first batch of
  // a page load goes out promptly, then the interval takes over.
  scheduleFirstFlush();
  return true;
}

/** A route change. Consecutive identical paths within a second count once. */
export function trackPageView(path: string, title?: string): void {
  const now = Date.now();
  if (lastPath === path && now - lastPathAt < 1_000) return;
  lastPath = path;
  lastPathAt = now;
  track('page_view', title ? { title: title.slice(0, 120) } : {});
}

/** Sends whatever is queued. Safe to call from an unload handler. */
export async function flush(options: { apiBase?: string; beacon?: boolean } = {}): Promise<number> {
  if (!configLoaded && queue.length === 0) return 0;
  if (queue.length === 0) return 0;

  const id = visitorId();
  if (!id) return 0;

  const batch = queue.splice(0, maxBatchSize);
  const body = JSON.stringify({ visitorId: id, events: batch });
  const url = `${options.apiBase ?? ''}/api/analytics/events`;

  // On unload, `sendBeacon` is the only request the browser guarantees to send.
  if (options.beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return batch.length;
    } catch {
      // Fall through to the fetch path.
    }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (!response.ok) {
      // A 4xx means the batch will never be accepted; retrying it would loop.
      if (response.status >= 400 && response.status < 500) return 0;
      queue = [...batch, ...queue].slice(0, 200);
      return 0;
    }
    return batch.length;
  } catch {
    queue = [...batch, ...queue].slice(0, 200);
    return 0;
  }
}

/**
 * Registers the handlers that stop the last events being lost: a beacon on
 * unload, and a normal flush as soon as the tab is hidden. Both matter — half of
 * all visits end in a tab that is switched away from rather than closed.
 */
export function attachUnloadFlush(options: { apiBase?: string } = {}): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void flush({ ...options, beacon: true });
    }
  };
  const onUnload = () => {
    void flush({ ...options, beacon: true });
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onUnload);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onUnload);
  };
}

/** Test helper: clears module state between tests. */
export function resetTrackerForTests(): void {
  allowed = new Set(FALLBACK_EVENTS);
  configLoaded = false;
  queue = [];
  state = 'initialising';
  requireConsent = false;
  sessionTimeoutMs = 30 * 60 * 1000;
  maxBatchSize = 20;
  lastPath = null;
  lastPathAt = 0;
  firstFlushScheduled = false;
  if (flushTimer !== null) window.clearInterval(flushTimer);
  flushTimer = null;
  initPromise = null;
}

/** Test helper: what is waiting to be sent. */
export function queuedEvents(): ReadonlyArray<QueuedEvent> {
  return queue;
}
