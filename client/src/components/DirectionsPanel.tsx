import { useState } from 'react';
import { Crosshair, ExternalLink, Loader2, Navigation, TriangleAlert } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { formatMeters, formatSeconds } from '../lib/format';
import type { Place, RouteResult } from '../lib/types';

type Mode = 'walking' | 'driving';

/** Minimal shape needed to offer a place as a starting point. */
export interface StartCandidate {
  id: string;
  name: string;
  neighbourhood?: string;
  coordinates: { lat: number; lng: number };
}

export interface DirectionsPanelProps {
  destination: Pick<Place, 'id' | 'name' | 'coordinates' | 'coordinateAccuracy'>;
  /** Optional start supplied by the map or the page. */
  initialStart?: { lat: number; lng: number; label: string } | null;
  candidates?: StartCandidate[];
  onRoute?: (route: RouteResult | null) => void;
  onStartChange?: (start: { lat: number; lng: number; label: string } | null) => void;
}

export function DirectionsPanel({
  destination,
  initialStart = null,
  candidates = [],
  onRoute,
  onStartChange,
}: DirectionsPanelProps) {
  const [mode, setMode] = useState<Mode>('walking');
  const [start, setStart] = useState<{ lat: number; lng: number; label: string } | null>(initialStart);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  function updateStart(next: { lat: number; lng: number; label: string } | null) {
    setStart(next);
    onStartChange?.(next);
    setRoute(null);
    onRoute?.(null);
  }

  function requestLocation() {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('This browser does not expose a location API. Enter a starting point manually instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        updateStart({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: 'My current location',
        });
      },
      (geoError) => {
        setLocating(false);
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location permission was denied. You can still enter a starting point manually below.'
            : 'Your location could not be determined. Enter a starting point manually instead.',
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  async function fetchRoute() {
    if (!start) {
      setError('Choose a starting point first — your location, a place, or coordinates.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.directions(
        { lat: start.lat, lng: start.lng },
        { lat: destination.coordinates.lat, lng: destination.coordinates.lng },
        mode,
      );
      setRoute(result);
      onRoute?.(result);
    } catch (routeError) {
      setRoute(null);
      onRoute?.(null);
      setError(
        routeError instanceof ApiClientError
          ? routeError.message
          : 'The route could not be calculated. No distance or duration is shown.',
      );
    } finally {
      setLoading(false);
    }
  }

  const googleUrl = start
    ? `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${destination.coordinates.lat},${destination.coordinates.lng}&travelmode=${mode === 'walking' ? 'walking' : 'driving'}`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination.coordinates.lat},${destination.coordinates.lng}&travelmode=${mode === 'walking' ? 'walking' : 'driving'}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-black/40">Get directions to</p>
        <p className="font-display text-lg tracking-tight">{destination.name}</p>
        <p className="text-xs text-black/45">
          {destination.coordinates.lat.toFixed(5)}, {destination.coordinates.lng.toFixed(5)} ·{' '}
          {destination.coordinateAccuracy === 'approximate' ? 'approximate coordinates' : 'surveyed coordinates'}
        </p>
      </div>

      <fieldset>
        <legend className="field-label">Transport mode</legend>
        <div className="flex gap-2" role="group" aria-label="Transport mode">
          {(['walking', 'driving'] as Mode[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setMode(option);
                setRoute(null);
                onRoute?.(null);
              }}
              aria-pressed={mode === option}
              className={`rounded-full px-4 py-2 text-sm transition-colors ${
                mode === option
                  ? 'bg-brand-deep text-white'
                  : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
              }`}
            >
              {option === 'walking' ? 'Walking' : 'Driving'}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="rounded-2xl border border-black/10 bg-white/60 p-4">
        <p className="text-xs uppercase tracking-widest text-black/40">Starting point</p>
        <p className="mt-2 text-xs leading-relaxed text-black/55">
          ECHOES can ask your browser for your position to calculate this route. It is sent to the routing provider
          as the start point and is not stored by ECHOES.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={requestLocation} className="btn-secondary" disabled={locating}>
            {locating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Use my location
          </button>
          {start && (
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-deep/20 bg-brand-soft/60 px-3 py-1.5 text-xs text-brand-deep">
              {start.label}
              <button type="button" onClick={() => updateStart(null)} className="underline">
                clear
              </button>
            </span>
          )}
        </div>

        {candidates.length > 0 && (
          <label className="mt-4 block">
            <span className="field-label">Or start from a place</span>
            <select
              className="field-input"
              value={start && candidates.some((candidate) => candidate.name === start.label) ? start.label : ''}
              onChange={(event) => {
                const place = candidates.find((candidate) => candidate.name === event.target.value);
                if (!place) return updateStart(null);
                updateStart({
                  lat: place.coordinates.lat,
                  lng: place.coordinates.lng,
                  label: place.name,
                });
              }}
            >
              <option value="">Choose a starting place…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.name}>
                  {candidate.name} — {candidate.neighbourhood}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label>
            <span className="field-label">Latitude</span>
            <input
              type="number"
              step="0.0001"
              className="field-input"
              value={start?.lat ?? ''}
              onChange={(event) =>
                updateStart({
                  lat: Number(event.target.value),
                  lng: start?.lng ?? destination.coordinates.lng,
                  label: 'Manual entry',
                })
              }
            />
          </label>
          <label>
            <span className="field-label">Longitude</span>
            <input
              type="number"
              step="0.0001"
              className="field-input"
              value={start?.lng ?? ''}
              onChange={(event) =>
                updateStart({
                  lat: start?.lat ?? destination.coordinates.lat,
                  lng: Number(event.target.value),
                  label: 'Manual entry',
                })
              }
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={fetchRoute} className="btn-primary" disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Navigation className="h-4 w-4" aria-hidden="true" />
          )}
          Calculate route
        </button>
        <a href={googleUrl} target="_blank" rel="noreferrer noopener" className="btn-secondary">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open in Google Maps
        </a>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-[#B4432A]/25 bg-[#B4432A]/[0.06] px-4 py-3 text-sm text-[#7A2C1B]">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">{error}</p>
        </div>
      )}

      {route && (
        <div className="rounded-2xl border border-brand-deep/20 bg-brand-soft/50 p-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-widest text-black/40">Distance</dt>
              <dd className="font-display text-lg tracking-tight">{formatMeters(route.distanceMeters)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-widest text-black/40">Estimated time</dt>
              <dd className="font-display text-lg tracking-tight">{formatSeconds(route.durationSeconds)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-widest text-black/40">Mode</dt>
              <dd className="font-display text-lg tracking-tight capitalize">{route.mode}</dd>
            </div>
          </dl>

          <p className="mt-3 text-xs leading-relaxed text-black/55">
            Data source: <span className="font-medium">{route.provider}</span>. {route.providerNote}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-black/50">
            {route.limitations.map((limitation) => (
              <li key={limitation}>• {limitation}</li>
            ))}
          </ul>

          {route.steps.length > 0 && (
            <div className="mt-4">
              <button type="button" className="btn-secondary" onClick={() => setShowSteps((value) => !value)}>
                {showSteps ? 'Hide' : 'Show'} turn-by-turn steps ({route.steps.length})
              </button>
              {showSteps && (
                <ol className="mt-3 space-y-2 text-sm text-black/70">
                  {route.steps.map((step, index) => (
                    <li key={`${step.instruction}-${index}`} className="flex gap-3">
                      <span className="text-xs text-black/35">{index + 1}</span>
                      <span>
                        {step.instruction}
                        <span className="ml-2 text-xs text-black/40">
                          {formatMeters(step.distanceMeters)} · {formatSeconds(step.durationSeconds)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <p className="mt-3 text-xs leading-relaxed text-black/45">{route.navigationNote}</p>
        </div>
      )}
    </div>
  );
}

export default DirectionsPanel;
