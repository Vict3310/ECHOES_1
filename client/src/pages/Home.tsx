import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  BookOpen,
  Compass,
  FileSearch,
  MapPinned,
  MapPin,
  MessageSquareQuote,
  Route,
  Star,
  Ticket,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { categoryLabel, formatMinutes, formatMoney } from '../lib/format';
import { usePlaces } from '../lib/hooks';
import { Chip, Loading, Notice, OfflineBanner, SectionHeading } from '../components/ui';
import { ImageCredit, placeArt, placeImageStyle } from '../components/place';
import { GiantWordmark, Reveal, EASE } from '../components/layout';

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

const FOOD_FEATURES = [
  {
    name: 'Jollof Rice',
    blurb: 'Tomato-rich party favourite with crispy, smoky depth.',
    restaurant: 'Bungalow Restaurant',
    rating: 4.8,
    tag: 'Popular near Lekki',
    tone: 'from-orange-500/90 via-amber-500/80 to-red-500/80',
  },
  {
    name: 'Amala & Ewedu',
    blurb: 'A slow, earthy classic served with peppery sauces.',
    restaurant: 'Mama Toun Kitchen',
    rating: 4.9,
    tag: 'Local favourite',
    tone: 'from-emerald-600/90 via-lime-500/80 to-teal-500/80',
  },
  {
    name: 'Suya',
    blurb: 'Spiced grilled meat with that smoky, peppery finish.',
    restaurant: 'Iya Ado Suya Bar',
    rating: 4.7,
    tag: 'Best after sunset',
    tone: 'from-rose-500/90 via-red-500/80 to-orange-500/80',
  },
  {
    name: 'Moi Moi',
    blurb: 'Smooth bean pudding that pairs perfectly with tea.',
    restaurant: 'Taste of Oshodi',
    rating: 4.6,
    tag: 'Quick breakfast',
    tone: 'from-yellow-500/90 via-amber-400/80 to-orange-400/80',
  },
];

const NIGERIA_HIGHLIGHTS = [
  {
    city: 'Lagos',
    state: 'Lagos State',
    headline: 'Freedom Park, Marina & the island pulse',
    summary: 'Architecture, street culture, and memory-rich walks across the metropolis.',
    tone: 'from-[#1b2d2b] via-[#2b4a45] to-[#c78e53]',
  },
  {
    city: 'Ibadan',
    state: 'Oyo State',
    headline: 'Heritage districts and cultural memory',
    summary: 'Old-city routes, historic compounds, and layered civic history.',
    tone: 'from-[#4f392c] via-[#8a5d3f] to-[#d7b48d]',
  },
  {
    city: 'Kano',
    state: 'Kano State',
    headline: 'Markets, craft, and northern character',
    summary: 'A strong centre for trade, textiles, and urban heritage.',
    tone: 'from-[#33261a] via-[#7b4d29] to-[#d99b57]',
  },
  {
    city: 'Enugu',
    state: 'Enugu State',
    headline: 'Hill-city storytelling and local identity',
    summary: 'Traditional routes, cultural architecture, and community-led experiences.',
    tone: 'from-[#16362d] via-[#376b5d] to-[#9ab99d]',
  },
  {
    city: 'Calabar',
    state: 'Cross River State',
    headline: 'Coastal culture and festival energy',
    summary: 'A mix of heritage, hospitality, and southern coastal atmosphere.',
    tone: 'from-[#1f2d52] via-[#4668a8] to-[#94c5db]',
  },
  {
    city: 'Abeokuta',
    state: 'Ogun State',
    headline: 'Cultural roots and intellectual heritage',
    summary: 'Historic institutions, town texture, and a strong arts narrative.',
    tone: 'from-[#2b3127] via-[#526b46] to-[#d9c99d]',
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
      <header className="relative overflow-hidden pb-4 sm:pb-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="p-0">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)] lg:items-center">
              <section className="rounded-[28px] bg-transparent p-0 sm:p-0 lg:p-0">
                <div className="flex items-center justify-between gap-3 text-black/60">
                  <span className="inline-flex items-center rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.22em]">
                    ECHOES Lagos
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-black/65">
                    <MapPin className="h-3.5 w-3.5" />
                    Lagos, Nigeria
                  </span>
                </div>

                <div className="mt-5 max-w-xl">
                  <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-[#856337]">Curated culture, on your terms</p>
                  <h1 className="mt-3 font-display text-[2.5rem] font-light leading-[0.94] tracking-[-0.06em] text-ink sm:text-[2.9rem] lg:text-[3.4rem]">
                    See Lagos through the stories that shaped it.
                  </h1>
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-black/65 sm:text-base">
                    Discover heritage places, food trails, and local experiences built around the real rhythm of the city.
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link to="/discover" className="inline-flex items-center gap-2 rounded-full bg-[#1d2a26] px-4 py-2.5 text-sm font-medium text-white transition-transform hover:-translate-y-0.5">
                    Start exploring
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                  <Link to="/experiences" className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-[#f6f1eb]">
                    Book a tour
                  </Link>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
                  {[
                    { value: '120+', label: 'Sites' },
                    { value: '4.9', label: 'Rating' },
                    { value: '14', label: 'Routes' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-2xl border border-black/10 bg-white/80 p-3 sm:p-4">
                      <p className="font-display text-2xl tracking-tighter text-ink sm:text-3xl">{stat.value}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-black/45">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </section>

              <aside className="rounded-[28px] border border-black/10 bg-white p-5 shadow-[0_8px_20px_rgba(17,24,39,0.03)] sm:p-6">
                <p className="text-[9px] uppercase tracking-[0.24em] text-black/45">This week</p>
                <h2 className="mt-2 font-display text-3xl tracking-tighter text-ink">Top picks</h2>

                <div className="mt-5 space-y-3">
                  {[
                    ['Jollof Rice', 'Lekki • 4.8'],
                    ['Amala & Ewedu', 'Yaba • 4.9'],
                    ['Suya Night Market', 'Victoria Island • 4.7'],
                  ].map(([name, meta]) => (
                    <div key={name} className="flex items-center justify-between gap-3 rounded-2xl border border-black/8 bg-[#f7f2eb] p-3">
                      <div>
                        <p className="font-medium text-ink">{name}</p>
                        <p className="text-xs text-black/45">{meta}</p>
                      </div>
                      <div className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-medium text-black/60">
                        <Star className="h-3 w-3 fill-current text-yellow-400" />
                        4.8
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-[22px] bg-[#f2eadf] p-4">
                  <p className="text-[9px] uppercase tracking-[0.24em] text-black/45">Featured route</p>
                  <h3 className="mt-2 font-display text-2xl tracking-tighter text-ink">Freedom Park</h3>
                  <p className="mt-2 text-sm leading-relaxed text-black/60">History, memory, and city energy in one calm, easy walk.</p>
                </div>
              </aside>
            </div>
          </div>
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

      <section className="relative mx-auto max-w-7xl px-4 pb-6 pt-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-black/40">Food spotlight</p>
            <h2 className="mt-2 font-display text-3xl tracking-tighter text-ink sm:text-5xl">
              Nigerian flavours near you
            </h2>
          </div>
          <Link to="/discover" className="hidden items-center gap-2 text-sm font-medium text-brand-deep sm:inline-flex">
            Explore the food map
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {FOOD_FEATURES.map((dish) => (
            <article key={dish.name} className="group overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-[0_14px_32px_rgba(17,24,39,0.06)] transition-transform duration-300 hover:-translate-y-1">
              <div className={`relative h-40 bg-gradient-to-br ${dish.tone}`}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.34),transparent_36%)]" />
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-black/60 backdrop-blur-sm">
                  <MapPin className="h-3 w-3" />
                  {dish.tag}
                </div>
                <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-full bg-black/20 px-2 py-1 text-xs text-white">
                  <Star className="h-3.5 w-3.5 fill-current text-yellow-300" />
                  {dish.rating}
                </div>
              </div>

              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-2xl tracking-tighter text-ink">{dish.name}</h3>
                  <div className="rounded-full bg-[#f5efe7] px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-black/50">
                    Local
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-black/60">{dish.blurb}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-black/40">Best restaurant</p>
                    <p className="mt-1 text-sm font-medium text-ink">{dish.restaurant}</p>
                  </div>
                  <button type="button" className="inline-flex items-center gap-1 rounded-full border border-black/10 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-ink">
                    Explore
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

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
                  {/*
                    The card is a link over its whole surface, but the licence
                    credit inside it is a link too, so the card is a shell with
                    an overlay link rather than one anchor wrapped in another.
                  */}
                  <div className="group relative aspect-[16/10] overflow-hidden rounded-2xl shadow-2xl shadow-black/15 sm:aspect-[21/9]">
                    <div
                      className={`absolute inset-0 bg-gradient-to-br ${placeArt(primary)}`}
                      style={placeImageStyle(primary)}
                    />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(255,255,255,0.28),transparent_55%)]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 flex w-full flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-10">
                      <div>
                        <p className="mb-2 text-xs font-medium text-brand">01</p>
                        <h3 className="font-display text-2xl font-light tracking-tighter text-white sm:text-3xl">
                          {primary.name}
                        </h3>
                        <p className="mt-2 max-w-md text-base text-white/60">{primary.summary}</p>
                        <ImageCredit image={primary.image} className="relative z-20 mt-3 max-w-md" />
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-white/60">
                        <Chip tone="dark">{categoryLabel(primary.category)}</Chip>
                        <Chip tone="dark">{primary.neighbourhood}</Chip>
                      </div>
                    </div>
                    <Link to={`/places/${primary.id}`} className="absolute inset-0 z-10 rounded-2xl">
                      <span className="sr-only">{primary.name} — open the cultural record</span>
                    </Link>
                  </div>
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
                    <div
                      className={`group relative overflow-hidden rounded-2xl shadow-2xl shadow-black/15 ${
                        index === 0 ? 'aspect-[4/3]' : 'aspect-[4/5] lg:aspect-auto'
                      }`}
                    >
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${placeArt(place)}`}
                        style={placeImageStyle(place)}
                      />
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
                        <ImageCredit image={place.image} className="relative z-20 mt-3 max-w-xs" />
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/60">
                          <Chip tone="dark">{categoryLabel(place.category)}</Chip>
                          {place.knowledge && place.knowledge.gaps.length > 0 && (
                            <Chip tone="dark">{place.knowledge.gaps.length} gaps flagged</Chip>
                          )}
                        </div>
                      </div>
                      <Link to={`/places/${place.id}`} className="absolute inset-0 z-10 rounded-2xl">
                        <span className="sr-only">{place.name} — open the cultural record</span>
                      </Link>
                    </div>
                  </Reveal>
                ))}
              </div>
            )}

            {rest[2] && (
              <Reveal>
                <div className="group relative aspect-[16/12] overflow-hidden sm:aspect-[21/9]">
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${placeArt(rest[2])}`}
                    style={placeImageStyle(rest[2])}
                  />
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
                        <ImageCredit image={rest[2].image} className="relative z-20 mt-3 max-w-md" />
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-white/60">
                        <Chip tone="dark">{categoryLabel(rest[2].category)}</Chip>
                        <Chip tone="dark">{rest[2].sources.length} sources</Chip>
                      </div>
                    </div>
                  </div>
                  <Link to={`/places/${rest[2].id}`} className="absolute inset-0 z-10">
                    <span className="sr-only">{rest[2].name} — open the cultural record</span>
                  </Link>
                </div>
              </Reveal>
            )}
          </>
        )}
      </section>

      <section id="nigeria-coverage" className="relative pb-8 pt-20 sm:pt-28">
        <div className="mx-auto max-w-7xl px-6 sm:px-10">
          <div className="mb-10 flex items-end justify-between gap-4">
            <SectionHeading
              eyebrow="Across Nigeria"
              title="Built for a wider travel map, not just"
              accent="one city."
              description="ECHOES is expanding beyond Lagos with a deeper travel story across Nigeria's major heritage and culture hubs."
            />
            <Link to="/discover" className="hidden items-center gap-2 text-sm font-medium text-brand-deep sm:inline-flex">
              View more places
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {NIGERIA_HIGHLIGHTS.map((item) => (
              <article
                key={item.city}
                className="group overflow-hidden rounded-[26px] border border-black/10 bg-white shadow-[0_14px_28px_rgba(17,24,39,0.05)] transition-transform duration-300 hover:-translate-y-1"
              >
                <div className={`relative h-40 bg-gradient-to-br ${item.tone}`}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_30%)]" />
                  <div className="absolute left-4 top-4 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-black/60 backdrop-blur-sm">
                    {item.state}
                  </div>
                </div>

                <div className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-2xl tracking-tighter text-ink">{item.city}</h3>
                    <span className="rounded-full bg-[#f3ecdf] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-black/50">
                      Heritage
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-brand-deep">{item.headline}</p>
                  <p className="mt-2 text-sm leading-relaxed text-black/60">{item.summary}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
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
