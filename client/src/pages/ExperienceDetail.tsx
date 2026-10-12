import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, ExternalLink, Loader2, ShieldCheck, Users } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { readStoredSession } from '../lib/auth';
import { formatDateTime, formatMinutes, formatMoney } from '../lib/format';
import type { CheckoutResult } from '../lib/types';
import { Chip, ErrorState, Notice, Skeleton } from '../components/ui';
import { Reveal } from '../components/layout';
import UseALATPay from 'react-alatpay';

const ALATPAY_PUBLIC_KEY = import.meta.env.VITE_ALATPAY_PUBLIC_KEY as string | undefined;
const ALATPAY_BUSINESS_ID = import.meta.env.VITE_ALATPAY_BUSINESS_ID as string | undefined;

export default function ExperienceDetail() {
  const { id = '' } = useParams();
  const session = readStoredSession();
  const [scheduleId, setScheduleId] = useState('');
  const [participants, setParticipants] = useState(1);
  const [customerName, setCustomerName] = useState(session?.user.name ?? '');
  const [customerEmail, setCustomerEmail] = useState(session?.user.email ?? '');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ path: string; message: string }>>([]);

  useEffect(() => {
    if (session) {
      setCustomerName(session.user.name);
      setCustomerEmail(session.user.email);
    }
  }, [session]);

  const query = useQuery({
    queryKey: ['experience', id],
    queryFn: () => api.experience(id),
    enabled: Boolean(id),
  });

  const experience = query.data?.experience;
  const availableSchedules = useMemo(
    () => (experience?.schedules ?? []).filter((schedule) => !schedule.soldOut),
    [experience],
  );
  const selectedSchedule = experience?.schedules.find((schedule) => schedule.scheduleId === scheduleId);
  const totalMinor = experience ? experience.priceMinor * participants : 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors([]);
    if (!experience) return;
    if (!session) {
      setError('Please sign in to book this experience.');
      return;
    }

    const chosen = scheduleId || availableSchedules[0]?.scheduleId;
    if (!chosen) {
      setError('There is no available date for this experience, so no booking can be created.');
      return;
    }

    if (!ALATPAY_PUBLIC_KEY || !ALATPAY_BUSINESS_ID) {
      setError('ALATPay is not fully configured in the frontend env. Add VITE_ALATPAY_PUBLIC_KEY and VITE_ALATPAY_BUSINESS_ID.');
      return;
    }

    setLoading(true);
    try {
      const result = await api.book({
        experienceId: experience.id,
        scheduleId: chosen,
        participants,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim() || null,
        notes: notes.trim() || null,
      });
      setCheckout(result);

      if (result.payment.simulated) {
        setLoading(false);
        return;
      }

      const [firstName, ...rest] = customerName.trim().split(/\s+/);
      const lastName = rest.join(' ') || 'Customer';

      const alatpay = UseALATPay({
        amount: Number((result.booking.totalMinor / 100).toFixed(2)),
        apiKey: ALATPAY_PUBLIC_KEY,
        businessId: ALATPAY_BUSINESS_ID,
        color: '#0f172a',
        currency: result.booking.currency,
        email: customerEmail.trim(),
        firstName: firstName || 'Customer',
        lastName,
        metadata: {
          bookingReference: result.booking.reference,
          paymentReference: result.payment.reference,
          experienceId: experience.id,
          scheduleId: chosen,
          participants: String(participants),
        } as any,
        phone: customerPhone.trim() || undefined,
        onClose: () => {
          setLoading(false);
        },
        onTransaction: (response: any) => {
          console.log('ALATPay transaction response:', response);
          setLoading(false);
        },
      });

      alatpay.submit();
    } catch (bookingError) {
      if (bookingError instanceof ApiClientError) {
        setError(bookingError.message);
        if (Array.isArray(bookingError.details)) {
          setFieldErrors(bookingError.details as Array<{ path: string; message: string }>);
        }
      } else {
        setError('The booking could not be created.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-40 sm:px-10">
        <div className="card p-8 text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-deep">Booking access</p>
          <h1 className="mt-3 font-display text-4xl tracking-tighter text-ink">Sign in to book</h1>
          <p className="mt-3 text-base text-black/60">
            Your booking details and payment status are tied to your traveler account, so sign in before continuing.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/auth" className="btn-primary justify-center">Login to continue</Link>
            <Link to="/experiences" className="btn-secondary justify-center">Browse experiences</Link>
          </div>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 pt-40 sm:px-10">
        <Skeleton className="h-10 w-1/2" />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (query.isError || !experience) {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-40 sm:px-10">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <Link to="/experiences" className="inline-flex items-center gap-2 text-sm text-black/60 hover:text-black">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All experiences
        </Link>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="text-xs uppercase tracking-widest text-brand-deep">
              {experience.placeName} · {experience.meetingPoint}
            </p>
            <h1 className="mt-3 font-display text-4xl font-light leading-[1.05] tracking-tighter sm:text-5xl">
              {experience.title}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-black/65">{experience.summary}</p>

            <div className="mt-6 flex flex-wrap gap-2">
              <Chip>{experience.organizer}</Chip>
              <Chip>{formatMinutes(experience.durationMinutes)}</Chip>
              <Chip>{formatMoney(experience.priceMinor, experience.currency)} per person</Chip>
              {experience.languages.map((language) => (
                <Chip key={language}>{language}</Chip>
              ))}
            </div>

            {experience.isSampleData && (
              <div className="mt-6">
                <Notice tone="warn" title="Sample listing — not a real operator">
                  This is placeholder content used to exercise the booking and ALATPay flow. It is not a real
                  business and cannot be sold.
                </Notice>
              </div>
            )}

            <section className="card mt-6 p-6">
              <h2 className="mb-4 font-display text-xl tracking-tight">Dates and availability</h2>
              <ul className="space-y-2">
                {experience.schedules.map((schedule) => (
                  <li
                    key={schedule.scheduleId}
                    className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-sm ${
                      schedule.soldOut ? 'border-black/10 bg-black/[0.02] text-black/40' : 'border-black/10 bg-white/60'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-black/35" aria-hidden="true" />
                      {formatDateTime(schedule.startsAt)}
                      <span className="text-xs text-black/40">Africa/Lagos</span>
                    </span>
                    <span className="inline-flex items-center gap-2 text-xs">
                      <Users className="h-3 w-3" aria-hidden="true" />
                      {schedule.soldOut ? 'Fully booked' : `${schedule.remaining} of ${schedule.capacity} left`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-black/45">
                Availability is calculated on the server from confirmed and pending bookings, and re-checked inside
                a transaction when a booking is created — so a date cannot be oversold.
              </p>
            </section>

            <section className="card mt-6 p-6">
              <h2 className="mb-3 font-display text-xl tracking-tight">Practical information</h2>
              <dl className="space-y-3 text-sm text-black/65">
                <div>
                  <dt className="text-xs uppercase tracking-widest text-black/40">Cancellation terms</dt>
                  <dd>{experience.cancellationTerms}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-widest text-black/40">Accessibility</dt>
                  <dd>{experience.accessibility}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-widest text-black/40">Meeting point</dt>
                  <dd>
                    {experience.meetingPoint} ({experience.coordinates.lat.toFixed(5)},{' '}
                    {experience.coordinates.lng.toFixed(5)})
                  </dd>
                </div>
              </dl>
              <Link to={`/places/${experience.placeId}`} className="btn-secondary mt-5">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Read about the place
              </Link>
            </section>
          </div>

          <div className="lg:col-span-5">
            <Reveal>
              <div className="card p-6">
                {!checkout ? (
                  <form onSubmit={submit} className="space-y-5">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-display text-xl tracking-tight">Book a place</h2>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-black/50">
                        <ShieldCheck className="h-3.5 w-3.5 text-brand-deep" aria-hidden="true" />
                        ALATPay
                      </span>
                    </div>

                    <label>
                      <span className="field-label">Date</span>
                      <select
                        className="field-input"
                        value={scheduleId || availableSchedules[0]?.scheduleId || ''}
                        onChange={(event) => setScheduleId(event.target.value)}
                        required
                      >
                        {availableSchedules.length === 0 && <option value="">No dates available</option>}
                        {availableSchedules.map((schedule) => (
                          <option key={schedule.scheduleId} value={schedule.scheduleId}>
                            {formatDateTime(schedule.startsAt)} — {schedule.remaining} left
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Participants</span>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, selectedSchedule?.remaining ?? availableSchedules[0]?.remaining ?? 1)}
                        className="field-input"
                        value={participants}
                        onChange={(event) => setParticipants(Number(event.target.value))}
                        required
                      />
                      <span className="mt-1 block text-xs text-black/40">
                        Availability is confirmed when the booking is created, not here.
                      </span>
                    </label>

                    <label>
                      <span className="field-label">Full name</span>
                      <input
                        type="text"
                        className="field-input"
                        value={customerName}
                        onChange={(event) => setCustomerName(event.target.value)}
                        required
                        minLength={2}
                      />
                    </label>

                    <label>
                      <span className="field-label">Email</span>
                      <input
                        type="email"
                        className="field-input"
                        value={customerEmail}
                        onChange={(event) => setCustomerEmail(event.target.value)}
                        required
                      />
                    </label>

                    <label>
                      <span className="field-label">Phone (optional)</span>
                      <input
                        type="tel"
                        className="field-input"
                        value={customerPhone}
                        onChange={(event) => setCustomerPhone(event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Notes (optional)</span>
                      <textarea
                        rows={2}
                        className="field-input resize-none"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        maxLength={500}
                      />
                    </label>

                    <div className="rounded-2xl border border-black/10 bg-white/60 p-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-black/60">Total (calculated on the server)</span>
                        <span className="font-display text-xl tracking-tight">
                          {formatMoney(totalMinor, experience.currency)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-black/45">
                        The server recalculates this from the experience price. A client-supplied amount is ignored.
                      </p>
                    </div>

                    {error && (
                      <div className="rounded-2xl border border-[#B4432A]/25 bg-[#B4432A]/[0.06] px-4 py-3 text-sm text-[#7A2C1B]">
                        {error}
                        {fieldErrors.length > 0 && (
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {fieldErrors.map((fieldError) => (
                              <li key={`${fieldError.path}-${fieldError.message}`}>
                                <span className="font-medium">{fieldError.path}</span>: {fieldError.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="btn-primary w-full justify-center"
                      disabled={loading || availableSchedules.length === 0}
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      {loading ? 'Creating booking…' : 'Continue to payment'}
                    </button>

                    <p className="text-xs leading-relaxed text-black/45">
                      Your booking starts as pending. It becomes confirmed only after the server verifies the
                      transaction against the booking amount and currency.
                    </p>
                  </form>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-black/40">Booking reference</p>
                      <p className="font-display text-2xl tracking-tight">{checkout.booking.reference}</p>
                      <p className="mt-1 text-xs text-black/45">
                        {checkout.booking.participants} participant(s) ·{' '}
                        {formatMoney(checkout.booking.totalMinor, checkout.booking.currency)}
                      </p>
                    </div>

                    <Notice tone={checkout.payment.simulated ? 'warn' : 'brand'} title="Payment step">
                      {checkout.next}
                    </Notice>

                    <div className="flex flex-col gap-3">
                      <a
                        href={checkout.payment.checkoutUrl}
                        target={checkout.payment.simulated ? undefined : '_blank'}
                        rel="noreferrer noopener"
                        className="btn-primary justify-center"
                      >
                        {checkout.payment.simulated ? 'Open simulated checkout' : 'Go to ALATPay checkout'}
                      </a>
                      <Link
                        to={`/experiences/booking/return?reference=${encodeURIComponent(checkout.payment.reference)}&email=${encodeURIComponent(customerEmail)}`}
                        className="btn-secondary justify-center"
                      >
                        I have completed payment
                      </Link>
                    </div>

                    <dl className="space-y-2 text-xs text-black/50">
                      <div className="flex justify-between">
                        <dt>Payment reference</dt>
                        <dd className="font-mono">{checkout.payment.reference}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Booking status</dt>
                        <dd>{checkout.booking.status}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Provider</dt>
                        <dd>{checkout.provider.environment}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
