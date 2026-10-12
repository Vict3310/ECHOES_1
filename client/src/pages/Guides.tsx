import { ArrowRight, MapPin, Navigation, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const cityCoordinates: Record<string, { lat: number; lng: number }> = {
  Lagos: { lat: 6.5244, lng: 3.3792 },
  Abuja: { lat: 9.0765, lng: 7.3986 },
  Ibadan: { lat: 7.3775, lng: 3.947 },
  Kano: { lat: 12.0022, lng: 8.592 },
  PortHarcourt: { lat: 4.8156, lng: 7.0498 },
  Enugu: { lat: 6.5244, lng: 7.4954 },
  Calabar: { lat: 4.9581, lng: 8.3417 },
  Jos: { lat: 9.8965, lng: 8.8583 },
  Uyo: { lat: 5.0371, lng: 7.9128 },
  Benin: { lat: 6.335, lng: 5.6037 },
};

const guideReviews: Record<string, Array<{ name: string; quote: string }>> = {
  'guide-1': [
    { name: 'Aisha', quote: 'He made the city feel personal and easy to understand.' },
    { name: 'Tobi', quote: 'Insightful stops, great pacing, and warm local insight.' },
  ],
  'guide-2': [
    { name: 'Mina', quote: 'A brilliant storyteller with strong local knowledge.' },
    { name: 'Kemi', quote: 'We felt safe, informed, and looked after the whole way.' },
  ],
  'guide-3': [
    { name: 'Daniel', quote: 'Perfect for people who want history without the lecture vibe.' },
    { name: 'Zainab', quote: 'The route felt authentic and very well planned.' },
  ],
};

const mockProfilePhotos = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
];

function getMockProfilePhoto(id?: string, name?: string) {
  const seed = String(id ?? name ?? 'guide');
  const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % mockProfilePhotos.length;
  return mockProfilePhotos[index];
}

function formatDistance(distanceKm: number | null) {
  if (distanceKm === null) return 'Local specialist';
  if (distanceKm < 1) return 'Less than 1 km away';
  return `${distanceKm.toFixed(1)} km away`;
}

function getDistanceKm(from: { lat: number; lng: number }, to?: { lat: number; lng: number } | null) {
  if (!to) return null;
  const earthRadiusKm = 6371;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export default function Guides() {
  const [search, setSearch] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('all');
  const [nearMe, setNearMe] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  const guidesQuery = useQuery({
    queryKey: ['guides'],
    queryFn: () => api.guides(),
  });

  useEffect(() => {
    if (!nearMe || !navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        setNearMe(false);
        setLocation(null);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [nearMe]);

  const guides = useMemo(() => {
    const result = (guidesQuery.data?.guides ?? []).map((guide) => {
      const reviews = guideReviews[guide.id] ?? [
        { name: 'Traveler', quote: 'A thoughtful guide with a strong local perspective.' },
      ];
      const distanceKm = location ? getDistanceKm(location, cityCoordinates[guide.city] ?? null) : null;

      return {
        ...guide,
        avatarUrl: guide.avatarUrl || getMockProfilePhoto(guide.id, guide.name),
        reviews,
        reviewCount: 18 + Math.round(guide.rating * 18),
        distanceKm,
      };
    });

    const filtered = result.filter((guide) => {
      const haystack = [
        guide.name,
        guide.role,
        guide.city,
        guide.bio,
        ...(guide.specialties ?? []),
      ]
        .join(' ')
        .toLowerCase();

      const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase());
      const matchesSpecialty =
        selectedSpecialty === 'all' || guide.specialties.some((specialty) => specialty.toLowerCase() === selectedSpecialty.toLowerCase());

      return matchesSearch && matchesSpecialty;
    });

    return filtered.sort((a, b) => {
      if (location) {
        return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
      }
      return b.rating - a.rating;
    });
  }, [guidesQuery.data, location, nearMe, search, selectedSpecialty]);

  const specialtyOptions = useMemo(() => {
    const values = new Set((guidesQuery.data?.guides ?? []).flatMap((guide) => guide.specialties));
    return ['all', ...Array.from(values).slice(0, 8)];
  }, [guidesQuery.data]);

  return (
    <div className="mx-auto max-w-7xl px-6 pt-32 sm:px-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Guide marketplace</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink sm:text-5xl">Find a local guide</h1>
        </div>
        <Link to="/auth?role=organizer" className="btn-primary">
          Become a guide
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-8 rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <label className="relative block flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by city, specialty, or guide name"
              className="field-input pl-11"
            />
          </label>

          <button
            type="button"
            onClick={() => setNearMe((current) => !current)}
            className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
              nearMe ? 'border-brand-deep bg-brand-deep text-white' : 'border-black/10 bg-white text-ink'
            }`}
          >
            <Navigation className="h-4 w-4" />
            Near me
          </button>
        </div>

        {specialtyOptions.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {specialtyOptions.map((specialty) => {
              const label = specialty === 'all' ? 'All guides' : specialty;
              const selected = selectedSpecialty === specialty;

              return (
                <button
                  key={specialty}
                  type="button"
                  onClick={() => setSelectedSpecialty(specialty)}
                  className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition ${
                    selected ? 'border-brand-deep bg-brand-deep text-white' : 'border-black/10 bg-white text-black/60'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {guidesQuery.isLoading && <div className="mt-8 text-sm text-black/60">Loading guide profiles…</div>}
      {guidesQuery.isError && (
        <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          The guide marketplace is currently unavailable.
        </div>
      )}

      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {guides.map((guide) => (
          <article key={guide.id} className="card overflow-hidden p-3">
            <div className="flex items-center gap-3">
              {guide.avatarUrl ? (
                <img
                  src={guide.avatarUrl}
                  alt={`${guide.name}, ${guide.role}`}
                  loading="lazy"
                  className="h-14 w-14 rounded-full object-cover ring-2 ring-black/5"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#1d2a26] via-[#46635a] to-[#c39059] text-[8px] uppercase tracking-[0.16em] text-white/60">
                  Photo
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg tracking-tighter text-ink">{guide.name}</h2>
                    <p className="mt-0.5 text-[11px] text-brand-deep">{guide.role}</p>
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full bg-[#f3ecdf] px-2 py-1 text-[10px] font-medium text-ink">
                    <Star className="h-3 w-3 fill-current text-yellow-400" />
                    {guide.rating}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3">

              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-black/60">
                <div className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-black/40" />
                  {guide.city}
                </div>
                {location && (
                  <span className="text-[10px] font-medium text-brand-deep">{formatDistance(guide.distanceKm)}</span>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.14em] text-black/45">
                <span>{guide.reviewCount} reviews</span>
                <span>{guide.availability}</span>
              </div>

              <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-black/60">{guide.bio}</p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {guide.specialties.slice(0, 3).map((specialty) => (
                  <span key={specialty} className="rounded-full border border-black/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-black/50">
                    {specialty}
                  </span>
                ))}
              </div>

              <div className="mt-3 rounded-xl border border-black/10 bg-[#f7f2eb] p-2.5">
                <p className="text-[9px] uppercase tracking-[0.14em] text-black/40">Recent review</p>
                <p className="mt-1 text-[11px] leading-relaxed text-black/60">
                  “{guide.reviews[0]?.quote ?? 'Thoughtful local guidance.'}”
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-3 text-[9px] uppercase tracking-[0.14em] text-black/45">
                <span>{guide.availability}</span>
                <span>{guide.priceFrom}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link to={`/guides/${guide.id}`} className="btn-secondary justify-center px-2 py-2 text-[10px] sm:text-xs">
                  View profile
                </Link>
                <Link to="/experiences" className="btn-primary justify-center px-2 py-2 text-[10px] sm:text-xs">
                  Book now
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>

      {guides.length === 0 && !guidesQuery.isLoading && (
        <div className="mt-10 rounded-2xl border border-black/10 bg-[#f7f2eb] p-6 text-sm text-black/60">
          No guides match that search yet. Try a broader keyword or switch back to all specialties.
        </div>
      )}
    </div>
  );
}
