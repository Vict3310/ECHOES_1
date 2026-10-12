import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, MapPinned, Ticket } from 'lucide-react';
import { api } from '../lib/api';
import { readStoredSession } from '../lib/auth';

export default function Account() {
  const session = readStoredSession();
  const bookingsQuery = useQuery({
    queryKey: ['bookings', session?.user.email],
    queryFn: () => api.bookings(session?.token, session?.user.email),
    enabled: Boolean(session),
  });

  const trips = bookingsQuery.data?.bookings ?? [];

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-32 sm:px-10">
        <div className="card p-8 text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">My account</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">Sign in to see your trips</h1>
          <Link to="/auth" className="btn-primary mt-6 justify-center">Login</Link>
        </div>
      </div>
    );
  }

  if (session.user.role === 'organizer') {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-32 sm:px-10">
        <div className="card p-8 text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Traveler account</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">Go to your guide dashboard</h1>
          <p className="mt-3 text-base text-black/60">This account is for travelers. Switch to your organizer profile to manage bookings and guide activity.</p>
          <Link to="/guide-dashboard" className="btn-primary mt-6 justify-center">Guide dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pt-32 sm:px-10">
      <div className="card p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Traveler account</p>
        <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">{session.user.name}</h1>
        <p className="mt-2 text-base text-black/60">{session.user.email}</p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        <div className="card p-5">
          <Ticket className="h-5 w-5 text-black/40" />
          <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">Trips</p>
          <p className="mt-2 font-display text-3xl tracking-tighter text-ink">{trips.length}</p>
        </div>
        <div className="card p-5">
          <CalendarDays className="h-5 w-5 text-black/40" />
          <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">Upcoming</p>
          <p className="mt-2 font-display text-3xl tracking-tighter text-ink">{trips.filter((trip) => trip.status !== 'failed').length}</p>
        </div>
        <div className="card p-5">
          <MapPinned className="h-5 w-5 text-black/40" />
          <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">Cities</p>
          <p className="mt-2 font-display text-3xl tracking-tighter text-ink">{new Set(trips.map((trip) => trip.experienceTitle)).size}</p>
        </div>
      </div>

      <div className="mt-10">
        <div className="mb-6 flex items-end justify-between gap-3">
          <h2 className="font-display text-3xl tracking-tighter text-ink">My trips</h2>
          <Link to="/experiences" className="inline-flex items-center gap-2 text-sm font-medium text-brand-deep">
            Book more
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {bookingsQuery.isLoading && <div className="text-sm text-black/60">Loading your trips…</div>}
        {bookingsQuery.isError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Your booking history could not be loaded right now.
          </div>
        )}

        <div className="space-y-4">
          {trips.length === 0 && !bookingsQuery.isLoading && (
            <div className="card p-5 text-sm text-black/60">No trips yet. Start by booking a cultural experience.</div>
          )}

          {trips.map((trip) => (
            <div key={trip.reference} className="card flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
              <div>
                <h3 className="font-display text-2xl tracking-tighter text-ink">{trip.experienceTitle}</h3>
                <p className="mt-1 text-sm text-black/60">{new Date(trip.createdAt).toLocaleDateString()} · {trip.participants} guest(s)</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-[#f3ecdf] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-black/50">
                  {trip.status}
                </span>
                <span className="text-sm font-medium text-brand-deep">{trip.reference}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
