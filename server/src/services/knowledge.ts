import type { CoverageDimension, CoverageEntry, CoverageStatus, Place } from '../domain/types';

export const DIMENSION_LABELS: Record<CoverageDimension, string> = {
  coordinates: 'Coordinates',
  encyclopedicArticle: 'Encyclopedic article',
  structuredFacts: 'Structured facts',
  image: 'Openly licensed image',
  citations: 'Supporting citations',
  communityStory: 'Community story',
  verifiedExperience: 'Verified experience',
};

/** The sources ECHOES actually checked when this record was curated. */
export const SOURCES_CHECKED = [
  'OpenStreetMap (Open Database License)',
  'English Wikipedia (CC BY-SA)',
  'Wikidata structured statements (CC0)',
];

const SEVERITY: Record<CoverageStatus, 'low' | 'medium' | 'high'> = {
  available: 'low',
  incomplete: 'medium',
  conflicting: 'high',
  missing: 'high',
  awaiting_review: 'low',
};

const CONTRIBUTION_HINTS: Record<CoverageDimension, string> = {
  coordinates: 'Confirm the exact entrance or meeting point so visitors are not sent to the wrong side of the site.',
  encyclopedicArticle: 'No article was found in the sources checked. A local contributor with knowledge of the site could write an account, with sources, for review.',
  structuredFacts: 'Dates, ownership and building phases could be recorded as structured facts with a citation for each statement.',
  image: 'A photograph released under an open licence would let visitors see the place before they travel.',
  citations: 'Existing statements need sources. Pointing at a book, archive, newspaper or institutional record would strengthen them.',
  communityStory: 'A first-hand or family account, recorded with consent and an attribution preference, would be valuable here.',
  verifiedExperience: 'A community-owned guided experience, with verified operator details, could be listed for this place.',
};

export interface KnowledgeGap {
  dimension: CoverageDimension;
  status: CoverageStatus;
  label: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string;
  contributionHint: string;
}

export interface KnowledgeAnalysis {
  placeId: string;
  statuses: Record<CoverageDimension, CoverageStatus>;
  gaps: KnowledgeGap[];
  /** True when at least one checked dimension is incomplete, missing or conflicting. */
  needsResearch: boolean;
  /** Count of dimensions with no gap, used for display only — never a single "truth score". */
  coveredDimensions: number;
  totalDimensions: number;
  /** Plain-language explanation suitable for showing to a user. */
  explanation: string;
}

export function analysePlace(place: Place): KnowledgeAnalysis {
  const gaps: KnowledgeGap[] = [];
  const statuses = {} as Record<CoverageDimension, CoverageStatus>;

  for (const [dimension, entry] of Object.entries(place.coverage) as [
    CoverageDimension,
    CoverageEntry,
  ][]) {
    statuses[dimension] = entry.status;
    if (entry.status === 'available') continue;
    gaps.push({
      dimension,
      status: entry.status,
      label: DIMENSION_LABELS[dimension] ?? dimension,
      severity: SEVERITY[entry.status],
      evidence: entry.evidence,
      contributionHint: CONTRIBUTION_HINTS[dimension] ?? '',
    });
  }

  const ordered = gaps.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return rank[a.severity] - rank[b.severity];
  });

  const needsResearch = ordered.some((gap) => gap.severity !== 'low');
  const totalDimensions = Object.keys(statuses).length;
  const coveredDimensions = totalDimensions - ordered.length;

  const missingCount = ordered.filter((g) => g.status === 'missing').length;
  const conflictingCount = ordered.filter((g) => g.status === 'conflicting').length;
  const awaitingCount = ordered.filter((g) => g.status === 'awaiting_review').length;

  const parts: string[] = [];
  if (missingCount > 0) {
    parts.push(
      `${missingCount} dimension${missingCount === 1 ? '' : 's'} had no information in the sources checked`,
    );
  }
  if (conflictingCount > 0) parts.push(`${conflictingCount} conflict in the checked sources`);
  if (awaitingCount > 0) parts.push(`${awaitingCount} item awaiting moderation`);

  const explanation =
    parts.length === 0
      ? 'The checked sources cover this place across all recorded dimensions.'
      : `${parts.join(', ')}. This describes the checked sources only — it is not evidence that the place lacks history or that its community does not hold knowledge about it.`;

  return {
    placeId: place.id,
    statuses,
    gaps: ordered,
    needsResearch,
    coveredDimensions,
    totalDimensions,
    explanation,
  };
}

export function placesNeedingResearch(places: Place[]): Place[] {
  return places.filter((place) => analysePlace(place).needsResearch);
}
