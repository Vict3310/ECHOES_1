import { Link } from 'react-router-dom';
import { ExternalLink, MapPin } from 'lucide-react';
import { categoryLabel, formatDistanceKm } from '../lib/format';
import { FRAMING_NOTE } from '../lib/knowledge';
import type { CoverageDimension, KnowledgeAnalysis, Place, SourceRef } from '../lib/types';
import { StatusPill } from './ui';

const DIMENSION_LABELS: Record<CoverageDimension, string> = {
  coordinates: 'Coordinates',
  encyclopedicArticle: 'Encyclopedic article',
  structuredFacts: 'Structured facts',
  image: 'Openly licensed image',
  citations: 'Supporting citations',
  communityStory: 'Community story',
  verifiedExperience: 'Verified experience',
};

/** Deterministic editorial gradient used when a place has no cleared image. */
export function placeArt(place: Pick<Place, 'id' | 'category'>) {
  const gradients: Record<string, string> = {
    'historical-architecture': 'from-[#1E4D33] via-[#2A6647] to-[#42A85D]/70',
    'heritage-site': 'from-[#12321F] via-[#1E4D33] to-[#8FA97C]',
    'cultural-landmark': 'from-[#2A6647] via-[#42A85D]/80 to-[#E4EFDA]',
    museum: 'from-[#13291C] via-[#2A5B41] to-[#C8973F]/60',
    market: 'from-[#3A2A16] via-[#8A6520] to-[#E4C98A]',
    'public-art': 'from-[#1E4D33] via-[#B4762A]/70 to-[#E4EFDA]',
    'traditional-site': 'from-[#16301F] via-[#3E6B4E] to-[#9CBF8A]',
  };
  return gradients[place.category] ?? 'from-[#1E4D33] to-[#42A85D]/70';
}

export function PlaceCard({
  place,
  active = false,
  onSelect,
}: {
  place: Place;
  active?: boolean;
  onSelect?: (place: Place) => void;
}) {
  const gaps = place.knowledge?.gaps.length ?? 0;

  const content = (
    <>
      <div className={`panel-art aspect-[16/10] bg-gradient-to-br ${placeArt(place)}`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute bottom-0 left-0 flex w-full items-end justify-between gap-3 p-5">
          <div>
            <p className="mb-1 text-[11px] font-medium text-brand">{categoryLabel(place.category)}</p>
            <h3 className="font-display text-lg font-light leading-tight tracking-tighter text-white">
              {place.name}
            </h3>
          </div>
          {gaps > 0 && (
            <span className="shrink-0 rounded-full border border-white/25 px-2.5 py-1 text-[10px] text-white/75">
              {gaps} gap{gaps === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <div className="px-1 pt-4">
        <p className="text-sm leading-relaxed text-black/60">{place.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/45">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {place.neighbourhood}
          </span>
          {typeof place.distanceKm === 'number' && <span>{formatDistanceKm(place.distanceKm)} away</span>}
          <span>{place.sources.length} source{place.sources.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(place)}
        aria-pressed={active}
        className={`group block w-full rounded-2xl text-left transition-transform duration-300 hover:-translate-y-0.5 ${
          active ? 'ring-2 ring-brand-deep ring-offset-2 ring-offset-cream' : ''
        }`}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      to={`/places/${place.id}`}
      className="group block rounded-2xl transition-transform duration-300 hover:-translate-y-0.5"
    >
      {content}
    </Link>
  );
}

export function CoverageGrid({ coverage }: { coverage: Place['coverage'] }) {
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(Object.entries(coverage) as Array<[CoverageDimension, Place['coverage'][CoverageDimension]]>).map(
        ([dimension, entry]) => (
          <div
            key={dimension}
            className="flex items-start justify-between gap-3 rounded-2xl border border-black/10 bg-white/60 px-4 py-3"
          >
            <div>
              <dt className="text-sm text-black/70">{DIMENSION_LABELS[dimension] ?? dimension}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-black/45">{entry.evidence}</dd>
            </div>
            <StatusPill status={entry.status} short />
          </div>
        ),
      )}
    </dl>
  );
}

export function KnowledgeSummary({ analysis }: { analysis: KnowledgeAnalysis }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-sm tracking-tight">
          {analysis.coveredDimensions} of {analysis.totalDimensions} dimensions covered by the sources checked
        </p>
        <StatusPill status={analysis.needsResearch ? 'incomplete' : 'available'} short />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-black/60">{analysis.explanation}</p>
      <p className="mt-3 text-xs leading-relaxed text-black/40">{FRAMING_NOTE}</p>
    </div>
  );
}

export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-black/50">No source links are recorded for this place yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {sources.map((source) => (
        <li key={source.url} className="rounded-2xl border border-black/10 bg-white/60 px-4 py-3">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            className="group flex items-start justify-between gap-3"
          >
            <span>
              <span className="block text-sm text-ink group-hover:text-brand-deep">{source.title}</span>
              <span className="mt-0.5 block text-xs text-black/45">
                {source.publisher}
                {source.license ? ` · ${source.license}` : ''}
                {source.retrievedAt ? ` · retrieved ${source.retrievedAt}` : ''}
              </span>
            </span>
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-black/30" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function CoverageLegend() {
  const statuses = ['available', 'incomplete', 'missing', 'conflicting', 'awaiting_review'] as const;
  const descriptions: Record<(typeof statuses)[number], string> = {
    available: 'Information was found in the checked sources.',
    incomplete: 'Information exists but does not cover the place evenly.',
    missing: 'No information was found in the sources that were checked.',
    conflicting: 'Checked sources disagree; the conflict is recorded, not resolved.',
    awaiting_review: 'A contribution or correction is queued for moderation.',
  };
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {statuses.map((status) => (
        <li key={status} className="flex items-start gap-3 rounded-2xl border border-black/10 bg-white/50 px-4 py-3">
          <StatusPill status={status} short />
          <span className="text-xs leading-relaxed text-black/55">{descriptions[status]}</span>
        </li>
      ))}
    </ul>
  );
}
