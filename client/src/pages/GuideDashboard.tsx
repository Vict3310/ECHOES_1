import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, MapPinned, Star, Users } from 'lucide-react';
import { api } from '../lib/api';
import { readStoredSession } from '../lib/auth';
import { GuideApplication } from '../components/GuideApplication';

export default function GuideDashboard() {
  const session = readStoredSession();
  const bookingsQuery = useQuery({
    queryKey: ['guide-bookings', session?.user.email],
    queryFn: () => api.bookings(session?.token, session?.user.email),
    enabled: Boolean(session),
  });

  const bookings = bookingsQuery.data?.bookings ?? [];

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-32 sm:px-10">
        <div className="card p-8 text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Guide access</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">Login to manage your guide profile</h1>
          <Link to="/auth" className="btn-primary mt-6 justify-center">Go to login</Link>
        </div>
      </div>
    );
  }

  if (session.user.role !== 'organizer') {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-32 sm:px-10">
        <div className="card p-8 text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Traveler account</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">This dashboard is for guides</h1>
          <p className="mt-3 text-base text-black/60">Your current session is set up as a traveler. Open the traveler account to manage trips and bookings.</p>
          <Link to="/account" className="btn-primary mt-6 justify-center">Traveler account</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pt-32 sm:px-10">
      <div className="card p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Guide dashboard</p>
            <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">Hi, {session.user.name}</h1>
          </div>
          <Link to="/guides" className="btn-secondary">Browse all guides</Link>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
            <Users className="h-4 w-4 text-black/40" />
            <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">Bookings</p>
            <p className="mt-2 font-display text-3xl tracking-tighter text-ink">{bookings.length}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
            <Star className="h-4 w-4 text-black/40" />
            <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">Rating</p>
            <p className="mt-2 font-display text-3xl tracking-tighter text-ink">4.9</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
            <CalendarClock className="h-4 w-4 text-black/40" />
            <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">This week</p>
            <p className="mt-2 font-display text-3xl tracking-tighter text-ink">{bookings.filter((booking) => booking.status !== 'failed').length}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-[#f7f2eb] p-4">
            <MapPinned className="h-4 w-4 text-black/40" />
            <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">Regions</p>
            <p className="mt-2 font-display text-3xl tracking-tighter text-ink">{new Set(bookings.map((booking) => booking.experienceTitle)).size || 0}</p>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <GuideApplication token={session.token} defaultName={session.user.name} />
      </div>

      <div className="mt-10">
        <h2 className="font-display text-3xl tracking-tighter text-ink">Recent bookings</h2>
        {bookingsQuery.isLoading && <div className="mt-4 text-sm text-black/60">Loading booking activity…</div>}
        {bookingsQuery.isError && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Booking activity could not be loaded.
          </div>
        )}
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bookings.length === 0 && !bookingsQuery.isLoading && (
            <div className="card p-5 text-sm text-black/60 md:col-span-2 xl:col-span-3">
              No bookings have been recorded for this guide yet.
            </div>
          )}
          {bookings.map((booking) => (
            <article key={booking.reference} className="card p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-2xl tracking-tighter text-ink">{booking.experienceTitle}</h3>
                <span className="rounded-full bg-[#f3ecdf] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-black/50">
                  {booking.status}
                </span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-black/60">
                <p>{booking.participants} guest(s)</p>
                <p>{booking.customerName}</p>
                <p>{booking.reference}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
