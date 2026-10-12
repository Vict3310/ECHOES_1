import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  MapPin,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { categoryLabel, formatDateTime, formatDistanceKm, formatMoney } from '../lib/format';
import { FRAMING_NOTE } from '../lib/knowledge';
import type { KnowledgeAnalysis, Place, RouteResult } from '../lib/types';
import MapView from '../components/MapView';
import { DirectionsPanel } from '../components/DirectionsPanel';
import { CoverageGrid, ImageCredit, KnowledgeSummary, placeArt, placeImageStyle, SourceList } from '../components/place';
import { Chip, ErrorState, GapRow, Loading, Notice, Skeleton } from '../components/ui';
import { GiantWordmark, Reveal, WordReveal } from '../components/layout';
import { track } from '../lib/tracker';

function NarrationCard({ placeId, placeName }: { placeId: string; placeName: string }) {
  const [script, setScript] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ mode: string; model: string; note: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'speaking' | 'paused' | 'unsupported' | 'error'>(
    'idle',
  );
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  async function prepare() {
    setStatus('loading');
    try {
      const result = await api.narration(placeId);
      setScript(result.script);
      setMeta({ mode: result.mode, model: result.model, note: result.audio.note });
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  function speak() {
    if (!script) return;
    if (!('speechSynthesis' in window)) {
      setStatus('unsupported');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = 0.98;
    utterance.onend = () => setStatus('idle');
    utterance.onerror = () => setStatus('error');
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setStatus('speaking');
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-widest text-black/40">Audio storytelling</p>
        {meta && (
          <span className="rounded-full border border-black/15 px-2.5 py-0.5 text-[11px] text-black/50">
            {meta.mode === 'gemma' ? `script: ${meta.model}` : 'script: stored record'}
          </span>
        )}
      </div>

      {!script && status !== 'loading' && (
        <button type="button" onClick={prepare} className="btn-secondary mt-4">
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Prepare narration for {placeName}
        </button>
      )}

      {status === 'loading' && (
        <div className="mt-4">
          <Loading label="Writing the narration script…" />
        </div>
      )}

      {script && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={speak} className="btn-primary" disabled={status === 'speaking'}>
              <Play className="h-4 w-4" aria-hidden="true" />
              {status === 'paused' ? 'Resume' : 'Play'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={status !== 'speaking'}
              onClick={() => {
                window.speechSynthesis?.pause();
                setStatus('paused');
              }}
            >
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              Pause
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={status === 'speaking'}
              onClick={() => {
                window.speechSynthesis?.resume();
                setStatus('speaking');
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Replay
            </button>
          </div>

          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-black/70">{script}</p>

          <p className="mt-3 text-xs leading-relaxed text-black/45">
            {meta?.note} Generated narration is not a primary historical source, and it keeps the qualifications
            recorded in the ECHOES records.
          </p>
          {(status === 'unsupported' || status === 'error') && (
            <p className="mt-2 text-xs text-[#8E3320]">
              Audio playback is unavailable in this browser. The transcript above is the full narration.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The coverage verdicts, folded away behind one summary line.
 *
 * They belong on the record and stay here, but listed across the page they read
 * as “nothing is known about this place”. What they actually describe is the set
 * of sources that were checked, so they sit behind a disclosure instead of
 * competing with the explanation.
 */
function CoverageDisclosure({
  analysis,
  coverage,
}: {
  analysis: KnowledgeAnalysis;
  coverage: Place['coverage'];
}) {
  const [open, setOpen] = useState(false);
  const gaps = analysis.gaps.length;

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-md">
          <h2 className="font-display text-xl tracking-tight">What the sources cover</h2>
          <p className="mt-1 text-sm leading-relaxed text-black/55">
            {analysis.coveredDimensions} of {analysis.totalDimensions} dimensions covered by the sources checked
            {gaps > 0 ? ` · ${gaps} gap${gaps === 1 ? '' : 's'} recorded` : ''}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="coverage-detail"
          className="btn-secondary shrink-0"
        >
          {open ? 'Hide the detail' : 'Show the detail'}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {open && (
        <div id="coverage-detail" className="mt-6 space-y-6">
          <KnowledgeSummary analysis={analysis} />
          <CoverageGrid coverage={coverage} />

          {gaps > 0 && (
            <div>
              <h3 className="font-display text-base tracking-tight">What the checked sources are missing</h3>
              <p className="mb-4 mt-1 text-sm text-black/50">{FRAMING_NOTE}</p>
              <ul className="space-y-3">
                {analysis.gaps.map((gap) => (
                  <GapRow key={gap.dimension} gap={gap} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function PlaceDetail() {
  const { id = '' } = useParams();
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [showDirections, setShowDirections] = useState(false);

  const query = useQuery({
    queryKey: ['place', id],
    queryFn: () => api.place(id),
    enabled: Boolean(id),
  });

  // A profile view, recorded once per place. The record id travels with it so the
  // discovery analytics can rank places without knowing anything about the visitor.
  const viewedId = query.data?.place.id;
  const viewedName = query.data?.place.name;
  useEffect(() => {
    if (!viewedId) return;
    track('cultural_place_viewed', { placeName: viewedName ?? '' }, viewedId);
  }, [viewedId, viewedName]);

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 pt-40 sm:px-10">
        <Skeleton className="h-10 w-2/3" />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    const error = query.error;
    const isMissing = error instanceof ApiClientError && error.status === 404;
    return (
      <div className="mx-auto max-w-3xl px-6 pt-40 sm:px-10">
        {isMissing ? (
          <Notice tone="warn" title="That place is not in ECHOES">
            The record may have been renamed. <Link to="/discover" className="underline">Return to the map</Link> and
            search again.
          </Notice>
        ) : (
          <ErrorState error={error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const { place, communityStories, experiences, nearby } = query.data;
  const analysis = place.knowledge;

  return (
    <article className="pt-28 sm:pt-36">
      {/* Hero */}
      <header className={`relative overflow-hidden rounded-none`}>
        <div
          className={`absolute inset-0 bg-gradient-to-br ${placeArt(place)}`}
          style={placeImageStyle(place)}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-cream via-cream/40 to-transparent" />

        <div className="relative z-10 mx-auto max-w-7xl px-6 pb-16 pt-20 sm:px-10 sm:pb-24 sm:pt-28">
          <Link to="/discover" className="inline-flex items-center gap-2 text-sm text-black/60 hover:text-black">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to the map
          </Link>

          <p className="mt-8 text-xs uppercase tracking-[0.25em] text-brand-deep">
            {categoryLabel(place.category)} — {place.neighbourhood}
          </p>
          <h1 className="mt-4 max-w-4xl font-display text-4xl font-light leading-[1.02] tracking-tighter text-ink sm:text-6xl lg:text-7xl">
            <WordReveal text={place.name} as="span" />
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-black/65">{place.summary}</p>

          <div className="mt-8 flex flex-wrap gap-2">
            <Chip>{place.address}</Chip>
            <Chip>
              {place.coordinates.lat.toFixed(5)}, {place.coordinates.lng.toFixed(5)}
            </Chip>
            <Chip>{place.coordinateAccuracy === 'approximate' ? 'Approximate coordinates' : 'Surveyed'}</Chip>
            {place.tags.slice(0, 3).map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>

          <ImageCredit image={place.image} variant="inline" className="mt-6 max-w-xl" />

          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" className="btn-primary" onClick={() => setShowDirections((value) => !value)}>
              <Navigation className="h-4 w-4" aria-hidden="true" />
              {showDirections ? 'Hide directions' : 'Get directions'}
            </button>
            <Link to={`/assistant?place=${place.id}`} className="btn-secondary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Ask the cultural guide
            </Link>
            <Link to={`/contribute?place=${place.id}`} className="btn-secondary">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Add what is missing
            </Link>
          </div>
        </div>
      </header>

      {/*
        The place itself leads, full width and before anything about our sources:
        the explanation is the page, the verdicts below it are about the checking.
      */}
      <section className="mx-auto max-w-7xl px-6 pt-12 sm:px-10 sm:pt-16">
        <Reveal>
          <div className="max-w-3xl">
            <p className="text-[10px] uppercase tracking-[0.24em] text-black/35">About this place</p>
            <h2 className="mt-3 font-display text-2xl tracking-tight sm:text-3xl">
              Historical and cultural information
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-black/75">{place.history}</p>
            <p className="mt-5 text-xs leading-relaxed text-black/40">
              This summary is drawn from the sources listed below. It is not a primary historical source.
            </p>
          </div>
        </Reveal>
      </section>

      <div className="mx-auto max-w-7xl px-6 pt-10 sm:px-10 sm:pt-12">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          {/* Main column */}
          <div className="space-y-6 lg:col-span-7">

            {showDirections && (
              <section className="card p-6">
                <DirectionsPanel destination={place} onRoute={setRoute} />
                <div className="mt-5">
                  <MapView
                    places={[place]}
                    activeId={place.id}
                    route={route}
                    className="h-[320px]"
                    showGaps={false}
                  />
                </div>
              </section>
            )}

            {/* The sources sit next to the summary that points at them. */}
            <Reveal>
              <section className="card p-6">
                <h2 className="mb-4 font-display text-xl tracking-tight">Sources</h2>
                <SourceList sources={place.sources} />
              </section>
            </Reveal>

            <Reveal>
              <section className="card p-6">
                <h2 className="mb-4 font-display text-xl tracking-tight">Community accounts</h2>
                {communityStories.length === 0 ? (
                  <div>
                    <p className="text-sm leading-relaxed text-black/55">
                      No community account has been published for this place yet. Submissions are reviewed by a
                      moderator before anything appears here.
                    </p>
                    <Link to={`/contribute?place=${place.id}`} className="btn-secondary mt-4">
                      Contribute an account
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="mb-4">
                      <Notice tone="brand">
                        Community testimony, published after moderation. These are community accounts, not
                        historically verified fact.
                      </Notice>
                    </div>
                    <ul className="space-y-4">
                      {communityStories.map((story) => (
                        <li key={story.id} className="rounded-2xl border border-black/10 bg-white/60 p-4">
                          <p className="whitespace-pre-line text-sm leading-relaxed text-black/70">{story.body}</p>
                          <p className="mt-3 text-xs text-black/45">
                            {story.contributor}
                            {story.period ? ` · period: ${story.period}` : ''}
                            {story.reviewedAt ? ` · reviewed ${formatDateTime(story.reviewedAt)}` : ''}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-black/40">
                            Context given by the contributor: {story.sourceContext}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </Reveal>

            {analysis && (
              <Reveal>
                <CoverageDisclosure analysis={analysis} coverage={place.coverage} />
              </Reveal>
            )}
          </div>

          {/* Side column */}
          <div className="space-y-6 lg:col-span-5">
            <NarrationCard placeId={place.id} placeName={place.name} />

            <Reveal>
              <section className="card p-6">
                <h2 className="mb-4 font-display text-xl tracking-tight">Experiences here</h2>
                {experiences.length === 0 ? (
                  <p className="text-sm leading-relaxed text-black/55">
                    No experience is listed for this place. ECHOES only lists verified operators, with written
                    consent.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {experiences.map((experience) => (
                      <li key={experience.id} className="rounded-2xl border border-black/10 bg-white/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-display text-sm tracking-tight">{experience.title}</p>
                          {experience.isSampleData && (
                            <span className="rounded-full border border-[#C8973F]/40 bg-[#C8973F]/15 px-2.5 py-0.5 text-[10px] text-[#7A5518]">
                              Sample listing
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-black/55">{experience.summary}</p>
                        <p className="mt-2 text-xs text-black/45">
                          {formatMoney(experience.priceMinor, experience.currency)} ·{' '}
                          {experience.schedules.filter((schedule) => !schedule.soldOut).length} date(s) available
                        </p>
                        <Link to={`/experiences/${experience.id}`} className="btn-secondary mt-3">
                          View dates
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </Reveal>

            <Reveal>
              <section className="card p-6">
                <h2 className="mb-4 font-display text-xl tracking-tight">Nearby</h2>
                <ul className="space-y-2">
                  {nearby.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        to={`/places/${entry.id}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/60 px-4 py-3 text-sm transition-colors hover:border-brand-deep/30"
                      >
                        <span className="inline-flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-black/35" aria-hidden="true" />
                          {entry.name}
                        </span>
                        <span className="text-xs text-black/40">{formatDistanceKm(entry.distanceKm)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </Reveal>
          </div>
        </div>
      </div>

      <div className="pointer-events-none mt-24 select-none overflow-hidden">
        <GiantWordmark text="KEEP LOOKING" className="text-[12vw] leading-[0.85]" strokeOnly />
      </div>
    </article>
  );
}
