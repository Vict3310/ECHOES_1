import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Compass,
  Crosshair,
  ExternalLink,
  Filter,
  Layers,
  MapPin,
  Navigation,
  Search,
  Sparkles,
} from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { categoryLabel, formatDistanceKm, PLACE_CATEGORIES } from '../lib/format';
import { usePlaces } from '../lib/hooks';
import type { Place, RouteResult } from '../lib/types';
import MapView from '../components/MapView';
import { DirectionsPanel } from '../components/DirectionsPanel';
import { CoverageGrid, CoverageLegend, KnowledgeSummary, PlaceCard, SourceList } from '../components/place';
import { EmptyState, ErrorState, Loading, Notice, OfflineBanner, SectionHeading } from '../components/ui';
import { Reveal } from '../components/layout';

export default function Discover() {
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [needsResearch, setNeedsResearch] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Place | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [showDirections, setShowDirections] = useState(false);
  const [showGaps, setShowGaps] = useState(true);
  const [nearby, setNearby] = useState<{ places: Place[]; label: string } | null>(null);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const { places, isLoading, isOffline, error, disclaimer, sourcesChecked, retry } = usePlaces({
    category: category || undefined,
    q: query.trim() || undefined,
    needsResearch: needsResearch || undefined,
  });

  const displayed = useMemo(() => {
    if (!nearby) return places;
    const order = new Map(nearby.places.map((place) => [place.id, place.distanceKm ?? 0]));
    return places
      .filter((place) => order.has(place.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((place) => ({ ...place, distanceKm: order.get(place.id) }));
  }, [places, nearby]);

  const gapsCount = displayed.filter((place) => place.knowledge?.needsResearch).length;

  function selectPlace(place: Place) {
    setActiveId(place.id);
    setActive(place);
    setRoute(null);
    setShowDirections(false);
  }

  async function findNearby() {
    setNearbyError(null);
    if (!('geolocation' in navigator)) {
      setNearbyError('This browser does not expose a location API. Choose a neighbourhood filter instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const result = await api.nearby(position.coords.latitude, position.coords.longitude, 6);
          setNearby({ places: result.places, label: 'Near your location (6 km)' });
        } catch (nearbyFailure) {
          setNearbyError(
            nearbyFailure instanceof ApiClientError
              ? nearbyFailure.message
              : 'Nearby places could not be loaded.',
          );
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setNearbyError(
          'Location permission was denied. Pick a neighbourhood from the filters instead — nothing is blocked.',
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  const detailLink = active ? `/places/${active.id}` : null;

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading
          eyebrow="Discovery map"
          title="Every marker is a real place, with the"
          accent="record behind it."
          description="Filter by category or neighbourhood, search by keyword, or overlay the knowledge gaps to see where the checked sources are thin. Map positions can be read as a list too — the map is never the only way in."
        />
      </div>

      <div className="mx-auto mt-10 max-w-7xl px-6 sm:px-10">
        {isOffline && <OfflineBanner onRetry={retry} notice={disclaimer} />}
      </div>

      {/* Filters */}
      <div className="mx-auto mt-6 max-w-7xl px-6 sm:px-10">
        <Reveal>
          <div className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-end gap-4">
              <label className="min-w-[220px] flex-1">
                <span className="field-label">Search places</span>
                <span className="relative block">
                  <Search
                    className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    className="field-input pl-6"
                    placeholder="Try “afrobeat”, “Badagry”, “museum”…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </span>
              </label>

              <label className="min-w-[180px]">
                <span className="field-label">Category</span>
                <select
                  className="field-input"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">All categories</option>
                  {PLACE_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {categoryLabel(value)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNeedsResearch((value) => !value)}
                  aria-pressed={needsResearch}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                    needsResearch
                      ? 'bg-brand-deep text-white'
                      : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                  Needs research
                </button>

                <button
                  type="button"
                  onClick={() => setShowGaps((value) => !value)}
                  aria-pressed={showGaps}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                    showGaps
                      ? 'bg-brand-deep text-white'
                      : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  Gap overlay
                </button>

                <button type="button" onClick={findNearby} className="btn-secondary" disabled={locating}>
                  <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                  {locating ? 'Locating…' : 'Near me'}
                </button>

                {nearby && (
                  <button
                    type="button"
                    onClick={() => setNearby(null)}
                    className="inline-flex items-center gap-2 rounded-full border border-brand-deep/20 bg-brand-soft/60 px-3 py-1.5 text-xs text-brand-deep"
                  >
                    {nearby.label}
                    <span className="underline">clear</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-black/45">
              <span>
                {displayed.length} place{displayed.length === 1 ? '' : 's'} shown
              </span>
              <span aria-hidden="true">·</span>
              <span>{gapsCount} with incomplete records</span>
              {sourcesChecked.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Sources checked: {sourcesChecked.map((s) => s.split(' (')[0]).join(', ')}</span>
                </>
              )}
            </div>
          </div>
        </Reveal>

        {nearbyError && (
          <div className="mt-4">
            <Notice tone="warn">{nearbyError}</Notice>
          </div>
        )}
      </div>

      {/* Map + panel */}
      <div className="mx-auto mt-8 grid max-w-7xl grid-cols-1 gap-8 px-6 pb-24 sm:px-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {isLoading ? (
            <Loading label="Placing markers…" />
          ) : (
            <MapView
              places={displayed}
              activeId={activeId}
              onSelect={selectPlace}
              route={route}
              showGaps={showGaps}
              className="h-[420px] lg:h-[640px]"
            />
          )}

          <div className="mt-4">
            <details className="card p-4 text-sm text-black/60">
              <summary className="cursor-pointer font-display tracking-tight text-ink">
                What the gap overlay means
              </summary>
              <div className="mt-4">
                <CoverageLegend />
              </div>
            </details>
          </div>
        </div>

        <div className="lg:col-span-5">
          {error && !places.length ? (
            <ErrorState error={error} onRetry={retry} />
          ) : active ? (
            <div className="space-y-4">
              <div className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-black/40">
                      {categoryLabel(active.category)}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-light tracking-tighter">{active.name}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActive(null);
                      setActiveId(null);
                      setRoute(null);
                    }}
                    className="rounded-full border border-black/15 px-3 py-1 text-xs text-black/50 hover:bg-black/[0.04]"
                  >
                    close
                  </button>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-black/60">{active.summary}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/45">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" aria-hidden="true" />
                    {active.address}
                  </span>
                  <span>
                    {active.coordinates.lat.toFixed(4)}, {active.coordinates.lng.toFixed(4)}
                  </span>
                  {typeof active.distanceKm === 'number' && (
                    <span>{formatDistanceKm(active.distanceKm)} away</span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {detailLink && (
                    <Link to={detailLink} className="btn-primary">
                      Full profile
                    </Link>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowDirections((value) => !value)}
                  >
                    <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                    {showDirections ? 'Hide directions' : 'Get directions'}
                  </button>
                  <Link to={`/assistant?place=${active.id}`} className="btn-secondary">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    Ask about this
                  </Link>
                </div>
              </div>

              {showDirections && (
                <div className="card p-5">
                  <DirectionsPanel
                    destination={active}
                    candidates={places.filter((place) => place.id !== active.id)}
                    onRoute={setRoute}
                  />
                </div>
              )}

              {active.knowledge && <KnowledgeSummary analysis={active.knowledge} />}

              <div className="card p-5">
                <p className="mb-3 text-xs uppercase tracking-widest text-black/40">Coverage by dimension</p>
                <CoverageGrid coverage={active.coverage} />
              </div>

              <div className="card p-5">
                <p className="mb-3 text-xs uppercase tracking-widest text-black/40">Sources</p>
                <SourceList sources={active.sources} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <EmptyState
                title="Select a marker, or browse the list"
                description="Choosing a place shows its coverage, its sources, its gaps and a way to get directions."
              >
                <Compass className="h-5 w-5 text-brand-deep" aria-hidden="true" />
              </EmptyState>
              <p className="text-xs uppercase tracking-widest text-black/40">
                {displayed.length} records
              </p>
            </div>
          )}

          <div className="mt-6 space-y-6">
            {displayed.slice(0, 12).map((place) => (
              <PlaceCard
                key={place.id}
                place={place}
                active={place.id === activeId}
                onSelect={selectPlace}
              />
            ))}
            {displayed.length === 0 && !isLoading && (
              <EmptyState
                title="No places match those filters"
                description="Try clearing the category, turning off “needs research”, or searching a different keyword."
              />
            )}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/plan" className="btn-secondary">
              Plan a route through these
            </Link>
            <a
              href="https://www.openstreetmap.org/#map=12/6.4550/3.3950"
              target="_blank"
              rel="noreferrer noopener"
              className="btn-secondary"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              OpenStreetMap view
            </a>
          </div>

          <div className="mt-6">
            <p className="text-xs leading-relaxed text-black/40">
              Map data © OpenStreetMap contributors. Tile usage follows the configured tile provider's terms — the
              public OSM tile service is not an unrestricted production service.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
