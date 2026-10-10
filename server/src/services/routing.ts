import { env } from '../env';
import { ApiError } from '../lib/errors';
import { logger } from '../lib/logger';
import { distanceKm, formatDistance, formatDuration, type LatLng } from '../lib/geo';

export type TransportMode = 'walking' | 'driving';

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
  mode: TransportMode;
  provider: string;
  providerNote: string;
  limitations: string[];
}

const OSRM_PROFILE: Record<TransportMode, string> = {
  driving: 'driving',
  walking: 'foot',
};

const GRAPHHOPPER_PROFILE: Record<TransportMode, string> = {
  driving: 'car',
  walking: 'foot',
};

function providerNote(): string {
  if (env.routing.provider === 'osrm') {
    return env.routing.osrmBaseUrl.includes('router.project-osrm.org')
      ? 'Public OSRM demonstration server. Evaluation only — self-host OSRM (or use a commercial plan) for production traffic.'
      : 'Self-hosted OSRM instance.';
  }
  return 'GraphHopper routing API.';
}

const BASE_LIMITATIONS = [
  'Estimates do not include live traffic.',
  'Distances and durations are returned by the routing provider, not estimated by ECHOES.',
];

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

function decodeOsrmStep(step: { maneuver?: { type?: string; modifier?: string }; name?: string; distance?: number; duration?: number }): RouteStep {
  const type = step.maneuver?.type ?? 'continue';
  const modifier = step.maneuver?.modifier ? ` ${step.maneuver.modifier}` : '';
  const road = step.name ? ` onto ${step.name}` : '';
  const instruction = `${type}${modifier}${road}`.trim();
  return {
    instruction: instruction.charAt(0).toUpperCase() + instruction.slice(1),
    distanceMeters: Math.round(step.distance ?? 0),
    durationSeconds: Math.round(step.duration ?? 0),
  };
}

export function isRouteRequestValid(from: LatLng, to: LatLng): boolean {
  const valid = (p: LatLng) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  return valid(from) && valid(to) && distanceKm(from, to) > 0.005;
}

export async function calculateRoute(
  from: LatLng,
  to: LatLng,
  mode: TransportMode,
): Promise<RouteResult> {
  if (!isRouteRequestValid(from, to)) {
    throw ApiError.badRequest('A route needs two distinct, valid coordinates.');
  }

  if (env.routing.provider === 'graphhopper') {
    return graphHopperRoute(from, to, mode);
  }
  return osrmRoute(from, to, mode);
}

async function osrmRoute(from: LatLng, to: LatLng, mode: TransportMode): Promise<RouteResult> {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${env.routing.osrmBaseUrl.replace(/\/$/, '')}/route/v1/${OSRM_PROFILE[mode]}/${coordinates}?overview=full&geometries=geojson&steps=true`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, env.routing.timeoutMs);
  } catch (error) {
    throw ApiError.serviceUnavailable(
      'routing_unavailable',
      'The routing provider did not respond in time. Try again, or open the destination in Google Maps.',
      { provider: 'osrm', cause: error instanceof Error ? error.message : 'timeout' },
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // A missing profile is a capability limit, not a transient failure.
    if (response.status === 400 && /profile|foot|walk/i.test(detail)) {
      throw ApiError.unprocessable(
        `The configured routing provider does not serve a "${mode}" profile. Choose another transport mode, or open the destination in Google Maps.`,
        { provider: 'osrm', mode, detail: detail.slice(0, 200) },
      );
    }
    throw ApiError.serviceUnavailable(
      'routing_failed',
      `The routing provider returned HTTP ${response.status}.`,
      { provider: 'osrm', detail: detail.slice(0, 200) },
    );
  }

  const body = (await response.json()) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: Array<[number, number]> };
      legs?: Array<{ steps?: Array<Record<string, unknown>> }>;
    }>;
  };

  const route = body.routes?.[0];
  if (body.code !== 'Ok' || !route || !route.geometry?.coordinates?.length) {
    throw ApiError.serviceUnavailable(
      'no_route',
      'The routing provider could not find a route between those points.',
      { provider: 'osrm', code: body.code ?? 'unknown' },
    );
  }

  const steps = (route.legs?.[0]?.steps ?? []).map((step) =>
    decodeOsrmStep(step as Parameters<typeof decodeOsrmStep>[0]),
  );

  return {
    geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
    distanceMeters: Math.round(route.distance ?? 0),
    durationSeconds: Math.round(route.duration ?? 0),
    steps,
    mode,
    provider: 'osrm',
    providerNote: providerNote(),
    limitations: BASE_LIMITATIONS,
  };
}

async function graphHopperRoute(from: LatLng, to: LatLng, mode: TransportMode): Promise<RouteResult> {
  if (!env.routing.graphhopperApiKey) {
    throw ApiError.serviceUnavailable(
      'routing_not_configured',
      'ROUTING_PROVIDER=graphhopper but GRAPHHOPPER_API_KEY is not set.',
    );
  }
  const params = new URLSearchParams({
    point: `${from.lat},${from.lng}`,
    profile: GRAPHHOPPER_PROFILE[mode],
    points_encoded: 'false',
    instructions: 'true',
    key: env.routing.graphhopperApiKey,
  });
  params.append('point', `${to.lat},${to.lng}`);

  const url = `${env.routing.graphhopperBaseUrl.replace(/\/$/, '')}/route?${params.toString()}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, env.routing.timeoutMs);
  } catch (error) {
    throw ApiError.serviceUnavailable('routing_unavailable', 'The routing provider did not respond in time.', {
      cause: error instanceof Error ? error.message : 'timeout',
    });
  }
  if (!response.ok) {
    throw ApiError.serviceUnavailable('routing_failed', `GraphHopper returned HTTP ${response.status}.`);
  }

  const body = (await response.json()) as {
    paths?: Array<{
      distance?: number;
      time?: number;
      points?: { coordinates?: Array<[number, number]> };
      instructions?: Array<{ text?: string; distance?: number; time?: number }>;
    }>;
  };
  const path = body.paths?.[0];
  if (!path?.points?.coordinates?.length) {
    throw ApiError.serviceUnavailable('no_route', 'The routing provider could not find a route.');
  }

  return {
    geometry: { type: 'LineString', coordinates: path.points.coordinates },
    distanceMeters: Math.round(path.distance ?? 0),
    durationSeconds: Math.round((path.time ?? 0) / 1000),
    steps: (path.instructions ?? []).map((step) => ({
      instruction: step.text ?? 'Continue',
      distanceMeters: Math.round(step.distance ?? 0),
      durationSeconds: Math.round((step.time ?? 0) / 1000),
    })),
    mode,
    provider: 'graphhopper',
    providerNote: providerNote(),
    limitations: BASE_LIMITATIONS,
  };
}

/**
 * Travel durations between an ordered list of points using the provider's table
 * service. Returns null when the provider cannot serve a matrix, so the caller
 * can fall back to distance-based ordering and recompute real legs afterwards.
 */
export async function travelMatrix(
  points: LatLng[],
  mode: TransportMode,
): Promise<{ durationsSeconds: number[][]; distancesMeters: number[][] } | null> {
  if (env.routing.provider !== 'osrm' || points.length < 2) return null;
  const coordinates = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${env.routing.osrmBaseUrl.replace(/\/$/, '')}/table/v1/${OSRM_PROFILE[mode]}/${coordinates}?annotations=duration,distance`;

  try {
    const response = await fetchWithTimeout(url, env.routing.timeoutMs);
    if (!response.ok) return null;
    const body = (await response.json()) as {
      code?: string;
      durations?: number[][];
      distances?: number[][];
    };
    if (body.code !== 'Ok' || !body.durations || !body.distances) return null;
    return { durationsSeconds: body.durations, distancesMeters: body.distances };
  } catch (error) {
    logger.warn({ err: error }, 'Travel matrix unavailable; falling back to distance ordering.');
    return null;
  }
}

export function googleMapsDirectionsUrl(from: LatLng, to: LatLng, mode: TransportMode): string {
  const travelmode = mode === 'walking' ? 'walking' : 'driving';
  const params = new URLSearchParams({
    api: '1',
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    travelmode,
  });
  // Official documented Maps URLs format — navigation is performed by Google Maps,
  // not by ECHOES.
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function googleMapsWaypointUrl(points: LatLng[], mode: TransportMode): string {
  const travelmode = mode === 'walking' ? 'walking' : 'driving';
  const encoded = points.map((p) => `${p.lat},${p.lng}`);
  if (encoded.length < 2) return `https://www.google.com/maps/search/?api=1&query=${encoded[0] ?? ''}`;
  const params = new URLSearchParams({
    api: '1',
    origin: encoded[0]!,
    destination: encoded[encoded.length - 1]!,
    travelmode,
  });
  if (encoded.length > 2) {
    params.set('waypoints', encoded.slice(1, -1).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export { formatDistance, formatDuration };
