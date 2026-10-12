import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { api, ApiClientError } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { Notice, StatusPill } from '../ui';
import { DataTable } from '../charts';
import { Panel } from './controls';

/** The moderation queue: community stories and guide applications. */
export function ModerationPanel({ token }: { token: string }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const stories = useQuery({
    queryKey: ['admin', 'stories', token],
    queryFn: () => api.admin.stories(token, 'pending'),
  });

  const guideQueue = useQuery({
    queryKey: ['admin', 'guides', token],
    queryFn: () => api.admin.guides(token, 'pending'),
  });

  async function moderate(id: string, status: string) {
    setActionError(null);
    try {
      await api.admin.moderate(token, id, { status, moderationNote: notes[id] ?? null });
      await stories.refetch();
    } catch (error) {
      setActionError(
        error instanceof ApiClientError ? error.message : 'The moderation decision could not be recorded.',
      );
    }
  }

  async function moderateGuide(id: string, status: string) {
    setActionError(null);
    try {
      await api.admin.moderateGuide(token, id, { status, moderationNote: notes[id] ?? null });
      await guideQueue.refetch();
    } catch (error) {
      setActionError(error instanceof ApiClientError ? error.message : 'The guide review could not be recorded.');
    }
  }

  return (
    <div className="space-y-8">
      {actionError && <Notice tone="warn">{actionError}</Notice>}

      <Panel title="Community submissions" description="Approving publishes the account as community testimony with the contributor's chosen attribution. Sensitive or restricted submissions are refused by the standard path.">
        {stories.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
        {stories.data?.stories.length === 0 && <Notice>No submissions are waiting for review.</Notice>}
        <div className="space-y-4">
          {stories.data?.stories.map((story) => (
            <article key={story.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-black/40">
                    {story.reference} · {story.attribution.replace('_', ' ')}
                    {story.period ? ` · ${story.period}` : ''}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-black/70">{story.body}</p>
                </div>
                <span className="rounded-full border border-black/15 px-2.5 py-0.5 text-[11px] text-black/55">
                  {story.status.replace('_', ' ')}
                </span>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-black/50">Source context: {story.sourceContext}</p>
              <p className="mt-1 text-xs text-black/40">
                Contributor: {story.contributor}
                {story.reviewedAt ? ` · reviewed ${formatDateTime(story.reviewedAt)}` : ''}
              </p>

              <label className="mt-4 block">
                <span className="field-label">Moderation note (shown to the contributor)</span>
                <textarea
                  rows={2}
                  className="field-input resize-none"
                  value={notes[story.id] ?? ''}
                  onChange={(event) => setNotes((current) => ({ ...current, [story.id]: event.target.value }))}
                />
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => void moderate(story.id, 'approved')}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Approve
                </button>
                <button type="button" className="btn-secondary" onClick={() => void moderate(story.id, 'needs_correction')}>
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Request correction
                </button>
                <button type="button" className="btn-secondary" onClick={() => void moderate(story.id, 'rejected')}>
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Guide applications">
        {guideQueue.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
        {guideQueue.data?.guides.length === 0 && <Notice>No guide applications are waiting for review.</Notice>}
        <div className="space-y-4">
          {guideQueue.data?.guides.map((guide) => (
            <article key={guide.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-black/40">
                    {guide.city} · {guide.role}
                  </p>
                  <h4 className="mt-2 font-display text-2xl tracking-tighter text-ink">{guide.name}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-black/70">{guide.bio}</p>
                </div>
                <span className="rounded-full border border-black/15 px-2.5 py-0.5 text-[11px] text-black/55">
                  {guide.status.replace('_', ' ')}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {guide.specialties.map((specialty) => (
                  <span
                    key={`${guide.id}-${specialty}`}
                    className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-black/50"
                  >
                    {specialty}
                  </span>
                ))}
              </div>

              <p className="mt-4 text-xs text-black/50">
                Availability: {guide.availability ?? 'Flexible'} · Price from: {guide.priceFrom ?? '₦15,000'}
              </p>

              <label className="mt-4 block">
                <span className="field-label">Moderation note</span>
                <textarea
                  rows={2}
                  className="field-input resize-none"
                  value={notes[guide.id] ?? ''}
                  onChange={(event) => setNotes((current) => ({ ...current, [guide.id]: event.target.value }))}
                />
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => void moderateGuide(guide.id, 'approved')}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Approve guide
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void moderateGuide(guide.id, 'needs_correction')}
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Request revision
                </button>
                <button type="button" className="btn-secondary" onClick={() => void moderateGuide(guide.id, 'rejected')}>
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/** Payment reconciliation. Never card data — none is stored. */
export function PaymentsPanel({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ['admin', 'payments', token],
    queryFn: () => api.admin.payments(token),
  });

  return (
    <div className="space-y-4">
      {query.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
      {query.data && (
        <>
          <Notice tone={query.data.provider.configured ? 'brand' : 'warn'}>
            ALATPay:{' '}
            {query.data.provider.configured
              ? 'merchant credentials present'
              : `not configured — missing ${query.data.provider.missing.join(', ')}`}
          </Notice>
          <DataTable
            columns={[
              { key: 'reference', header: 'Reference' },
              { key: 'status', header: 'Status' },
              { key: 'amount', header: 'Amount', align: 'right' },
              { key: 'booking', header: 'Booking' },
              { key: 'flags', header: 'Flags' },
            ]}
            rows={query.data.payments.map((payment) => ({
              id: payment.reference,
              reference: payment.reference,
              status: `${payment.status}${payment.providerStatus ? ` (${payment.providerStatus})` : ''}`,
              amount: formatMoney(payment.amountMinor, payment.currency),
              booking: payment.bookingReference ?? '—',
              flags:
                payment.amountMatchesBooking === false
                  ? 'amount mismatch'
                  : payment.unresolved
                    ? 'needs reconciliation'
                    : 'clean',
            }))}
            emptyLabel="No payment attempts have been recorded yet."
            dense
          />
          <p className="text-xs leading-relaxed text-black/45">
            Only safe reconciliation metadata is shown. Card data is never stored, and secrets are never exposed here.
          </p>
        </>
      )}
    </div>
  );
}

/** Coverage and duplicate review for the cultural record itself. */
export function QualityPanel({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ['admin', 'quality', token],
    queryFn: () => api.admin.dataQuality(token),
  });

  return (
    <div className="space-y-6">
      {query.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
      {query.data && (
        <>
          <Notice>{query.data.duplicatePolicy}</Notice>

          {query.data.probableDuplicates.length > 0 && (
            <div className="card p-5">
              <h3 className="font-display text-lg tracking-tight">Possible duplicates to review</h3>
              <ul className="mt-3 space-y-2 text-sm text-black/65">
                {query.data.probableDuplicates.map((duplicate) => (
                  <li key={`${duplicate.a.id}-${duplicate.b.id}`}>
                    <span className="font-medium">{duplicate.a.name}</span> ↔{' '}
                    <span className="font-medium">{duplicate.b.name}</span>
                    <span className="ml-2 text-xs text-black/45">
                      name similarity {duplicate.nameSimilarity}
                      {duplicate.distanceKm !== null ? ` · ${duplicate.distanceKm} km apart` : ''} · {duplicate.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {query.data.places.map((place) => (
              <div key={place.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-display text-lg tracking-tight">{place.name}</p>
                  <div className="flex items-center gap-2">
                    <StatusPill status={place.needsResearch ? 'incomplete' : 'available'} short />
                    <span className="text-xs text-black/45">
                      {place.coveredDimensions}/{place.totalDimensions} dimensions covered
                    </span>
                  </div>
                </div>
                {place.gaps.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs leading-relaxed text-black/55">
                    {place.gaps.map((gap) => (
                      <li key={gap.dimension}>
                        <span className="font-medium">{gap.label}</span> — {gap.evidence}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const OPERATIONS_ICONS = { ShieldCheck };
