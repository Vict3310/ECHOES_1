import { describe, expect, it, vi } from 'vitest';
import {
  buildSourceCheckUrl,
  checkSource,
  parseWikimediaTarget,
  runIngestion,
} from '../src/services/ingestion';
import type { Place } from '../src/domain/types';

const noSleep = async (): Promise<void> => undefined;

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

/** A page that exists, with coordinates. */
const existingArticle = {
  query: {
    pages: { '12345': { pageid: 12345, title: 'Jeakel House', coordinates: [{ lat: 6.45, lon: 3.39 }] } },
  },
};

/** The action API answers HTTP 200 for a page that does not exist. */
const missingArticle = {
  query: { pages: { '-1': { title: 'Kalakuta Museum', missing: '' } } },
};

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: 'jeakel-house',
    name: 'Jaekel House',
    category: 'heritage-site',
    neighbourhood: 'Ebute Metta',
    address: 'Railway Compound, Ebute Metta',
    coordinates: { lat: 6.45, lng: 3.39 },
    coordinateAccuracy: 'approximate',
    summary: 'A colonial-era railway residence.',
    history: 'Built in 1898.',
    tags: [],
    sources: [
      {
        title: 'Jeakel House — Wikipedia',
        publisher: 'Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Jeakel_House',
        license: 'CC BY-SA 4.0',
      },
      {
        title: 'Jeakel House — OpenStreetMap',
        publisher: 'OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/way/12345',
        license: 'ODbL 1.0',
      },
    ],
    coverage: {
      coordinates: { status: 'available', evidence: 'e' },
      encyclopedicArticle: { status: 'available', evidence: 'e' },
      structuredFacts: { status: 'available', evidence: 'e' },
      image: { status: 'missing', evidence: 'e' },
      citations: { status: 'available', evidence: 'e' },
      communityStory: { status: 'missing', evidence: 'e' },
      verifiedExperience: { status: 'missing', evidence: 'e' },
    },
    ...overrides,
  } as Place;
}

describe('wikimedia target parsing', () => {
  it('recognises articles, redirect-safe titles and entities', () => {
    expect(parseWikimediaTarget('https://en.wikipedia.org/wiki/Freedom_Park,_Lagos')).toMatchObject({
      kind: 'wikipedia',
      identifier: 'Freedom_Park,_Lagos',
    });
    expect(parseWikimediaTarget('https://www.wikidata.org/wiki/Q1234')).toMatchObject({
      kind: 'wikidata',
      identifier: 'Q1234',
    });
  });

  it('ignores anything that is not a Wikimedia endpoint', () => {
    expect(parseWikimediaTarget('https://www.openstreetmap.org/way/12345')).toBeNull();
    expect(parseWikimediaTarget('https://example.org/wiki/Thing')).toBeNull();
    expect(parseWikimediaTarget('not a url')).toBeNull();
  });

  it('asks for redirects so a renamed article still counts', () => {
    const target = parseWikimediaTarget('https://en.wikipedia.org/wiki/Jeakel_House')!;
    const url = new URL(buildSourceCheckUrl(target));
    expect(url.searchParams.get('redirects')).toBe('1');
    expect(url.searchParams.get('titles')).toBe('Jeakel_House');
    expect(url.searchParams.get('prop')).toBe('coordinates');
  });
});

describe('citation checking', () => {
  it('marks a citation resolved and returns the article coordinates', async () => {
    const fetchImpl = vi.fn(async () => response(200, existingArticle));
    const result = await checkSource('jeakel-house', 'https://en.wikipedia.org/wiki/Jeakel_House', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.status).toBe('resolved');
    expect(result.articleCoordinates).toEqual({ lat: 6.45, lng: 3.39 });
    expect(result.checkedAt).toBeTruthy();
  });

  it('detects a page that does not exist even though the API answers 200', async () => {
    const fetchImpl = vi.fn(async () => response(200, missingArticle));
    const result = await checkSource('kalakuta-museum', 'https://en.wikipedia.org/wiki/Kalakuta_Museum', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.status).toBe('missing');
    expect(result.reason).toMatch(/does not exist/i);
  });

  it('reports a transport failure as an error rather than as a missing source', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ETIMEDOUT');
    });
    const result = await checkSource('jeakel-house', 'https://en.wikipedia.org/wiki/Jeakel_House', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      attempts: 2,
      backoffMs: 0,
    });

    expect(result.status).toBe('error');
    expect(result.reason).toMatch(/ETIMEDOUT/);
    // Retried before giving up.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries throttling and server faults, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429, {}))
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, existingArticle));

    const result = await checkSource('jeakel-house', 'https://en.wikipedia.org/wiki/Jeakel_House', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      attempts: 3,
      backoffMs: 0,
    });

    expect(result.status).toBe('resolved');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('treats an unreadable payload as an error, not as a missing source', async () => {
    const fetchImpl = vi.fn(async () => response(200, { unexpected: true }));
    const result = await checkSource('jeakel-house', 'https://en.wikipedia.org/wiki/Jeakel_House', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.status).toBe('error');
    expect(result.reason).toMatch(/query\.pages/i);
  });

  it('sends the configured descriptive User-Agent', async () => {
    const fetchImpl = vi.fn(async () => response(200, existingArticle));
    await checkSource('jeakel-house', 'https://en.wikipedia.org/wiki/Jeakel_House', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    const options = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((options?.headers as Record<string, string>)['user-agent']).toMatch(/ECHOES/);
  });
});

describe('the ingestion run', () => {
  it('skips third-party links without querying them', async () => {
    const fetchImpl = vi.fn(async () => response(200, existingArticle));
    const { report } = await runIngestion([place()], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      delayMs: 0,
    });

    expect(report.totals.resolved).toBe(1);
    expect(report.totals.skipped).toBe(1);
    // Only the Wikipedia citation was requested.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('leaves citations untouched unless --write is passed', async () => {
    const original = place();
    const fetchImpl = vi.fn(async () => response(200, existingArticle));
    const { places } = await runIngestion([original], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      delayMs: 0,
    });

    expect(places[0]!.sources[0]).not.toHaveProperty('found');
    expect(places[0]!.sources[0]).not.toHaveProperty('checkedAt');
  });

  it('records the verdict and timestamp when writing', async () => {
    const fetchImpl = vi.fn(async () => response(200, existingArticle));
    const { places } = await runIngestion([place()], {
      write: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      delayMs: 0,
    });

    const [wikipedia, osm] = places[0]!.sources;
    expect(wikipedia!.found).toBe(true);
    expect(wikipedia!.checkedAt).toBeTruthy();
    // A skipped citation keeps its original shape.
    expect(osm).not.toHaveProperty('found');
    expect(osm).not.toHaveProperty('checkedAt');
  });

  it('never marks an unchecked citation as missing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const { report, places } = await runIngestion([place()], {
      write: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      delayMs: 0,
      attempts: 1,
      backoffMs: 0,
    });

    expect(report.totals.error).toBe(1);
    expect(report.incomplete).toBe(true);
    // The distinction that matters: unchecked is not false.
    expect(places[0]!.sources[0]!.found).toBeUndefined();
    expect(places[0]!.sources[0]!.checkedAt).toBeUndefined();
  });

  it('flags coordinate drift between a record and its article', async () => {
    const fetchImpl = vi.fn(async () => response(200, existingArticle));
    const { report } = await runIngestion([place({ coordinates: { lat: 6.6, lng: 3.6 } })], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      delayMs: 0,
    });

    expect(report.coordinateWarnings).toBe(1);
    expect(report.results[0]!.coordinateDriftKm).toBeGreaterThan(1);
  });

  it('does not abort the run when one record fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, existingArticle))
      .mockRejectedValueOnce(new Error('boom'));

    const { report } = await runIngestion([place({ id: 'a' }), place({ id: 'b' })], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      delayMs: 0,
      attempts: 1,
      backoffMs: 0,
    });

    expect(report.totals.resolved).toBe(1);
    expect(report.totals.error).toBe(1);
    // Both records were processed — each contributes one Wikimedia check and one
    // skipped third-party link — so the second record was reached after the first
    // one failed.
    expect(report.results.map((result) => `${result.placeId}:${result.status}`)).toEqual([
      'a:resolved',
      'a:skipped',
      'b:error',
      'b:skipped',
    ]);
  });
});
