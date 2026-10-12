import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, MapPin, ShieldCheck, Star } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import MapView from '../components/MapView';
import { api } from '../lib/api';
import type { Place } from '../lib/types';

const sampleReviews = [
  { name: 'Aisha', quote: 'Warm, thoughtful and deeply rooted in the local story of the area.' },
  { name: 'Tobi', quote: 'Very easy to follow, and genuinely made the day feel personal.' },
  { name: 'Mina', quote: 'Clear recommendations, great pacing and a lot of local context.' },
];

const ratingBreakdown = [
  { label: '5 stars', value: 78 },
  { label: '4 stars', value: 18 },
  { label: '3 stars', value: 4 },
];

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

export default function GuideDetail() {
  const { id = '' } = useParams();
  const guideQuery = useQuery({
    queryKey: ['guide', id],
    queryFn: () => api.guide(id),
    enabled: Boolean(id),
  });

  const guide = guideQuery.data?.guide;
  const guideAvatarUrl = guide?.avatarUrl || (guide ? getMockProfilePhoto(guide.id, guide.name) : null);
  const guideMapPlace = guide
    ? ({
        id: `${guide.id}-city`,
        name: guide.city,
        category: 'cultural-landmark',
        neighbourhood: guide.city,
        address: `${guide.city}, Nigeria`,
        coordinates: cityCoordinates[guide.city] ?? { lat: 6.5244, lng: 3.3792 },
        coordinateAccuracy: 'approximate',
        summary: guide.bio,
        history: guide.bio,
        tags: guide.specialties,
        sources: [],
        coverage: {
          coordinates: { status: 'available', evidence: 'City coordinates from OpenStreetMap.' },
          encyclopedicArticle: { status: 'available', evidence: 'Local city profile data.' },
          structuredFacts: { status: 'available', evidence: 'Guide city metadata.' },
          image: { status: 'missing', evidence: 'No city image yet.' },
          citations: { status: 'available', evidence: 'Map data from OpenStreetMap.' },
          communityStory: { status: 'missing', evidence: 'No community story yet.' },
          verifiedExperience: { status: 'available', evidence: 'Guide route coverage.' },
        },
        knowledge: {
          placeId: `${guide.id}-city`,
          statuses: {
            coordinates: 'available',
            encyclopedicArticle: 'available',
            structuredFacts: 'available',
            image: 'missing',
            citations: 'available',
            communityStory: 'missing',
            verifiedExperience: 'available',
          },
          gaps: [],
          needsResearch: false,
          coveredDimensions: 5,
          totalDimensions: 7,
          explanation: 'City-level location data for the guide service area.',
        },
      } as Partial<Place> as Place)
    : null;

  if (guideQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 pt-32 sm:px-10">
        <div className="card p-8 text-sm text-black/60">Loading guide profile…</div>
      </div>
    );
  }

  if (guideQuery.isError || !guide) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-32 sm:px-10">
        <div className="card p-8 text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Guide profile</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">This guide is unavailable</h1>
          <Link to="/guides" className="btn-primary mt-6 justify-center">Back to guides</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 pt-32 sm:px-10">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="card overflow-hidden rounded-[28px] p-4 sm:p-5">
            <div className="flex items-center gap-4">
              {guideAvatarUrl ? (
                <img src={guideAvatarUrl} alt={`${guide.name}, ${guide.role}`} className="h-20 w-20 rounded-full object-cover ring-2 ring-black/5" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#1d2a26] via-[#46635a] to-[#c39059] text-[9px] uppercase tracking-[0.18em] text-white/60">
                  Photo
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-brand-deep">Local guide</p>
                    <h1 className="mt-1 font-display text-2xl tracking-tighter text-ink sm:text-3xl">{guide.name}</h1>
                    <p className="mt-1 text-sm text-brand-deep">{guide.role}</p>
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-full bg-[#f3ecdf] px-2.5 py-1.5 text-xs font-medium text-ink">
                    <Star className="h-3.5 w-3.5 fill-current text-yellow-400" />
                    {guide.rating} · 128 reviews
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5">

              <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-black/60">
                <span className="inline-flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-black/40" />
                  {guide.city}
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-brand-deep" />
                  Verified local expert
                </span>
              </div>

              <p className="mt-6 text-base leading-relaxed text-black/70">{guide.bio}</p>

              <div className="mt-6 flex flex-wrap gap-2">
                {guide.specialties.map((specialty) => (
                  <span key={specialty} className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-black/50">
                    {specialty}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">What travelers say</p>
            <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-black/40">Overall rating</p>
                <div className="mt-3 flex items-end gap-2">
                  <span className="font-display text-5xl tracking-tighter text-ink">{guide.rating}</span>
                  <Star className="mb-2 h-5 w-5 fill-current text-yellow-400" />
                </div>
                <p className="mt-2 text-sm text-black/60">Based on 128 reviews</p>
                <div className="mt-5 space-y-2">
                  {ratingBreakdown.map((row) => (
                    <div key={row.label} className="grid grid-cols-[72px_1fr_42px] items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-black/45">
                      <span>{row.label}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-black/10">
                        <div className="h-full rounded-full bg-brand-deep" style={{ width: `${row.value}%` }} />
                      </div>
                      <span>{row.value}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                {sampleReviews.map((review) => (
                  <blockquote key={review.name} className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4 text-sm leading-relaxed text-black/65">
                    “{review.quote}”
                    <footer className="mt-2 font-medium text-black/75">— {review.name}</footer>
                  </blockquote>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="card p-6 sm:p-7">
            <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Booking</p>
            <p className="mt-4 font-display text-3xl tracking-tighter text-ink">{guide.priceFrom}</p>
            <p className="mt-2 text-sm text-black/60">Starting price for a custom local route.</p>

            <div className="mt-5 space-y-3 text-sm text-black/60">
              <div className="flex items-center justify-between border-b border-black/10 pb-2">
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-black/40" /> Availability</span>
                <span className="font-medium text-black/75">{guide.availability}</span>
              </div>
              <div className="flex items-center justify-between border-b border-black/10 pb-2">
                <span>Languages</span>
                <span className="font-medium text-black/75">English</span>
              </div>
              <div className="flex items-center justify-between border-b border-black/10 pb-2">
                <span>Experience</span>
                <span className="font-medium text-black/75">Local insights</span>
              </div>
            </div>

            <div className="mt-6 grid gap-2">
              <Link to="/experiences" className="btn-primary justify-center">
                Book now
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/guides" className="btn-secondary justify-center">
                Back to guides
              </Link>
            </div>
          </div>

          <div className="card p-6 sm:p-7">
            <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Map</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-black/10">
              {guideMapPlace ? (
                <MapView places={[guideMapPlace]} activeId={guideMapPlace.id} className="h-52" showGaps={false} />
              ) : (
                <div className="grid h-52 place-items-center bg-[#f7f2eb] text-sm text-black/60">
                  Finding location…
                </div>
              )}
            </div>
            <p className="mt-3 text-sm text-black/60">{guide.city} area · OpenStreetMap location data · easy local access</p>
          </div>

          <div className="card p-6 sm:p-7">
            <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Why travelers choose this guide</p>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-black/65">
              <li>• Strong local knowledge with transparent recommendations</li>
              <li>• Flexible routes built around traveler interests</li>
              <li>• High-trust, highly rated local discovery experience</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
