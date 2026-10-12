import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { Place } from '../lib/types';
import { track } from '../lib/tracker';

/** Minimal route shape so both a single route and a joined itinerary can be drawn. */
export interface DrawableRoute {
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
}
import { categoryLabel } from '../lib/format';

const LAGOS_CENTRE: [number, number] = [6.455, 3.395];

const TILE_URL =
  (import.meta.env.VITE_TILE_URL as string | undefined) ??
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_TILE_ATTRIBUTION as string | undefined) ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface MapViewProps {
  places: Place[];
  activeId?: string | null;
  onSelect?: (place: Place) => void;
  route?: DrawableRoute | null;
  /** Extra labelled markers, e.g. the visitor's start point. */
  markers?: Array<{ id: string; label: string; lat: number; lng: number; tone?: 'start' | 'stop' }>;
  className?: string;
  showGaps?: boolean;
}

function markerIcon(options: { active: boolean; gap: boolean; label: string }) {
  const safe = options.label.replace(/[<>&"]/g, '');
  return L.divIcon({
    className: '',
    html: `<div class="echoes-marker" data-active="${options.active}" data-gap="${options.gap}"><span>${safe}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

export function MapView({
  places,
  activeId,
  onSelect,
  route,
  markers = [],
  className = 'h-[520px]',
  showGaps = true,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const [tilesDegraded, setTilesDegraded] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  // Initialise once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Counted once per mounted map, whichever page hosts it.
    track('map_opened', { interaction: 'open' });

    const map = L.map(containerRef.current, {
      center: LAGOS_CENTRE,
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false, // avoid trapping page scroll; +/- and drag still work
    });

    const tiles = L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
    });

    let errors = 0;
    tiles.on('tileerror', () => {
      errors += 1;
      if (errors > 6) setTilesDegraded(true);
      if (errors > 24) setTilesFailed(true);
    });
    tiles.on('tileload', () => setTilesDegraded(false));
    tiles.addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

  // Place markers.
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const place of places) {
      const active = place.id === activeId;
      const gap = showGaps && Boolean(place.knowledge?.needsResearch);
      const initials = place.name
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] ?? '')
        .join('')
        .toUpperCase();

      const marker = L.marker([place.coordinates.lat, place.coordinates.lng], {
        icon: markerIcon({ active, gap, label: initials }),
        title: place.name,
        alt: `${place.name}, ${categoryLabel(place.category)}${gap ? ', records incomplete' : ''}`,
        keyboard: true,
      });

      marker.bindPopup(
        `<strong>${place.name}</strong><br/>${categoryLabel(place.category)} · ${place.neighbourhood}` +
          (place.knowledge
            ? `<br/><span style="color:#8A5518">${
                place.knowledge.gaps.length
              } gap(s) in the sources checked</span>`
            : ''),
      );

      if (onSelect) marker.on('click', () => onSelect(place));
      marker.addTo(layer);
    }
  }, [places, activeId, onSelect, showGaps]);

  // Start / stop markers.
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer || markers.length === 0) return;
    for (const item of markers) {
      L.marker([item.lat, item.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="echoes-marker" data-active="true" data-gap="false"><span>${item.tone === 'start' ? 'A' : '•'}</span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: item.label,
      })
        .bindPopup(item.label)
        .addTo(layer);
    }
  }, [markers]);

  // Route geometry.
  useEffect(() => {
    const layer = routeLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!route?.geometry?.coordinates?.length) return;

    const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
    L.polyline(latlngs, {
      color: '#1E4D33',
      weight: 5,
      opacity: 0.85,
      lineJoin: 'round',
    }).addTo(layer);

    const map = mapRef.current;
    if (map) map.fitBounds(L.latLngBounds(latlngs).pad(0.25));
  }, [route]);

  // Recentre on selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeId) return;
    const place = places.find((item) => item.id === activeId);
    if (!place) return;
    map.setView([place.coordinates.lat, place.coordinates.lng], Math.max(map.getZoom(), 14), {
      animate: true,
    });
  }, [activeId, places]);

  const centre = useMemo(() => {
    if (activeId) {
      const place = places.find((item) => item.id === activeId);
      if (place) return [place.coordinates.lat, place.coordinates.lng] as [number, number];
    }
    return LAGOS_CENTRE;
  }, [activeId, places]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="echoes-map h-full w-full overflow-hidden rounded-2xl border border-black/10"
        role="application"
        aria-label={`Map of ${places.length} cultural places in Lagos. Recentred on ${centre[0].toFixed(3)}, ${centre[1].toFixed(3)}.`}
      />

      {tilesDegraded && !tilesFailed && (
        <p className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-xl bg-cream/95 px-3 py-2 text-[11px] text-black/60 shadow">
          Some map tiles did not load. Marker positions are still accurate.
        </p>
      )}

      {tilesFailed && (
        <div className="absolute inset-0 grid place-items-center rounded-2xl bg-cream/95 p-6 text-center">
          <div className="max-w-md">
            <p className="font-display text-base tracking-tight">Map tiles could not be loaded</p>
            <p className="mt-2 text-sm leading-relaxed text-black/60">
              The tile provider did not respond. Every place below is still available as a list, with coordinates,
              sources and directions, so nothing is blocked by the map.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapView;
