import { describe, expect, it } from 'vitest';
import type { Place } from '../src/domain/types';
import { loadPlaces } from '../src/data/dataset';
import { findPotentialDuplicates, nameSimilarity } from '../src/services/quality';

function place(overrides: Partial<Place>): Place {
  const base = loadPlaces()[0]!;
  return { ...base, coordinates: { lat: 6.4, lng: 3.4 }, ...overrides };
}

describe('duplicate handling', () => {
  it('scores name similarity conservatively', () => {
    expect(nameSimilarity('Freedom Park Lagos', 'Freedom Park')).toBeCloseTo(1, 5);
    expect(nameSimilarity('Freedom Park Lagos', 'Nike Art Gallery')).toBe(0);
  });

  it('flags similar names for human review instead of merging', () => {
    const candidates = findPotentialDuplicates([
      place({ id: 'a', name: 'Freedom Park Lagos', coordinates: { lat: 6.45, lng: 3.39 } }),
      place({ id: 'b', name: 'Freedom Park', coordinates: { lat: 6.47, lng: 3.36 } }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.requiresHumanReview).toBe(true);
    expect(candidates[0]?.reason).toMatch(/Confirm before/i);
  });

  it('flags nearby same-category records even when names differ', () => {
    const candidates = findPotentialDuplicates([
      place({ id: 'a', name: 'Alpha Gallery', category: 'museum', coordinates: { lat: 6.4, lng: 3.4 } }),
      place({ id: 'b', name: 'Beta Museum', category: 'museum', coordinates: { lat: 6.4005, lng: 3.4005 } }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.reason).toMatch(/within 250 m/i);
  });

  it('does not flag unrelated records', () => {
    const candidates = findPotentialDuplicates([
      place({ id: 'a', name: 'Nike Art Gallery', category: 'public-art', coordinates: { lat: 6.43, lng: 3.46 } }),
      place({ id: 'b', name: 'Makoko', category: 'traditional-site', coordinates: { lat: 6.49, lng: 3.38 } }),
    ]);
    expect(candidates).toHaveLength(0);
  });

  it('finds no duplicates in the curated dataset itself', () => {
    expect(findPotentialDuplicates(loadPlaces())).toHaveLength(0);
  });
});
