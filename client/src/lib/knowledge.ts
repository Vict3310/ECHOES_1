import type { CoverageStatus } from './types';

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  available: 'Available',
  incomplete: 'Incomplete',
  missing: 'Not found in checked sources',
  conflicting: 'Sources conflict',
  awaiting_review: 'Awaiting review',
};

/** Short label used inside dense map legends and chips. */
export const COVERAGE_SHORT: Record<CoverageStatus, string> = {
  available: 'Covered',
  incomplete: 'Partial',
  missing: 'Not found',
  conflicting: 'Conflict',
  awaiting_review: 'In review',
};

export const COVERAGE_TONE: Record<CoverageStatus, string> = {
  available: 'bg-brand-deep/10 text-brand-deep border-brand-deep/20',
  incomplete: 'bg-[#C8973F]/15 text-[#8A6520] border-[#C8973F]/30',
  missing: 'bg-[#B4762A]/15 text-[#8A5518] border-[#B4762A]/30',
  conflicting: 'bg-[#B4432A]/15 text-[#8E3320] border-[#B4432A]/30',
  awaiting_review: 'bg-black/[0.06] text-black/60 border-black/15',
};

export const SEVERITY_TONE = {
  high: 'bg-[#B4432A]/15 text-[#8E3320] border-[#B4432A]/30',
  medium: 'bg-[#C8973F]/15 text-[#8A6520] border-[#C8973F]/30',
  low: 'bg-black/[0.06] text-black/60 border-black/15',
} as const;

export const FRAMING_NOTE =
  'These classifications describe the sources that were checked. They are not evidence that a place lacks history, or that its community does not hold knowledge about it.';
