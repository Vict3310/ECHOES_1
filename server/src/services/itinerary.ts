import type { Place } from '../domain/types';
import { logger } from '../lib/logger';
import { distanceKm, type LatLng } from '../lib/geo';
import { analysePlace } from './knowledge';
import { scorePlace } from './gemma/grounding';
import { ITINERARY_SYSTEM_PROMPT, itineraryUserPrompt } from './gemma/prompts';
import { GemmaUnavailableError, createGemmaProvider, type GemmaProvider } from './gemma/providers';
import { itinerarySchema, parseStructured, validateStopPlaceIds } from './gemma/validate';
import {
  calculateRoute,
  googleMapsWaypointUrl,
  travelMatrix,
  type RouteStep,
  type TransportMode,
} from './routing';

export interface ItineraryPreferences {
  start: LatLng & { label: string };
  interests: string[];
  availableMinutes: number;
  transportMode: TransportMode;
  maxStops: number;
  accessibilityNotes?: string;
  budgetMinor?: number | null;
  currency: string;
}

export interface ItineraryStop {
  placeId: string;
  name: string;
  category: string;
  neighbourhood: string;
  coordinates: LatLng;
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
  transportMode: TransportMode;
  stops: ItineraryStop[];
  legs: ItineraryLeg[];
  totals: {
    visitMinutes: number;
    travelSeconds: number | null;
    totalMinutes: number | null;
    distanceMeters: number | null;
  };
  withinAvailableTime: boolean | null;
  droppedPlaceIds: string[];
  limitations: string[];
  googleMapsUrl: string;
  routingProviderNote: string | null;
  generatedAt: string;
}

function candidatesBlock(places: Place[]): string {
  return [
    'CANDIDATE PLACES (choose only from this list):',
    ...places.map(
      (p) =>
        `- id=${p.id} | ${p.name} | ${p.category} | ${p.neighbourhood} | ${p.coordinates.lat},${p.coordinates.lng}\n  summary: ${p.summary}\n  tags: ${p.tags.join(', ')}`,
    ),
  ].join('\n');
}

function heuristicSelection(
  candidates: Array<{ place: Place; score: number }>,
  start: LatLng,
  transportMode: TransportMode,
  limit: number,
): Place[] {
  const pool = candidates.length > 0 ? candidates.map((c) => c.place) : [];
  const remaining = [...pool];
  const chosen: Place[] = [];
  let cursor: LatLng = start;

  while (chosen.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    remaining.forEach((place, index) => {
      const travel = distanceKm(cursor, place.coordinates);
      const reachable = transportMode === 'walking' ? Math.min(travel, 40) : travel;
      if (reachable < bestCost) {
        bestCost = reachable;
        bestIndex = index;
      }
    });
    const [picked] = remaining.splice(bestIndex, 1);
    if (!picked) break;
    chosen.push(picked);
    cursor = picked.coordinates;
  }
  return chosen;
}

function reasonFor(place: Place): string {
  const analysis = analysePlace(place);
  const gapNote = analysis.needsResearch
    ? ' The records here are incomplete, so ask locally on arrival.'
    : '';
  return `${place.summary}${gapNote}`;
}

export async function planItinerary(
  prefs: ItineraryPreferences,
  places: Place[],
  provider: GemmaProvider = createGemmaProvider(),
): Promise<ItineraryResult> {
  const tokens = [...prefs.interests, ...prefs.start.label.split(/\s+/)];
  const scored = places
    .map((place) => ({ place, score: scorePlace(place, tokens) }))
    .sort((a, b) => b.score - a.score);

  const withMatches = scored.filter((entry) => entry.score > 0);
  const shortlist = (withMatches.length >= 3 ? withMatches : scored).slice(0, 14);
  const candidatePlaces = shortlist.map((entry) => entry.place);
  const candidateIds = candidatePlaces.map((p) => p.id);

  const limitations: string[] = [];
  let mode: 'gemma' | 'heuristic' = 'gemma';
  let chosen: Array<{ placeId: string; reason: string; suggestedVisitMinutes: number }> = [];
  let title = `A ${prefs.transportMode} cultural route in Lagos`;
  let summary = '';
  let modelLabel = `${provider.name}:${provider.model}`;

  try {
    const result = await provider.generate({
      system: ITINERARY_SYSTEM_PROMPT,
      prompt: itineraryUserPrompt(candidatesBlock(candidatePlaces), {
        startLabel: prefs.start.label,
        interests: prefs.interests,
        availableMinutes: prefs.availableMinutes,
        transportMode: prefs.transportMode,
        maxStops: prefs.maxStops,
        accessibilityNotes: prefs.accessibilityNotes,
        budgetMinor: prefs.budgetMinor ?? null,
        currency: prefs.currency,
      }),
      json: true,
      temperature: 0.3,
      maxTokens: 1200,
    });

    const parsed = parseStructured(result.text, itinerarySchema);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    const { valid, dropped } = validateStopPlaceIds(parsed.data.stops, candidateIds);
    if (dropped.length > 0) {
      limitations.push(
        `Rejected ${dropped.length} stop${dropped.length === 1 ? '' : 's'} the model returned that do not exist in the database.`,
      );
    }
    if (valid.length === 0) {
      throw new Error('Model returned no valid stops.');
    }
    chosen = valid.slice(0, prefs.maxStops);
    title = parsed.data.title;
    summary = parsed.data.summary;
    limitations.push(...(parsed.data.limitations ?? []));
    modelLabel = `${result.provider}:${result.model}`;
  } catch (error) {
    const reason =
      error instanceof GemmaUnavailableError
        ? 'Gemma is not available, so this route was assembled from the database by proximity.'
        : `The model output could not be used (${error instanceof Error ? error.message : 'unknown error'}).`;
    logger.warn({ err: error instanceof Error ? error.message : error }, 'Falling back to heuristic itinerary.');
    mode = 'heuristic';
    modelLabel = 'heuristic';
    const picked = heuristicSelection(shortlist, prefs.start, prefs.transportMode, prefs.maxStops);
    chosen = picked.map((place) => ({
      placeId: place.id,
      reason: reasonFor(place),
      suggestedVisitMinutes: place.category === 'museum' ? 60 : 30,
    }));
    summary = `${reason} Stops are ordered by proximity; verify each place's opening arrangements before travelling.`;
    limitations.push(reason);
  }

  const stops: ItineraryStop[] = chosen.map((stop) => {
    const place = candidatePlaces.find((p) => p.id === stop.placeId)!;
    const analysis = analysePlace(place);
    return {
      placeId: place.id,
      name: place.name,
      category: place.category,
      neighbourhood: place.neighbourhood,
      coordinates: place.coordinates,
      reason: stop.reason,
      suggestedVisitMinutes: stop.suggestedVisitMinutes,
      sourceLinks: place.sources.map((s) => ({
        title: s.title,
        publisher: s.publisher,
        url: s.url,
      })),
      openGaps: analysis.gaps.map((gap) => `${gap.label}: ${gap.evidence}`),
    };
  });

  // A visitor who starts at a stop would otherwise produce a zero-length leg and
  // no usable route. Drop those stops and say so, rather than inventing a leg.
  const startPoint: LatLng = { lat: prefs.start.lat, lng: prefs.start.lng };
  const walkable = stops.filter((stop) => distanceKm(startPoint, stop.coordinates) > 0.025);
  if (walkable.length !== stops.length) {
    limitations.push(
      'One or more stops sat at your starting point and were removed, so the route has no zero-length leg.',
    );
    stops.length = 0;
    stops.push(...walkable);
  }

  const visitMinutes = stops.reduce((sum, stop) => sum + stop.suggestedVisitMinutes, 0);

  // --- Real routing ---------------------------------------------------------
  const points: LatLng[] = [
    { lat: prefs.start.lat, lng: prefs.start.lng },
    ...stops.map((stop) => stop.coordinates),
  ];

  let legs: ItineraryLeg[] = [];
  let travelSeconds: number | null = null;
  let distanceMeters: number | null = null;
  let routingProviderNote: string | null = null;
  let withinAvailableTime: boolean | null = null;

  try {
    const matrix = await travelMatrix(points, prefs.transportMode);
    if (matrix) {
      // Order the stops with real travel durations (nearest neighbour on the matrix).
      const order = orderByDurations(matrix.durationsSeconds, stops.length, prefs.transportMode);
      if (order.some((value, index) => value !== index)) {
        const reordered = order.map((index) => stops[index]!);
        stops.length = 0;
        stops.push(...reordered);
        limitations.push('Stops were reordered to reduce total travel time using provider travel durations.');
      }
    }

    // Recompute every leg individually so the map gets real geometry.
    const orderedPoints: LatLng[] = [
      { lat: prefs.start.lat, lng: prefs.start.lng },
      ...stops.map((stop) => stop.coordinates),
    ];
    for (let i = 0; i < orderedPoints.length - 1; i += 1) {
      const from = orderedPoints[i]!;
      const to = orderedPoints[i + 1]!;
      if (distanceKm(from, to) <= 0.005) continue;
      const route = await calculateRoute(from, to, prefs.transportMode);
      legs.push({
        fromPlaceId: i === 0 ? 'start' : stops[i - 1]!.placeId,
        toPlaceId: stops[i]!.placeId,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        steps: route.steps,
        geometry: route.geometry,
      });
      routingProviderNote = route.providerNote;
    }

    travelSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
    distanceMeters = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0);

    const totalMinutes = visitMinutes + travelSeconds / 60;
    withinAvailableTime = totalMinutes <= prefs.availableMinutes;
    if (!withinAvailableTime) {
      limitations.push(
        `The route needs about ${Math.round(totalMinutes)} minutes including travel and suggested visit time, which exceeds the ${prefs.availableMinutes} minutes requested. Remove a stop or allow more time.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Routing provider error.';
    limitations.push(
      `Route distances and travel times could not be calculated from the routing provider (${message}). No travel estimate is shown.`,
    );
    travelSeconds = null;
    distanceMeters = null;
    withinAvailableTime = null;
  }

  const allPoints: LatLng[] = [prefs.start, ...stops.map((stop) => stop.coordinates)];
  const googleMapsUrl = googleMapsWaypointUrl(allPoints, prefs.transportMode);

  return {
    title,
    summary,
    mode,
    provider: provider.name,
    model: modelLabel,
    transportMode: prefs.transportMode,
    stops,
    legs,
    totals: {
      visitMinutes,
      travelSeconds,
      totalMinutes: travelSeconds === null ? null : visitMinutes + travelSeconds / 60,
      distanceMeters,
    },
    withinAvailableTime,
    droppedPlaceIds: [],
    limitations,
    googleMapsUrl,
    routingProviderNote,
    generatedAt: new Date().toISOString(),
  };
}

/** Nearest-neighbour ordering over a provider travel-duration matrix. */
export function orderByDurations(
  durations: number[][],
  stopCount: number,
  transportMode: TransportMode,
): number[] {
  const visited = new Set<number>();
  const order: number[] = [];
  let current = 0; // index 0 is the start point

  const maxLegSeconds = transportMode === 'walking' ? 3600 : null;

  while (order.length < stopCount) {
    let best = -1;
    let bestValue = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= stopCount; i += 1) {
      if (visited.has(i)) continue;
      const value = durations[current]?.[i];
      if (typeof value !== 'number') continue;
      if (maxLegSeconds !== null && value > maxLegSeconds && order.length > 0) continue;
      if (value < bestValue) {
        bestValue = value;
        best = i;
      }
    }
    if (best === -1) {
      // Fall back to any unvisited stop rather than dropping it.
      for (let i = 1; i <= stopCount; i += 1) {
        if (!visited.has(i)) {
          best = i;
          break;
        }
      }
    }
    if (best === -1) break;
    visited.add(best);
    order.push(best - 1);
    current = best;
  }
  return order;
}
