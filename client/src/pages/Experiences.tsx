import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, ExternalLink, ShieldCheck, Users } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatMinutes, formatMoney } from '../lib/format';
import { Chip, ErrorState, Loading, Notice, SectionHeading, Skeleton } from '../components/ui';
import { Reveal } from '../components/layout';

export default function Experiences() {
  const query = useQuery({ queryKey: ['experiences'], queryFn: () => api.experiences() });

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <SectionHeading
          eyebrow="Cultural experiences"
          title="Bookable experiences, with availability that is"
          accent="checked on the server."
          description="Availability, pricing and confirmation are handled server-side. A booking is confirmed only after a transaction is verified against the booking amount and currency — a redirect with a success parameter is never enough."
        />
      </div>

      <div className="mx-auto mt-10 max-w-7xl px-6 pb-24 sm:px-10">
        {query.isLoading && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        )}

        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

        {query.data && (
          <>
            <Reveal>
              <Notice tone="warn" title="These listings are sample data">
                {query.data.notice} They exist so the booking and payment flow can be exercised end to end. Real
                listings require a verified operator and written consent.
              </Notice>
            </Reveal>

            <Reveal delay={0.05}>
              <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-black/55">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-brand-deep" aria-hidden="true" />
                  Payment provider: ALATPay ({query.data.provider.environment})
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    query.data.provider.configured
                      ? 'border-brand-deep/20 bg-brand-soft/60 text-brand-deep'
                      : 'border-[#C8973F]/30 bg-[#C8973F]/12 text-[#7A5518]'
                  }`}
                >
                  {query.data.provider.configured
                    ? 'Merchant credentials present'
                    : `Not configured — missing ${query.data.provider.missing.join(', ')}`}
                </span>
                {!query.data.provider.configured && query.data.provider.simulationAllowed && (
                  <span className="rounded-full border border-black/15 px-2.5 py-0.5 text-[11px] text-black/55">
                    Checkout runs in clearly-labelled simulation mode
                  </span>
                )}
              </div>
            </Reveal>

            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {query.data.experiences.map((experience, index) => (
                <Reveal key={experience.id} delay={index * 0.08}>
                  <article className="card flex h-full flex-col p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-black/40">
                          {experience.placeName ?? 'Lagos'} · {experience.neighbourhood ?? ''}
                        </p>
                        <h2 className="mt-1 font-display text-2xl font-light tracking-tighter">
                          {experience.title}
                        </h2>
                      </div>
                      {experience.isSampleData && (
                        <span className="shrink-0 rounded-full border border-[#C8973F]/40 bg-[#C8973F]/15 px-2.5 py-1 text-[10px] text-[#7A5518]">
                          Sample listing
                        </span>
                      )}
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-black/60">{experience.summary}</p>

                    <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs uppercase tracking-widest text-black/40">Price</dt>
                        <dd className="font-display text-lg tracking-tight">
                          {formatMoney(experience.priceMinor, experience.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-widest text-black/40">Duration</dt>
                        <dd className="inline-flex items-center gap-1 font-display text-lg tracking-tight">
                          <Clock className="h-3.5 w-3.5 text-black/35" aria-hidden="true" />
                          {formatMinutes(experience.durationMinutes)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-widest text-black/40">Seats left</dt>
                        <dd className="inline-flex items-center gap-1 font-display text-lg tracking-tight">
                          <Users className="h-3.5 w-3.5 text-black/35" aria-hidden="true" />
                          {experience.schedules.reduce((sum, schedule) => sum + schedule.remaining, 0)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Chip>{experience.organizer}</Chip>
                      {experience.languages.map((language) => (
                        <Chip key={language}>{language}</Chip>
                      ))}
                    </div>

                    <div className="mt-5 border-t border-black/10 pt-4">
                      <p className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-black/40">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                        Dates
                      </p>
                      <ul className="space-y-1 text-xs text-black/55">
                        {experience.schedules.map((schedule) => (
                          <li key={schedule.scheduleId} className="flex justify-between gap-3">
                            <span>{formatDateTime(schedule.startsAt)}</span>
                            <span className={schedule.soldOut ? 'text-[#8E3320]' : 'text-brand-deep'}>
                              {schedule.soldOut ? 'Fully booked' : `${schedule.remaining} left`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link to={`/experiences/${experience.id}`} className="btn-primary">
                        View dates &amp; book
                      </Link>
                      <Link to={`/places/${experience.placeId}`} className="btn-secondary">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        The place
                      </Link>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>

            {query.data.experiences.length === 0 && (
              <div className="mt-8">
                <Loading label="No experiences are listed yet." />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
