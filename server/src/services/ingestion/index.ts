/**
 * Cultural data ingestion.
 *
 * The dataset's claim is that every record points at a real, citable source. That
 * claim decays: articles get renamed, merged or deleted. This pipeline is the
 * refreshing half — it walks each record's citations, asks the upstream API
 * whether they still resolve, and records the answer with a timestamp.
 *
 * Design rules, all of which exist because the opposite behaviour would quietly
 * corrupt the dataset:
 *
 *   - A citation is only marked resolved or missing when the provider actually
 *     answered. A timeout or a 503 leaves it unchecked and is reported as an
 *     error — never as "this source does not exist".
 *   - Only Wikimedia endpoints are queried. OpenStreetMap and other third-party
 *     links are skipped rather than hammered.
 *   - Requests are sequential, paced by a delay, carry the configured descriptive
 *     User-Agent, and retry with backoff on throttling and server faults.
 *   - A failure on one record does not abort the run; it is reported per record.
 *   - Coordinate drift between a record and its article is reported for a human to
 *     look at. Nothing is merged, rewritten or deleted automatically.
 */
import { env } from '../../env';
import { distanceKm, isValidCoordinate, type LatLng } from '../../lib/geo';
import { findPotentialDuplicates, type DuplicateCandidate } from '../quality';
import type { Place } from '../../domain/types';

export type SourceStatus = 'resolved' | 'missing' | 'skipped' | 'error';

export interface SourceCheckResult {
  placeId: string;
  url: string;
  status: SourceStatus;
  checkedAt: string;
  httpStatus?: number;
  reason?: string;
  /** Coordinates published by the cited article, when it provides them. */
  articleCoordinates?: LatLng;
  /** Distance between the record and the article, when both are known. */
  coordinateDriftKm?: number;
}

export interface IngestionReport {
  startedAt: string;
  finishedAt: string;
  placesConsidered: number;
  sourcesConsidered: number;
  totals: Record<SourceStatus, number>;
  coordinateWarnings: number;
  /** Duplicate candidates flagged for human review — never merged. */
  duplicateCandidates: DuplicateCandidate[];
  /** True when any check failed for a transport reason, so the run was partial. */
  incomplete: boolean;
  results: SourceCheckResult[];
}

export interface IngestionOptions {
  /** Delay between upstream requests, in milliseconds. */
  delayMs?: number;
  /** Attempts per request, including the first. */
  attempts?: number;
  /** Base backoff, doubled per retry. Kept small so tests stay fast. */
  backoffMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

interface WikimediaTarget {
  kind: 'wikipedia' | 'wikidata';
  /** Article title (wikipedia) or entity id (wikidata). */
  identifier: string;
  apiUrl: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Only Wikimedia hosts are queried. Anything else — OpenStreetMap, a museum site —
 * is reported as skipped, because a general "check any URL" pass would mean
 * hammering third parties that never agreed to it.
 */
export function parseWikimediaTarget(url: string): WikimediaTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const match = /^\/wiki\/(.+)$/.exec(parsed.pathname);
  if (!match) return null;

  const identifier = decodeURIComponent(match[1]!);

  if (host === 'wikidata.org' || host === 'www.wikidata.org') {
    if (!/^Q\d+$/.test(identifier)) return null;
    return { kind: 'wikidata', identifier, apiUrl: env.culturalData.wikidataApiUrl };
  }

  // en.wikipedia.org, en.m.wikipedia.org and the language subdomains.
  if (/(^|\.)wikipedia\.org$/.test(host)) {
    return { kind: 'wikipedia', identifier, apiUrl: env.culturalData.wikipediaApiUrl };
  }

  return null;
}

export function buildSourceCheckUrl(target: WikimediaTarget): string {
  const api = new URL(target.apiUrl);
  api.searchParams.set('action', 'query');
  api.searchParams.set('format', 'json');
  // Follow redirects: a renamed article is still the cited article.
  api.searchParams.set('redirects', '1');

  if (target.kind === 'wikidata') {
    api.searchParams.set('prop', 'claims');
    api.searchParams.set('ids', target.identifier);
  } else {
    api.searchParams.set('prop', 'coordinates');
    api.searchParams.set('titles', target.identifier);
  }

  return api.toString();
}

interface FetchOutcome {
  ok: boolean;
  httpStatus?: number;
  body?: unknown;
  error?: string;
}

/** One request, with timeout, retries and backoff. Never throws. */
async function requestJson(
  url: string,
  options: Required<Pick<IngestionOptions, 'attempts' | 'backoffMs' | 'timeoutMs'>> &
    Pick<IngestionOptions, 'sleep' | 'fetchImpl'>,
): Promise<FetchOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  let lastError = 'Request failed.';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await doFetch(url, {
        headers: {
          accept: 'application/json',
          // Wikimedia asks for a descriptive User-Agent carrying contact details.
          'user-agent': env.culturalData.userAgent,
        },
        signal: controller.signal,
      });

      lastStatus = response.status;

      // Throttling and server faults deserve another attempt; a 404 is an answer.
      if (response.status === 429 || response.status >= 500) {
        lastError = `Upstream responded with HTTP ${response.status}.`;
        if (attempt < options.attempts) {
          await sleep(options.backoffMs * 2 ** (attempt - 1));
          continue;
        }
        return { ok: false, httpStatus: response.status, error: lastError };
      }

      const body = (await response.json().catch(() => null)) as unknown;
      return { ok: true, httpStatus: response.status, body };
    } catch (error) {
      // Transport failure: retried, then reported as an error rather than an answer.
      lastError = error instanceof Error ? error.message : 'Unknown transport failure.';
    } finally {
      clearTimeout(timer);
    }

    if (attempt < options.attempts) await sleep(options.backoffMs * 2 ** (attempt - 1));
  }

  return { ok: false, httpStatus: lastStatus, error: lastError };
}

interface ArticleAnswer {
  exists: boolean;
  coordinates?: LatLng;
  /** Set when the provider answered but the payload could not be read. */
  malformed?: string;
}

function readWikipediaAnswer(body: unknown): ArticleAnswer {
  const pages = (body as { query?: { pages?: Record<string, unknown> } } | null)?.query?.pages;
  if (!pages || typeof pages !== 'object') {
    return { exists: false, malformed: 'Response contained no query.pages.' };
  }

  const page = Object.values(pages)[0] as
    | { missing?: unknown; coordinates?: Array<{ lat?: number; lon?: number }> }
    | undefined;
  if (!page) return { exists: false, malformed: 'query.pages was empty.' };

  // The action API answers HTTP 200 even for a missing page, so existence has to
  // come from the payload rather than the status code.
  if (typeof page.missing !== 'undefined') return { exists: false };

  const answer: ArticleAnswer = { exists: true };
  const coordinate = page.coordinates?.[0];
  if (coordinate && typeof coordinate.lat === 'number' && typeof coordinate.lon === 'number') {
    const point = { lat: coordinate.lat, lng: coordinate.lon };
    if (isValidCoordinate(point)) answer.coordinates = point;
  }
  return answer;
}

function readWikidataAnswer(body: unknown): ArticleAnswer {
  const entities = (body as { entities?: Record<string, unknown> } | null)?.entities ?? {};
  const entity = Object.values(entities)[0] as
    | { missing?: unknown; claims?: Record<string, unknown> }
    | undefined;

  if (!entity || typeof entity.missing !== 'undefined') return { exists: false };

  // P625 is "coordinate location".
  const claim = (entity.claims?.P625 as Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>)?.[0];
  const value = claim?.mainsnak?.datavalue?.value as { latitude?: number; longitude?: number } | undefined;

  const answer: ArticleAnswer = { exists: true };
  if (value && typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    const point = { lat: value.latitude, lng: value.longitude };
    if (isValidCoordinate(point)) answer.coordinates = point;
  }
  return answer;
}

/** Checks a single citation. Never throws: every outcome is a returned status. */
export async function checkSource(
  placeId: string,
  url: string,
  options: IngestionOptions = {},
): Promise<SourceCheckResult> {
  const checkedAt = new Date().toISOString();
  const target = parseWikimediaTarget(url);

  if (!target) {
    return {
      placeId,
      url,
      status: 'skipped',
      checkedAt,
      reason: 'Not a Wikimedia endpoint — not queried.',
    };
  }

  const outcome = await requestJson(buildSourceCheckUrl(target), {
    attempts: options.attempts ?? 3,
    backoffMs: options.backoffMs ?? 400,
    timeoutMs: options.timeoutMs ?? 10_000,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  if (!outcome.ok) {
    return {
      placeId,
      url,
      status: 'error',
      checkedAt,
      ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
      reason: outcome.error ?? 'Upstream did not answer.',
    };
  }

  const answer =
    target.kind === 'wikidata' ? readWikidataAnswer(outcome.body) : readWikipediaAnswer(outcome.body);

  if (answer.malformed) {
    return {
      placeId,
      url,
      status: 'error',
      checkedAt,
      ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
      reason: answer.malformed,
    };
  }

  if (!answer.exists) {
    return {
      placeId,
      url,
      status: 'missing',
      checkedAt,
      ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
      reason: 'The provider answered, and the cited page does not exist.',
    };
  }

  return {
    placeId,
    url,
    status: 'resolved',
    checkedAt,
    ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
    ...(answer.coordinates ? { articleCoordinates: answer.coordinates } : {}),
  };
}

/**
 * Runs the pipeline over the supplied records. With `write`, the verdict is
 * recorded on each citation (`found` plus `checkedAt`); without it, nothing is
 * modified and the report alone is returned.
 */
export async function runIngestion(
  places: Place[],
  options: IngestionOptions & { write?: boolean } = {},
): Promise<{ report: IngestionReport; places: Place[] }> {
  const startedAt = new Date().toISOString();
  const sleep = options.sleep ?? defaultSleep;
  const delayMs = options.delayMs ?? 250;
  const results: SourceCheckResult[] = [];
  const updated: Place[] = [];
  let requests = 0;

  for (const place of places) {
    const sources = [...place.sources];

    for (const [index, source] of sources.entries()) {
      // Pace every request after the first.
      if (requests > 0 && delayMs > 0) await sleep(delayMs);
      requests += 1;

      const result = await checkSource(place.id, source.url, options);

      if (result.articleCoordinates) {
        const drift = distanceKm(place.coordinates, result.articleCoordinates);
        // Sub-kilometre agreement is not worth reporting; a record and its article
        // disagreeing by more than that is worth a human look.
        if (drift > 1) result.coordinateDriftKm = Number(drift.toFixed(2));
      }

      results.push(result);

      // Skipped citations are left exactly as they were: not checked is not a verdict.
      if (result.status === 'skipped') continue;

      const next = { ...source };
      if (result.status === 'resolved') next.found = true;
      if (result.status === 'missing') next.found = false;
      // 'error' deliberately leaves `found` untouched.
      if (options.write && result.status !== 'error') next.checkedAt = startedAt;
      sources[index] = next;
    }

    updated.push(options.write ? { ...place, sources } : place);
  }

  const totals: Record<SourceStatus, number> = { resolved: 0, missing: 0, skipped: 0, error: 0 };
  for (const result of results) totals[result.status] += 1;

  return {
    report: {
      startedAt,
      finishedAt: new Date().toISOString(),
      placesConsidered: places.length,
      sourcesConsidered: results.length,
      totals,
      coordinateWarnings: results.filter((result) => result.coordinateDriftKm !== undefined).length,
      // Duplicates are flagged for review and never merged by this pipeline.
      duplicateCandidates: findPotentialDuplicates(places),
      incomplete: totals.error > 0,
      results,
    },
    places: updated,
  };
}
