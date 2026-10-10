import type { Place } from '../domain/types';
import { distanceKm } from '../lib/geo';

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|of|and|lagos|nigeria|national|state|museum|gallery|centre|center|park|house|square|palace|market)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(name: string): Set<string> {
  return new Set(normalize(name).split(' ').filter((token) => token.length > 2));
}

export function nameSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

export interface DuplicateCandidate {
  a: { id: string; name: string };
  b: { id: string; name: string };
  nameSimilarity: number;
  distanceKm: number | null;
  /** Always true: duplicate handling is a review decision, never automatic. */
  requiresHumanReview: true;
  reason: string;
}

/**
 * Flags probable duplicates for a human to review. It never merges, links or
 * deletes records — two different places can share a name fragment, and two
 * records for the same place can be described very differently.
 */
export function findPotentialDuplicates(places: Place[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const a = places[i]!;
      const b = places[j]!;
      const similarity = nameSimilarity(a.name, b.name);
      const distance = distanceKm(a.coordinates, b.coordinates);
      const nameClash = similarity >= 0.7;
      const coordinateClash = distance <= 0.25 && a.category === b.category;
      if (!nameClash && !coordinateClash) continue;

      candidates.push({
        a: { id: a.id, name: a.name },
        b: { id: b.id, name: b.name },
        nameSimilarity: Number(similarity.toFixed(2)),
        distanceKm: Number(distance.toFixed(3)),
        requiresHumanReview: true,
        reason: nameClash
          ? 'Names share significant wording. Confirm before treating them as the same place.'
          : 'Two records of the same category are within 250 m of each other.',
      });
    }
  }
  return candidates.sort((x, y) => y.nameSimilarity - x.nameSimilarity);
}
