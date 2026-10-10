import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPlaces } from '../src/data/dataset';
import { orderByDurations, planItinerary } from '../src/services/itinerary';
import { OfflineProvider } from '../src/services/gemma/providers';
import type { TransportMode } from '../src/services/routing';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Deterministic stand-in for the routing provider. */
function stubRouter(distancePerLeg = 1200, durationPerLeg = 600) {
  return vi.fn(async (url: string) => {
    if (url.includes('/table/v1/')) {
      const size = (url.split('/').pop() ?? '').split('?')[0]!.split(';').length;
      const durations = Array.from({ length: size }, (_, i) =>
        Array.from({ length: size }, (_, j) => (i === j ? 0 : durationPerLeg)),
      );
      const distances = Array.from({ length: size }, (_, i) =>
        Array.from({ length: size }, (_, j) => (i === j ? 0 : distancePerLeg)),
      );
      return jsonResponse({ code: 'Ok', durations, distances });
    }
    return jsonResponse({
      code: 'Ok',
      routes: [
        {
          distance: distancePerLeg,
          duration: durationPerLeg,
          geometry: { coordinates: [[3.4, 6.45], [3.41, 6.451]] },
          legs: [
            {
              steps: [
                { maneuver: { type: 'turn', modifier: 'left' }, name: 'Broad Street', distance: 600, duration: 300 },
                { maneuver: { type: 'arrive' }, name: '', distance: 600, duration: 300 },
              ],
            },
          ],
        },
      ],
    });
  });
}

const prefs = {
  start: { lat: 6.4505, lng: 3.3953, label: 'Freedom Park, Lagos Island' },
  interests: ['history', 'architecture', 'museum'],
  availableMinutes: 240,
  transportMode: 'walking' as TransportMode,
  maxStops: 3,
  currency: 'NGN',
};

describe('itinerary ordering helper', () => {
  it('orders stops by provider travel durations, starting from the visitor', () => {
    const durations = [
      [0, 100, 900],
      [900, 0, 50],
      [900, 50, 0],
    ];
    expect(orderByDurations(durations, 2, 'driving')).toEqual([0, 1]);
  });

  it('still returns every stop when durations are missing', () => {
    const order = orderByDurations([[0, 0], [0, 0]], 1, 'walking');
    expect(order).toEqual([0]);
  });
});

describe('itinerary planning', () => {
  it('validates model-free plans against the database and uses real routing numbers', async () => {
    vi.stubGlobal('fetch', stubRouter(1500, 720));
    const result = await planItinerary(prefs, loadPlaces(), new OfflineProvider());

    expect(result.mode).toBe('heuristic');
    expect(result.stops.length).toBeGreaterThan(0);
    expect(result.stops.length).toBeLessThanOrEqual(prefs.maxStops);

    const knownIds = new Set(loadPlaces().map((p) => p.id));
    for (const stop of result.stops) {
      expect(knownIds.has(stop.placeId)).toBe(true);
      expect(stop.sourceLinks.length).toBeGreaterThan(0);
    }

    // Every leg's distance and duration come from the provider response.
    const legs = result.legs.length;
    expect(legs).toBeGreaterThan(0);
    expect(legs).toBeLessThanOrEqual(result.stops.length);
    for (const leg of result.legs) {
      expect(leg.distanceMeters).toBe(1500);
      expect(leg.durationSeconds).toBe(720);
      expect(leg.steps.length).toBeGreaterThan(0);
    }
    expect(result.totals.travelSeconds).toBe(720 * legs);
    expect(result.totals.distanceMeters).toBe(1500 * legs);
    expect(result.totals.totalMinutes).toBeCloseTo(result.totals.visitMinutes + (720 * legs) / 60, 5);
    expect(result.googleMapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?/);
  });

  it('reports the routing provider limitation instead of inventing travel estimates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await planItinerary(prefs, loadPlaces(), new OfflineProvider());

    expect(result.legs).toHaveLength(0);
    expect(result.totals.travelSeconds).toBeNull();
    expect(result.totals.distanceMeters).toBeNull();
    expect(result.withinAvailableTime).toBeNull();
    expect(result.limitations.join(' ')).toMatch(/could not be calculated/i);
  });

  it('flags an over-budget plan rather than claiming it fits', async () => {
    vi.stubGlobal('fetch', stubRouter(4000, 3600));
    const tight = { ...prefs, availableMinutes: 60, maxStops: 3 };
    const result = await planItinerary(tight, loadPlaces(), new OfflineProvider());
    expect(result.withinAvailableTime).toBe(false);
    expect(result.limitations.join(' ')).toMatch(/exceeds the 60 minutes/i);
  });

  it('never returns a stop that is not in the database', async () => {
    vi.stubGlobal('fetch', stubRouter());
    const places = loadPlaces().slice(0, 4);
    const result = await planItinerary(prefs, places, new OfflineProvider());
    const ids = new Set(places.map((p) => p.id));
    for (const stop of result.stops) {
      expect(ids.has(stop.placeId)).toBe(true);
    }
  });
});
