import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Lock, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { Notice, SectionHeading, StatusPill } from '../components/ui';

type Tab = 'overview' | 'moderation' | 'payments' | 'quality';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'moderation', label: 'Moderation queue' },
  { id: 'payments', label: 'Payments' },
  { id: 'quality', label: 'Data quality' },
];

const TOKEN_KEY = 'echoes.adminToken';

export default function Admin() {
  const [token, setToken] = useState('');
  const [draftToken, setDraftToken] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
      setDraftToken(stored);
    }
  }, []);

  function unlock(event: React.FormEvent) {
    event.preventDefault();
    sessionStorage.setItem(TOKEN_KEY, draftToken);
    setToken(draftToken);
  }

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setDraftToken('');
  }

  const overview = useQuery({
    queryKey: ['admin', 'overview', token],
    queryFn: () => api.admin.overview(token),
    enabled: Boolean(token),
  });

  const stories = useQuery({
    queryKey: ['admin', 'stories', token],
    queryFn: () => api.admin.stories(token, 'pending'),
    enabled: Boolean(token) && tab === 'moderation',
  });

  const payments = useQuery({
    queryKey: ['admin', 'payments', token],
    queryFn: () => api.admin.payments(token),
    enabled: Boolean(token) && tab === 'payments',
  });

  const quality = useQuery({
    queryKey: ['admin', 'quality', token],
    queryFn: () => api.admin.dataQuality(token),
    enabled: Boolean(token) && tab === 'quality',
  });

  async function moderate(id: string, status: string) {
    setActionError(null);
    try {
      await api.admin.moderate(token, id, { status, moderationNote: notes[id] ?? null });
      await stories.refetch();
      await overview.refetch();
    } catch (error) {
      setActionError(
        error instanceof ApiClientError ? error.message : 'The moderation decision could not be recorded.',
      );
    }
  }

  if (!token) {
    return (
      <div className="pt-32 sm:pt-40">
        <div className="mx-auto max-w-3xl px-6 pb-24 sm:px-10">
          <SectionHeading
            eyebrow="Administration"
            title="Moderation and payment reconciliation are"
            accent="protected."
            description="Administrative endpoints require either a moderator session or the shared admin token. Without one, access is refused rather than silently allowed."
          />
          <form onSubmit={unlock} className="card mt-10 space-y-5 p-6">
            <label>
              <span className="field-label">Admin token</span>
              <input
                type="password"
                className="field-input"
                value={draftToken}
                onChange={(event) => setDraftToken(event.target.value)}
                placeholder="Sent as the x-admin-token header"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="btn-primary w-full justify-center" disabled={!draftToken}>
              <Lock className="h-4 w-4" aria-hidden="true" />
              Unlock the console
            </button>
            <p className="text-xs leading-relaxed text-black/45">
              The token is stored in <code>sessionStorage</code> for this tab only, and is never written to the
              bundle. Set <code>ADMIN_API_TOKEN</code> on the API to enable access.
            </p>
          </form>
        </div>
      </div>
    );
  }

  const error =
    overview.error ??
    (tab === 'moderation' ? stories.error : null) ??
    (tab === 'payments' ? payments.error : null) ??
    (tab === 'quality' ? quality.error : null);

  return (
    <div className="pt-32 sm:pt-40">
      <div className="mx-auto max-w-7xl px-6 pb-24 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading eyebrow="Administration" title="Operations" accent="console." />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => void overview.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </button>
            <button type="button" className="btn-secondary" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full px-4 py-2 text-sm transition-colors ${
                tab === item.id
                  ? 'bg-brand-deep text-white'
                  : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-6">
            <Notice tone="warn" title="That request was refused or failed">
              {error instanceof ApiClientError ? error.message : 'The console could not load that section.'}
            </Notice>
          </div>
        )}

        {actionError && (
          <div className="mt-6">
            <Notice tone="warn">{actionError}</Notice>
          </div>
        )}

        {tab === 'overview' && (
          <div className="mt-6">
            {overview.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
            {overview.data && (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {Object.entries(overview.data.counts).map(([key, value]) => (
                    <div key={key} className="card p-4">
                      <dd className="font-display text-2xl font-light tracking-tighter">{value}</dd>
                      <dt className="mt-1 text-xs uppercase tracking-widest text-black/40">
                        {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      </dt>
                    </div>
                  ))}
                </dl>
                <div className="mt-6">
                  <Notice tone={overview.data.paymentsProvider.configured ? 'brand' : 'warn'}>
                    ALATPay: {overview.data.paymentsProvider.configured ? 'merchant credentials present' : `not configured — missing ${overview.data.paymentsProvider.missing.join(', ')}`}
                    {overview.data.paymentsProvider.simulationAllowed
                      ? ' · simulated checkout is available in this environment'
                      : ' · simulated checkout is disabled'}
                  </Notice>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'moderation' && (
          <div className="mt-6 space-y-4">
            {stories.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
            {stories.data?.stories.length === 0 && (
              <Notice>No submissions are waiting for review.</Notice>
            )}
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

                <p className="mt-3 text-xs leading-relaxed text-black/50">
                  Source context: {story.sourceContext}
                </p>
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
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [story.id]: event.target.value }))
                    }
                  />
                </label>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={() => void moderate(story.id, 'approved')}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void moderate(story.id, 'needs_correction')}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    Request correction
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void moderate(story.id, 'rejected')}
                  >
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Reject
                  </button>
                </div>
                <p className="mt-3 text-xs text-black/40">
                  Approving publishes the account as community testimony with the contributor's chosen attribution.
                  Sensitive or restricted submissions are refused by the standard path.
                </p>
              </article>
            ))}
          </div>
        )}

        {tab === 'payments' && (
          <div className="mt-6 space-y-4">
            {payments.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
            {payments.data?.payments.length === 0 && <Notice>No payment attempts have been recorded yet.</Notice>}
            {payments.data && payments.data.payments.length > 0 && (
              <div className="card overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-black/[0.03] text-xs uppercase tracking-widest text-black/40">
                    <tr>
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Booking</th>
                      <th className="px-4 py-3">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {payments.data.payments.map((payment) => (
                      <tr key={payment.reference}>
                        <td className="px-4 py-3 font-mono text-xs">{payment.reference}</td>
                        <td className="px-4 py-3">
                          {payment.status}
                          {payment.providerStatus && (
                            <span className="ml-2 text-xs text-black/40">({payment.providerStatus})</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{formatMoney(payment.amountMinor, payment.currency)}</td>
                        <td className="px-4 py-3">
                          {payment.bookingReference ?? '—'}
                          <span className="ml-2 text-xs text-black/40">{payment.bookingStatus ?? ''}</span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {payment.amountMatchesBooking === false && (
                            <span className="text-[#8E3320]">amount mismatch</span>
                          )}
                          {payment.unresolved && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[#7A5518]">
                              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                              needs reconciliation
                            </span>
                          )}
                          {payment.amountMatchesBooking !== false && !payment.unresolved && (
                            <span className="text-brand-deep">clean</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs leading-relaxed text-black/45">
              Only safe reconciliation metadata is shown. Card data is never stored, and secrets are never exposed
              here.
            </p>
          </div>
        )}

        {tab === 'quality' && (
          <div className="mt-6 space-y-6">
            {quality.isLoading && <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />}
            {quality.data && (
              <>
                <Notice>{quality.data.duplicatePolicy}</Notice>

                {quality.data.probableDuplicates.length > 0 && (
                  <div className="card p-5">
                    <h3 className="font-display text-lg tracking-tight">Possible duplicates to review</h3>
                    <ul className="mt-3 space-y-2 text-sm text-black/65">
                      {quality.data.probableDuplicates.map((duplicate) => (
                        <li key={`${duplicate.a.id}-${duplicate.b.id}`}>
                          <span className="font-medium">{duplicate.a.name}</span> ↔{' '}
                          <span className="font-medium">{duplicate.b.name}</span>
                          <span className="ml-2 text-xs text-black/45">
                            name similarity {duplicate.nameSimilarity}
                            {duplicate.distanceKm !== null ? ` · ${duplicate.distanceKm} km apart` : ''} ·{' '}
                            {duplicate.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-3">
                  {quality.data.places.map((place) => (
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
        )}
      </div>
    </div>
  );
}
