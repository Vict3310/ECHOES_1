import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  ExternalLink,
  Loader2,
  Route as RouteIcon,
  Trash2,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { categoryLabel, formatMeters, formatMinutes, formatSeconds } from '../lib/format';
import { usePlaces } from '../lib/hooks';
import type { ItineraryLeg, ItineraryResult, ItineraryStop } from '../lib/types';
import MapView from '../components/MapView';
import { Chip, EmptyState, Notice, SectionHeading, Skeleton } from '../components/ui';
import { Reveal } from '../components/layout';

const INTERESTS = [
  'history',
  'architecture',
  'afrobeat and music',
  'museums',
  'markets and textiles',
  'memory and heritage',
  'art and craft',
  'nature and conservation',
];

const START_PRESETS = [
  { label: 'Lagos Island (Marina)', lat: 6.4503, lng: 3.3936 },
  { label: 'Ikeja (Allen Avenue)', lat: 6.5939, lng: 3.3419 },
  { label: 'Victoria Island', lat: 6.4282, lng: 3.4213 },
  { label: 'Lekki Phase 1', lat: 6.4425, lng: 3.4713 },
];

export default function Plan() {
  const { places } = usePlaces();
  const [start, setStart] = useState({ lat: 6.4503, lng: 3.3936, label: 'Lagos Island (Marina)' });
  const [interests, setInterests] = useState<string[]>(['history', 'architecture']);
  const [availableMinutes, setAvailableMinutes] = useState(240);
  const [transportMode, setTransportMode] = useState<'walking' | 'driving'>('walking');
  const [maxStops, setMaxStops] = useState(4);
  const [accessibilityNotes, setAccessibilityNotes] = useState('');
  const [result, setResult] = useState<ItineraryResult | null>(null);
  const [stops, setStops] = useState<ItineraryStop[]>([]);
  const [legs, setLegs] = useState<ItineraryLeg[]>([]);
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const routeGeometry = useMemo(() => {
    if (legs.length === 0) return null;
    const coordinates = legs.flatMap((leg) => leg.geometry.coordinates);
    return coordinates.length > 1 ? { geometry: { type: 'LineString' as const, coordinates } } : null;
  }, [legs]);

  const totals = useMemo(() => {
    const visitMinutes = stops.reduce((sum, stop) => sum + stop.suggestedVisitMinutes, 0);
    const travelSeconds = legs.length > 0 ? legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) : null;
    const distanceMeters = legs.length > 0 ? legs.reduce((sum, leg) => sum + leg.distanceMeters, 0) : null;
    return {
      visitMinutes,
      travelSeconds,
      distanceMeters,
      totalMinutes: travelSeconds === null ? null : visitMinutes + travelSeconds / 60,
    };
  }, [stops, legs]);

  function useMyLocation() {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('This browser does not expose a location API. Choose a preset or a place below.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setStart({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: 'My current location',
        }),
      () =>
        setError(
          'Location permission was denied. Pick a preset start point or choose a place instead — nothing is blocked.',
        ),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const itinerary = await api.plan({
        start,
        interests,
        availableMinutes,
        transportMode,
        maxStops,
        accessibilityNotes: accessibilityNotes.trim() || undefined,
      });
      setResult(itinerary);
      setStops(itinerary.stops);
      setLegs(itinerary.legs);
    } catch (planError) {
      setResult(null);
      setStops([]);
      setLegs([]);
      setError(
        planError instanceof ApiClientError
          ? planError.message
          : 'The itinerary could not be planned. Nothing has been invented to fill the gap.',
      );
    } finally {
      setLoading(false);
    }
  }

  /** Recalculates every leg with the routing provider after the user edits stops. */
  async function recalculate(nextStops: ItineraryStop[]) {
    setRecalculating(true);
    setError(null);
    setNotice(null);

    const points = [
      { lat: start.lat, lng: start.lng, placeId: 'start', name: start.label },
      ...nextStops.map((stop) => ({
        lat: stop.coordinates.lat,
        lng: stop.coordinates.lng,
        placeId: stop.placeId,
        name: stop.name,
      })),
    ];

    const nextLegs: ItineraryLeg[] = [];
    try {
      for (let i = 0; i < points.length - 1; i += 1) {
        const from = points[i]!;
        const to = points[i + 1]!;
        if (Math.abs(from.lat - to.lat) < 1e-4 && Math.abs(from.lng - to.lng) < 1e-4) continue;
        const route = await api.directions(from, to, transportMode);
        nextLegs.push({
          fromPlaceId: from.placeId,
          toPlaceId: to.placeId,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          steps: route.steps,
          geometry: route.geometry,
        });
      }
      setLegs(nextLegs);
      setNotice(
        nextLegs.length === 0
          ? 'No legs to recalculate — the itinerary has fewer than two distinct points.'
          : `Recalculated ${nextLegs.length} leg${nextLegs.length === 1 ? '' : 's'} with the routing provider.`,
      );
    } catch (routeError) {
      setNotice(null);
      setError(
        routeError instanceof ApiClientError
          ? `Route recalculation failed: ${routeError.message}`
          : 'Route recalculation failed, so no travel estimate is shown for the edited itinerary.',
      );
      setLegs([]);
    } finally {
      setRecalculating(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    setStops(next);
    void recalculate(next);
  }

  function remove(index: number) {
    const next = stops.filter((_, position) => position !== index);
    setStops(next);
    void recalculate(next);
  }

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading
          eyebrow="AI itinerary planner"
          title="Tell it what you like and how long you have. It checks what is"
          accent="actually reachable."
          description="Gemma chooses stops from the database and explains each one. Travel distance and duration come from the routing provider, never from the model. Suggested visit times are labelled as suggestions, and if the plan does not fit your time you are told so."
        />
      </div>

      <div className="mx-auto mt-10 grid max-w-7xl grid-cols-1 gap-8 px-6 pb-24 sm:px-10 lg:grid-cols-12">
        {/* Form */}
        <div className="lg:col-span-5">
          <Reveal>
            <form
              className="card space-y-6 p-5 sm:p-6"
              onSubmit={(event) => {
                event.preventDefault();
                void generate();
              }}
            >
              <div>
                <p className="field-label">Starting point</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={useMyLocation} className="btn-secondary">
                    <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                    Use my location
                  </button>
                  {START_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setStart(preset)}
                      aria-pressed={start.label === preset.label}
                      className={`rounded-full px-3.5 py-2 text-xs transition-colors ${
                        start.label === preset.label
                          ? 'bg-brand-deep text-white'
                          : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {places.length > 0 && (
                  <label className="mt-4 block">
                    <span className="field-label">Or start from a place</span>
                    <select
                      className="field-input"
                      value={places.some((place) => place.name === start.label) ? start.label : ''}
                      onChange={(event) => {
                        const place = places.find((item) => item.name === event.target.value);
                        if (place) {
                          setStart({
                            lat: place.coordinates.lat,
                            lng: place.coordinates.lng,
                            label: place.name,
                          });
                        }
                      }}
                    >
                      <option value="">Choose a place…</option>
                      {places.map((place) => (
                        <option key={place.id} value={place.name}>
                          {place.name} — {place.neighbourhood}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <p className="mt-3 text-xs text-black/45">
                  Starting from: <span className="text-ink">{start.label}</span> ({start.lat.toFixed(4)},{' '}
                  {start.lng.toFixed(4)})
                </p>
              </div>

              <fieldset>
                <legend className="field-label">Interests</legend>
                <div className="flex flex-wrap gap-2">
                  {INTERESTS.map((interest) => {
                    const selected = interests.includes(interest);
                    return (
                      <button
                        key={interest}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setInterests((current) =>
                            selected ? current.filter((item) => item !== interest) : [...current, interest],
                          )
                        }
                        className={`rounded-full px-3.5 py-2 text-xs transition-colors ${
                          selected
                            ? 'bg-brand-deep text-white'
                            : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
                        }`}
                      >
                        {interest}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-4">
                <label>
                  <span className="field-label">Time available</span>
                  <select
                    className="field-input"
                    value={availableMinutes}
                    onChange={(event) => setAvailableMinutes(Number(event.target.value))}
                  >
                    {[60, 120, 180, 240, 360, 480].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {formatMinutes(minutes)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-label">Max stops</span>
                  <select
                    className="field-input"
                    value={maxStops}
                    onChange={(event) => setMaxStops(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map((count) => (
                      <option key={count} value={count}>
                        {count} stop{count === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset>
                <legend className="field-label">Transport</legend>
                <div className="flex gap-2">
                  {(['walking', 'driving'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTransportMode(mode)}
                      aria-pressed={transportMode === mode}
                      className={`rounded-full px-4 py-2 text-sm capitalize transition-colors ${
                        transportMode === mode
                          ? 'bg-brand-deep text-white'
                          : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-black/45">
                  Only walking and driving are offered. Public transport, danfo and live traffic are not integrated,
                  so they are never claimed.
                </p>
              </fieldset>

              <label>
                <span className="field-label">Accessibility needs (optional)</span>
                <input
                  type="text"
                  className="field-input"
                  placeholder="e.g. step-free access preferred"
                  value={accessibilityNotes}
                  onChange={(event) => setAccessibilityNotes(event.target.value)}
                  maxLength={200}
                />
              </label>

              <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Wand2 className="h-4 w-4" aria-hidden="true" />
                )}
                {loading ? 'Planning…' : 'Plan my cultural route'}
              </button>
            </form>
          </Reveal>
        </div>

        {/* Result */}
        <div className="space-y-6 lg:col-span-7">
          {error && <Notice tone="warn" title="Itinerary unavailable">{error}</Notice>}
          {notice && <Notice tone="brand">{notice}</Notice>}

          {loading && (
            <div className="space-y-4">
              <Skeleton className="h-[360px]" />
              <Skeleton className="h-24" />
            </div>
          )}

          {!loading && !result && (
            <EmptyState
              title="No itinerary yet"
              description="Set a starting point, pick at least one interest, and choose how much time you have. The planner will only use places that exist in ECHOES."
            >
              <RouteIcon className="h-5 w-5 text-brand-deep" aria-hidden="true" />
            </EmptyState>
          )}

          {result && (
            <>
              <Reveal>
                <div className="card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-2xl font-light tracking-tighter">{result.title}</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/60">{result.summary}</p>
                    </div>
                    <span className="rounded-full border border-black/15 px-2.5 py-0.5 text-[11px] text-black/55">
                      {result.mode === 'gemma' ? `Gemma · ${result.model}` : 'Database heuristic'}
                    </span>
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs uppercase tracking-widest text-black/40">Stops</dt>
                      <dd className="font-display text-xl tracking-tight">{stops.length}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-widest text-black/40">Visit time</dt>
                      <dd className="font-display text-xl tracking-tight">{formatMinutes(totals.visitMinutes)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-widest text-black/40">Travel</dt>
                      <dd className="font-display text-xl tracking-tight">
                        {totals.travelSeconds === null ? 'Unavailable' : formatSeconds(totals.travelSeconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-widest text-black/40">Total</dt>
                      <dd className="font-display text-xl tracking-tight">
                        {totals.totalMinutes === null ? 'Unavailable' : formatMinutes(totals.totalMinutes)}
                      </dd>
                    </div>
                  </dl>

                  {totals.distanceMeters !== null && (
                    <p className="mt-3 text-xs text-black/50">
                      Route distance {formatMeters(totals.distanceMeters)} · mode {result.transportMode} · source{' '}
                      {result.routingProviderNote ?? 'routing provider'}
                    </p>
                  )}

                  {result.withinAvailableTime === false && (
                    <div className="mt-4">
                      <Notice tone="warn" title="This plan does not fit the time you asked for">
                        The route needs about {formatMinutes(totals.totalMinutes ?? 0)} including travel and
                        suggested visit time, against {formatMinutes(availableMinutes)} available. Remove a stop, or
                        allow more time.
                      </Notice>
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap gap-3">
                    <a
                      href={result.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-primary"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Open in Google Maps
                    </a>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void recalculate(stops)}
                      disabled={recalculating || stops.length === 0}
                    >
                      <RouteIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      Recalculate route
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-black/45">
                    Navigation is performed by Google Maps. ECHOES hands over the ordered stops and returns you here
                    afterwards.
                  </p>
                </div>
              </Reveal>

              {recalculating && (
                <div className="flex items-center gap-3 text-sm text-black/55">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-deep" aria-hidden="true" />
                  Recalculating the route with the routing provider…
                </div>
              )}

              <MapView
                places={places}
                route={routeGeometry}
                markers={stops.map((stop) => ({
                  id: stop.placeId,
                  label: stop.name,
                  lat: stop.coordinates.lat,
                  lng: stop.coordinates.lng,
                  tone: 'stop' as const,
                }))}
                className="h-[360px]"
                showGaps={false}
              />

              <ol className="space-y-4">
                {stops.map((stop, index) => (
                  <li key={stop.placeId} className="card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-brand-deep">
                          {String(index + 1).padStart(2, '0')} · {categoryLabel(stop.category)} ·{' '}
                          {stop.neighbourhood}
                        </p>
                        <h3 className="mt-1 font-display text-xl font-light tracking-tighter">{stop.name}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-black/60">{stop.reason}</p>
                        <p className="mt-2 text-xs text-black/45">
                          Suggested visit: {formatMinutes(stop.suggestedVisitMinutes)} (suggestion, not a measurement)
                        </p>
                        {stop.openGaps.length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs text-[#7A5518]">
                            {stop.openGaps.slice(0, 2).map((gap) => (
                              <li key={gap} className="flex gap-2">
                                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                                {gap}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link to={`/places/${stop.placeId}`} className="btn-secondary">
                            Place profile
                          </Link>
                          <Link to={`/assistant?place=${stop.placeId}`} className="btn-secondary">
                            Ask about it
                          </Link>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          className="grid h-8 w-8 place-items-center rounded-full border border-black/15 text-black/50 hover:bg-black/[0.04] disabled:opacity-30"
                          aria-label={`Move ${stop.name} earlier`}
                        >
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={index === stops.length - 1}
                          className="grid h-8 w-8 place-items-center rounded-full border border-black/15 text-black/50 hover:bg-black/[0.04] disabled:opacity-30"
                          aria-label={`Move ${stop.name} later`}
                        >
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="grid h-8 w-8 place-items-center rounded-full border border-black/15 text-black/50 hover:bg-black/[0.04]"
                          aria-label={`Remove ${stop.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {legs[index] && (
                      <p className="mt-4 border-t border-black/10 pt-3 text-xs text-black/50">
                        To the next stop: {formatMeters(legs[index]!.distanceMeters)} ·{' '}
                        {formatSeconds(legs[index]!.durationSeconds)} by {result.transportMode}
                      </p>
                    )}
                  </li>
                ))}
              </ol>

              {stops.length === 0 && (
                <EmptyState
                  title="No stops left"
                  description="Every stop was removed. Generate the itinerary again to start over."
                />
              )}

              {result.limitations.length > 0 && (
                <div className="card p-5">
                  <p className="mb-2 text-xs uppercase tracking-widest text-black/40">Limitations</p>
                  <ul className="space-y-2 text-xs leading-relaxed text-black/55">
                    {result.limitations.map((limitation) => (
                      <li key={limitation}>• {limitation}</li>
                    ))}
                  </ul>
                  {result.notes && (
                    <ul className="mt-3 space-y-2 text-xs leading-relaxed text-black/45">
                      <li>• {result.notes.openingHours}</li>
                      <li>• {result.notes.liveTraffic}</li>
                      <li>• Travel time source: {result.notes.travelTimeSource}</li>
                    </ul>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {interests.slice(0, 4).map((interest) => (
                  <Chip key={interest}>{interest}</Chip>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

