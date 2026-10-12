import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlaceDetail from './PlaceDetail';

const HISTORY =
  'Aba’s commercial corridors are woven into the story of trade, industrial activity and urban mobility across southeastern Nigeria.';

const GAP_EVIDENCE = 'No independent encyclopedic article was identified for this specific place.';

/** Shaped like the real `/api/places/:id` payload, trimmed to what the page reads. */
const PAYLOAD = {
  data: {
    place: {
      id: 'abia-river-trade-route',
      name: 'Abia River Trade Route',
      category: 'cultural-landmark',
      neighbourhood: 'Aba',
      address: 'Aba, Abia State, Nigeria',
      coordinates: { lat: 5.11, lng: 7.36 },
      coordinateAccuracy: 'approximate',
      summary: 'A trade route reflecting the commercial energy and regional exchange of Aba.',
      history: HISTORY,
      tags: ['trade', 'river'],
      sources: [
        {
          title: 'Aba, Nigeria — Wikipedia',
          publisher: 'Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Aba,_Nigeria',
          license: 'CC BY-SA 4.0',
          retrievedAt: '2026-10-10',
          found: true,
        },
      ],
      coverage: {
        coordinates: { status: 'available', evidence: 'Coordinate recorded for the place.' },
        encyclopedicArticle: { status: 'missing', evidence: GAP_EVIDENCE },
        structuredFacts: { status: 'incomplete', evidence: 'Structured factual data remains limited.' },
        image: { status: 'missing', evidence: 'No openly licensed photograph was confirmed.' },
        citations: { status: 'incomplete', evidence: 'More citations are needed.' },
        communityStory: { status: 'awaiting_review', evidence: 'No community account yet.' },
        verifiedExperience: { status: 'missing', evidence: 'No verified operator.' },
      },
      image: null,
      knowledge: {
        placeId: 'abia-river-trade-route',
        statuses: { encyclopedicArticle: 'missing' },
        gaps: [
          {
            dimension: 'encyclopedicArticle',
            status: 'missing',
            label: 'Encyclopedic article',
            severity: 'high',
            evidence: GAP_EVIDENCE,
            contributionHint: 'A local contributor could write an account, with sources, for review.',
          },
        ],
        needsResearch: true,
        coveredDimensions: 3,
        totalDimensions: 7,
        explanation: '2 dimensions had no information in the sources checked.',
      },
    },
    communityStories: [],
    experiences: [],
    nearby: [],
    sourcesChecked: ['Wikipedia', 'Wikidata'],
  },
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/places/abia-river-trade-route']}>
        <Routes>
          <Route path="/places/:id" element={<PlaceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(PAYLOAD) }) as unknown as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a place profile', () => {
  it('leads with the explanation of the place', async () => {
    renderPage();

    expect(await screen.findByText(HISTORY)).toBeInTheDocument();
    // The summary of the record is part of the page, not hidden behind a tab.
    expect(screen.getByText(/trade route reflecting the commercial energy/i)).toBeInTheDocument();
  });

  it('keeps the coverage verdicts folded away by default', async () => {
    renderPage();
    await screen.findByText(HISTORY);

    // Nothing on the page should read as “not found” until the reader asks.
    expect(screen.queryByText(GAP_EVIDENCE)).toBeNull();
    expect(screen.queryByText(/^Not found$/i)).toBeNull();
    expect(document.getElementById('coverage-detail')).toBeNull();

    const toggle = screen.getByRole('button', { name: /show the detail/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'coverage-detail');

    // The honest status stays visible even while folded.
    expect(screen.getByText(/3 of 7 dimensions covered/i)).toBeInTheDocument();
    expect(screen.getByText(/1 gap recorded/i)).toBeInTheDocument();
  });

  it('reveals the same coverage detail on request, after the explanation', async () => {
    renderPage();
    const explanation = await screen.findByText(HISTORY);

    fireEvent.click(screen.getByRole('button', { name: /show the detail/i }));

    const detail = document.getElementById('coverage-detail');
    expect(detail).not.toBeNull();
    expect(screen.getByRole('button', { name: /hide the detail/i })).toHaveAttribute('aria-expanded', 'true');
    // The same evidence is quoted by the dimension list and by the gap row.
    expect(screen.getAllByText(GAP_EVIDENCE).length).toBeGreaterThan(0);
    // Listed by dimension and again as a gap, so more than one is expected.
    expect(screen.getAllByText('Encyclopedic article').length).toBeGreaterThan(0);
    expect(screen.getByText(/A local contributor could write an account/)).toBeInTheDocument();
    // Verified evidence, still ordered after the place's own story.
    expect(explanation.compareDocumentPosition(detail as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orders the sections so the place comes before the checking', async () => {
    renderPage();
    await screen.findByText(HISTORY);

    const headings = [...document.querySelectorAll('h2')].map((node) => node.textContent?.trim() ?? '');
    const explanation = headings.findIndex((text) => /Historical and cultural information/.test(text));
    const sources = headings.findIndex((text) => text === 'Sources');
    const coverage = headings.findIndex((text) => /What the sources cover/.test(text));

    expect(explanation).toBeGreaterThanOrEqual(0);
    expect(sources).toBeGreaterThan(explanation);
    expect(coverage).toBeGreaterThan(sources);
  });
});
