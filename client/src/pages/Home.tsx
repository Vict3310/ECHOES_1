import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  BookOpen,
  Compass,
  FileSearch,
  MapPinned,
  MessageSquareQuote,
  Route,
  Ticket,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { categoryLabel, formatMinutes, formatMoney } from '../lib/format';
import { usePlaces } from '../lib/hooks';
import { Chip, Loading, Notice, OfflineBanner, SectionHeading } from '../components/ui';
import { placeArt } from '../components/place';
import { GiantWordmark, HeroBlobs, Parallax, Reveal, WordReveal, EASE } from '../components/layout';

const CAPABILITIES = [
  {
    title: 'Cultural discovery map',
    to: '/discover',
    icon: MapPinned,
    blurb: 'Real Lagos sites with coordinates, category filters and a knowledge-gap overlay.',
  },
  {
    title: 'Grounded cultural answers',
    to: '/assistant',
    icon: Compass,
    blurb: 'Gemma answers from retrieved ECHOES records and cites the record behind every claim.',
  },
  {
    title: 'Real routes and directions',
    to: '/plan',
    icon: Route,
    blurb: 'Distance and duration come from a routing provider — never estimated by the model or the UI.',
  },
  {
    title: 'AI itinerary planning',
    to: '/plan',
    icon: FileSearch,
    blurb: 'Structured plans whose stop ids are validated against the database before they are shown.',
  },
  {
    title: 'Community preservation',
    to: '/contribute',
    icon: Users,
    blurb: 'Consent-first story submissions with attribution choices and a real moderation queue.',
  },
  {
    title: 'Verified experiences',
    to: '/experiences',
    icon: Ticket,
    blurb: 'Availability, server-side pricing and ALATPay checkout, confirmed only after verification.',
  },
];

const METHOD = [
  {
    key: 'A',
    title: 'Records with provenance',
    body: 'Every cultural record links to the source it came from — OpenStreetMap, Wikipedia, Wikidata — with a retrieval date and a licence. Imported facts are never presented as confirmed history.',
    icon: BookOpen,
  },
  {
    key: 'B',
    title: 'Explainable gaps, not scores',
    body: 'Each dimension of coverage is classified on its own: found, incomplete, not found, conflicting, or awaiting review. The evidence behind every flag is stored and shown, so a gap is never collapsed into a misleading single truth score.',
    icon: FileSearch,
  },
  {
    key: 'C',
    title: 'Cited, refused, or flagged',
    body: 'Answers must cite retrieved records. Invented citations are discarded on the server, community accounts stay labelled as testimony, and when the evidence is thin ECHOES says so instead of filling the silence.',
    icon: MessageSquareQuote,
  },
];

function CapabilityPreview() {
  const [active, setActive] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);

  return (
    <div className="relative">
      <ul
        ref={listRef}
        className="divide-y divide-white/10 border-t border-b border-white/10"
        onMouseLeave={() => setActive(null)}
      >
        {CAPABILITIES.map((item, index) => (
          <li key={item.title}>
            <Link
              to={item.to}
              onMouseEnter={() => setActive(index)}
              onMouseMove={(event) => {
                const rect = listRef.current?.getBoundingClientRect();
                if (!rect) return;
                setPos({ x: event.clientX - rect.left + 28, y: event.clientY - rect.top - 80 });
              }}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className="group flex items-baseline justify-between gap-6 py-6 transition-colors duration-500 hover:border-brand/50 sm:py-8"
            >
              <span className="max-w-2xl">
                <span className="block font-display text-2xl font-light tracking-tighter text-white/80 transition-all duration-500 group-hover:translate-x-2 group-hover:text-white sm:text-4xl">
                  {item.title}
                </span>
                <span className="mt-2 block max-w-xl text-sm leading-relaxed text-white/45">{item.blurb}</span>
              </span>
              <span className="shrink-0 text-xs text-white/30 transition-colors duration-500 group-hover:text-brand">
                {String(index + 1).padStart(2, '0')}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {!reduced && active !== null && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute z-20 hidden w-56 overflow-hidden rounded-lg shadow-2xl shadow-black/50 lg:block"
          style={{ left: pos.x, top: pos.y }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          <div className="flex aspect-[4/3] flex-col justify-end bg-gradient-to-br from-brand-deep via-brand-hover to-brand/70 p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">ECHOES</p>
            <p className="font-display text-sm font-light tracking-tighter text-white">
              {CAPABILITIES[active]?.title}
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default function Home() {
  const { places, isLoading, isOffline, error, disclaimer, retry } = usePlaces();
  const featured = useMemo(() => places.slice(0, 4), [places]);
  const [stats, setStats] = useState<{
    experiences: number;
    sampleOnly: boolean;
    cheapest: number | null;
    currency: string;
    longest: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .experiences()
      .then((result) => {
        if (cancelled) return;
        const cheapest = result.experiences
          .map((experience) => experience.priceMinor)
          .sort((a, b) => a - b)[0];
        const longest = result.experiences
          .map((experience) => experience.durationMinutes)
          .sort((a, b) => b - a)[0];
        setStats({
          experiences: result.experiences.length,
          sampleOnly: result.experiences.every((experience) => experience.isSampleData),
          cheapest: cheapest ?? null,
          currency: result.experiences[0]?.currency ?? 'NGN',
          longest: longest ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [primary, ...rest] = featured;

  return (
    <>
      {/* ==================== HERO ==================== */}
      <header className="relative flex min-h-screen flex-col overflow-hidden">
        <Parallax strength={0.12} className="absolute inset-0">
          <div className="h-[115%] w-full bg-[radial-gradient(120%_90%_at_15%_10%,#2A6647_0%,#1E4D33_38%,#12281A_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_80%_20%,rgba(66,168,93,0.35),transparent_65%)]" />
          <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(251,250,247,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(251,250,247,0.6)_1px,transparent_1px)] [background-size:64px_64px]" />
        </Parallax>

        <HeroBlobs />

        <div className="absolute inset-0 bg-gradient-to-t from-cream via-cream/60 to-cream/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-cream/70 via-transparent to-cream/30" />

        <div className="relative z-10 flex flex-1 items-end">
          <div className="mx-auto w-full max-w-7xl px-6 pb-[22vw] pt-40 sm:px-10 sm:pb-[18vw] lg:pb-[15vw]">
            <div className="max-w-2xl">
              <Reveal>
                <p className="mb-8 text-xs font-medium uppercase tracking-[0.25em] text-brand-deep">
                  Cultural discovery — Lagos, Nigeria
                </p>
              </Reveal>

              <h1 className="font-display text-5xl font-light leading-[0.95] tracking-tighter text-ink sm:text-7xl lg:text-8xl">
                <WordReveal text="Discover where to go. Understand" as="span" />
                <br />
                <WordReveal text="why it" as="span" delay={0.2} />{' '}
                <em className="font-serif font-normal italic">
                  <WordReveal text="matters." as="span" delay={0.32} />
                </em>
              </h1>

              <Reveal delay={0.55}>
                <p className="mt-8 text-sm tracking-wide text-black/50">
                  / Real places · cited sources · honest gaps /
                </p>
              </Reveal>

              <Reveal delay={0.7}>
                <div className="mt-10 flex flex-wrap items-center gap-6">
                  <Link to="/discover" className="group btn-primary">
                    Explore the map
                    <ArrowUpRight
                      className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                  <Link to="/plan" className="link-underline">
                    Plan a cultural route
                  </Link>
                </div>
              </Reveal>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute -bottom-[4vw] left-1/2 z-[5] w-full -translate-x-1/2 overflow-hidden">
          <Parallax strength={0.4}>
            <GiantWordmark text="ECHOES" className="text-[19.5vw]" strokeOnly />
          </Parallax>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 pt-10 sm:px-10">
        {isOffline && <OfflineBanner onRetry={retry} notice={disclaimer} />}
        {!isOffline && Boolean(error) && (
          <Notice tone="warn" title="Records could not be loaded">
            {disclaimer}
          </Notice>
        )}
      </div>

      {/* ==================== FEATURED PLACES ==================== */}
      <section id="places" className="relative pb-8 pt-24 sm:pt-36">
        <div className="mx-auto max-w-7xl px-6 sm:px-10">
          <div className="mb-14 flex items-end justify-between gap-6">
            <SectionHeading
              eyebrow="Selected places"
              title="Real sites, with the"
              accent="sources attached."
            />
            <p className="hidden shrink-0 text-sm text-black/40 sm:block">
              {places.length} records · Lagos
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="mx-auto max-w-7xl px-6 sm:px-10">
            <Loading label="Loading cultural records…" />
          </div>
        ) : (
          <>
            {primary && (
              <div className="mx-auto mb-6 max-w-7xl px-6 sm:mb-10 sm:px-10">
                <Reveal>
                  <Link
                    to={`/places/${primary.id}`}
                    className="group relative block aspect-[16/10] overflow-hidden rounded-2xl shadow-2xl shadow-black/15 sm:aspect-[21/9]"
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${placeArt(primary)}`} />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(255,255,255,0.28),transparent_55%)]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 flex w-full flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-10">
                      <div>
                        <p className="mb-2 text-xs font-medium text-brand">01</p>
                        <h3 className="font-display text-2xl font-light tracking-tighter text-white sm:text-3xl">
                          {primary.name}
                        </h3>
                        <p className="mt-2 max-w-md text-base text-white/60">{primary.summary}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-white/60">
                        <Chip tone="dark">{categoryLabel(primary.category)}</Chip>
                        <Chip tone="dark">{primary.neighbourhood}</Chip>
                      </div>
                    </div>
                  </Link>
                </Reveal>
              </div>
            )}

            {rest.length > 0 && (
              <div className="mx-auto mb-6 grid max-w-7xl grid-cols-1 gap-6 px-6 sm:mb-10 sm:gap-10 sm:px-10 lg:grid-cols-12">
                {rest.slice(0, 2).map((place, index) => (
                  <Reveal
                    key={place.id}
                    delay={index * 0.12}
                    className={
                      index === 0
                        ? 'lg:col-span-7 lg:-mt-4'
                        : 'lg:col-span-5 lg:mt-24'
                    }
                  >
                    <Link
                      to={`/places/${place.id}`}
                      className={`group relative block overflow-hidden rounded-2xl shadow-2xl shadow-black/15 ${
                        index === 0 ? 'aspect-[4/3]' : 'aspect-[4/5] lg:aspect-auto'
                      }`}
                    >
                      <div className={`absolute inset-0 bg-gradient-to-br ${placeArt(place)}`} />
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <div className="absolute bottom-0 left-0 p-6 sm:p-8">
                        <p className="mb-2 text-xs font-medium text-brand">
                          {String(index + 2).padStart(2, '0')}
                        </p>
                        <h3 className="font-display text-2xl font-light tracking-tighter text-white">
                          {place.name}
                        </h3>
                        <p className="mt-2 max-w-sm text-base text-white/60">{place.summary}</p>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/60">
                          <Chip tone="dark">{categoryLabel(place.category)}</Chip>
                          {place.knowledge && place.knowledge.gaps.length > 0 && (
                            <Chip tone="dark">{place.knowledge.gaps.length} gaps flagged</Chip>
                          )}
                        </div>
                      </div>
                    </Link>
                  </Reveal>
                ))}
              </div>
            )}

            {rest[2] && (
              <Reveal>
                <Link
                  to={`/places/${rest[2].id}`}
                  className="group relative block aspect-[16/12] overflow-hidden sm:aspect-[21/9]"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${placeArt(rest[2])}`} />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_30%,rgba(255,255,255,0.2),transparent_60%)]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 w-full">
                    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 pb-8 sm:flex-row sm:items-end sm:justify-between sm:px-10 sm:pb-12">
                      <div>
                        <p className="mb-2 text-xs font-medium text-brand">04</p>
                        <h3 className="font-display text-2xl font-light tracking-tighter text-white sm:text-3xl">
                          {rest[2].name}
                        </h3>
                        <p className="mt-2 max-w-md text-base text-white/60">{rest[2].summary}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-white/60">
                        <Chip tone="dark">{categoryLabel(rest[2].category)}</Chip>
                        <Chip tone="dark">{rest[2].sources.length} sources</Chip>
                      </div>
                    </div>
                  </div>
                </Link>
              </Reveal>
            )}
          </>
        )}
      </section>

      {/* ==================== METHOD ==================== */}
      <section id="method" className="bg-brand-soft py-24 text-black sm:py-36">
        <div className="mx-auto max-w-7xl px-6 sm:px-10">
          <div className="mb-20 max-w-3xl">
            <SectionHeading
              eyebrow="Method"
              title="We treat records as evidence, not"
              accent="verdicts."
              description="Much of Lagos's cultural record is incomplete online. ECHOES shows what was found, credits it, and marks what is missing — without pretending a gap means a place has no history."
            />
          </div>

          <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {METHOD.map((item, index) => (
              <Reveal key={item.key} delay={index * 0.12}>
                <div className="mb-6 grid h-40 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-deep/90 via-brand-hover to-brand/70 shadow-xl shadow-black/10">
                  <item.icon className="h-10 w-10 text-white/80" aria-hidden="true" strokeWidth={1.2} />
                </div>
                <p className="mb-2 text-xs font-medium text-black/40">{item.key}</p>
                <h3 className="mb-3 font-display text-xl font-light tracking-tighter">{item.title}</h3>
                <p className="text-base leading-relaxed text-black/60">{item.body}</p>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <div className="mt-16 flex flex-wrap items-center gap-4">
              <Link to="/discover" className="btn-primary">
                See the knowledge-gap overlay
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/contribute" className="link-underline">
                Add what the sources are missing
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ==================== CAPABILITIES ==================== */}
      <section id="capabilities" className="relative bg-brand-deep py-24 sm:py-36">
        <div className="mx-auto max-w-7xl px-6 sm:px-10">
          <Reveal>
            <p className="mb-12 text-xs font-medium uppercase tracking-[0.25em] text-brand">
              What you can do
            </p>
          </Reveal>
          <CapabilityPreview />

          <div className="mt-16 grid grid-cols-2 gap-6 text-white/70 sm:grid-cols-4">
            <Reveal>
              <p className="font-display text-3xl font-light tracking-tighter text-white">
                {places.length}
              </p>
              <p className="mt-1 text-xs uppercase tracking-widest text-white/40">Places mapped</p>
            </Reveal>
            <Reveal delay={0.08}>
              <p className="font-display text-3xl font-light tracking-tighter text-white">
                {places.filter((place) => place.knowledge?.needsResearch).length}
              </p>
              <p className="mt-1 text-xs uppercase tracking-widest text-white/40">Needing research</p>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="font-display text-3xl font-light tracking-tighter text-white">
                {stats ? stats.experiences : '—'}
              </p>
              <p className="mt-1 text-xs uppercase tracking-widest text-white/40">
                {stats?.sampleOnly ? 'Sample experiences' : 'Experiences'}
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <p className="font-display text-3xl font-light tracking-tighter text-white">
                {stats?.cheapest != null ? formatMoney(stats.cheapest, stats.currency) : '—'}
              </p>
              <p className="mt-1 text-xs uppercase tracking-widest text-white/40">Lowest sample price</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ==================== PRINCIPLE ==================== */}
      <section className="bg-cream pb-24 pt-24 sm:pb-36">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 sm:px-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <div className="relative overflow-hidden rounded-2xl shadow-2xl shadow-black/15">
              <div className="aspect-[4/5] bg-gradient-to-br from-ink via-brand-deep to-brand/60" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.18),transparent_60%)]" />
              <div className="absolute bottom-0 left-0 p-8">
                <p className="text-xs uppercase tracking-[0.25em] text-white/50">The ECHOES principle</p>
                <p className="mt-3 font-display text-xl font-light leading-snug tracking-tighter text-white">
                  Discover where to go. Understand why a place matters. Learn what the records are missing.
                  Experience the culture responsibly.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.12} className="lg:col-span-6 lg:col-start-7">
            <MessageSquareQuote className="mb-8 h-8 w-8 text-brand-deep" aria-hidden="true" strokeWidth={1.4} />
            <blockquote className="font-display text-2xl font-light leading-[1.2] tracking-tighter text-ink sm:text-4xl">
              “ECHOES does not claim to know the complete history of Lagos. It shows you what it found, who said
              it, and what is still missing — and it says so plainly when the evidence runs out.”
            </blockquote>
            <div className="mt-8">
              <p className="text-base font-medium">Editorial policy</p>
              <p className="text-sm text-black/40">
                Coverage describes the sources checked — never a community's own knowledge
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-6">
              <div>
                <p className="font-display text-2xl font-light tracking-tighter">
                  {places.reduce((sum, place) => sum + place.sources.length, 0)}
                </p>
                <p className="text-xs uppercase tracking-widest text-black/40">Source links</p>
              </div>
              <div>
                <p className="font-display text-2xl font-light tracking-tighter">
                  {stats?.longest != null ? formatMinutes(stats.longest) : '—'}
                </p>
                <p className="text-xs uppercase tracking-widest text-black/40">Longest sample experience</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ==================== CTA ==================== */}
      <section id="contact" className="relative overflow-hidden pt-12">
        <div className="pointer-events-none select-none overflow-hidden">
          <GiantWordmark text="DISCOVER LAGOS" className="-mb-[2vw] text-[13vw] leading-[0.85]" strokeOnly />
        </div>

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-14 px-6 py-20 sm:px-10 sm:py-28 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <h2 className="mb-6 font-display text-4xl font-light leading-[1.05] tracking-tighter sm:text-5xl">
              Start with a place.
              <br />
              <em className="font-serif font-normal italic">Or add one.</em>
            </h2>
            <p className="mb-10 max-w-sm text-lg text-black/60">
              Open the map, follow a real route, ask the cultural guide, or contribute the account that the
              checked sources are missing.
            </p>
            <div className="flex flex-col gap-4">
              <Link to="/discover" className="group inline-flex items-center gap-2 text-base">
                Open the discovery map
                <ArrowUpRight
                  className="h-4 w-4 text-brand-deep transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
              <Link to="/assistant" className="group inline-flex items-center gap-2 text-base">
                Ask the cultural assistant
                <ArrowUpRight
                  className="h-4 w-4 text-brand-deep transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
              <Link to="/experiences" className="group inline-flex items-center gap-2 text-base">
                Browse cultural experiences
                <ArrowUpRight
                  className="h-4 w-4 text-brand-deep transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </div>
          </Reveal>

          <Reveal delay={0.12} className="lg:col-span-6 lg:col-start-7">
            <div className="card p-6 sm:p-8">
              <p className="mb-6 text-xs uppercase tracking-[0.25em] text-black/40">How ECHOES is built</p>
              <ul className="space-y-4 text-sm leading-relaxed text-black/60">
                <li className="flex gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  Gemma writes the cultural explanations and itineraries. The database supplies the places, and a
                  routing engine calculates the routes.
                </li>
                <li className="flex gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  Cultural records cite OpenStreetMap, Wikipedia and Wikidata. Every gap flag stores the evidence
                  behind it.
                </li>
                <li className="flex gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  Bookings are priced on the server and confirmed only after a transaction is verified against the
                  booking amount and currency.
                </li>
              </ul>
              <Link to="/admin" className="btn-secondary mt-8">
                Moderation &amp; payment reconciliation
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
