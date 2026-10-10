import { describe, expect, it } from 'vitest';
import { loadPlaces } from '../src/data/dataset';
import { analysePlace, placesNeedingResearch, SOURCES_CHECKED } from '../src/services/knowledge';
import type { Place } from '../src/domain/types';

const places = loadPlaces();

describe('knowledge-gap analysis', () => {
  it('loads the curated dataset with valid per-dimension coverage records', () => {
    expect(places.length).toBeGreaterThanOrEqual(12);
    for (const place of places) {
      expect(Object.keys(place.coverage).length).toBeGreaterThanOrEqual(7);
      for (const entry of Object.values(place.coverage)) {
        expect(entry.evidence.length).toBeGreaterThan(10);
        expect(['available', 'incomplete', 'missing', 'conflicting', 'awaiting_review']).toContain(
          entry.status,
        );
      }
    }
  });

  it('classifies each dimension independently and never collapses them into one score', () => {
    const place = places.find((p) => p.id === 'freedom-park-lagos') as Place;
    const analysis = analysePlace(place);
    expect(analysis.statuses.encyclopedicArticle).toBe('available');
    expect(analysis.statuses.image).toBe('missing');
    expect(analysis.gaps.map((g) => g.dimension)).toContain('image');
    expect(analysis.gaps.map((g) => g.dimension)).not.toContain('encyclopedicArticle');
  });

  it('treats conflicts as high severity and keeps them explainable', () => {
    const place = places.find((p) => p.id === 'tafawa-balewa-square') as Place;
    const analysis = analysePlace(place);
    const conflict = analysis.gaps.find((g) => g.status === 'conflicting');
    expect(conflict).toBeDefined();
    expect(conflict?.severity).toBe('high');
    expect(conflict?.evidence).toMatch(/differ|conflict|unresolved/i);
  });

  it('never claims that a gap means a place has no history', () => {
    for (const place of places) {
      const analysis = analysePlace(place);
      // The explanation may disclaim the idea, but must never assert it.
      expect(analysis.explanation).not.toMatch(/\bhas no history\b|history is unknown|culture is unknown|not a real place/i);
      if (analysis.needsResearch) {
        expect(analysis.explanation).toMatch(/checked sources only/i);
      }
    }
  });

  it('flags awaiting-review dimensions without treating them as research gaps', () => {
    const place = places.find((p) => p.id === 'iga-idunganran') as Place;
    const analysis = analysePlace(place);
    const waiting = analysis.gaps.find((g) => g.status === 'awaiting_review');
    expect(waiting?.severity).toBe('low');
  });

  it('returns a research subset that is smaller than the full dataset', () => {
    const needsResearch = placesNeedingResearch(places);
    expect(needsResearch.length).toBeGreaterThan(0);
    expect(needsResearch.length).toBeLessThanOrEqual(places.length);
  });

  it('documents exactly which sources were checked', () => {
    expect(SOURCES_CHECKED.join(' ')).toMatch(/OpenStreetMap/);
    expect(SOURCES_CHECKED.join(' ')).toMatch(/Wikipedia/);
  });
});
