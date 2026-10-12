import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Search, ShieldOff, UserCheck } from 'lucide-react';
import { api, ApiClientError } from '../../lib/api';
import { formatCount, formatPercent } from '../../lib/analytics';
import { formatDateTime } from '../../lib/format';
import { DataTable } from '../charts';
import { ErrorState, Notice, Skeleton } from '../ui';
import { ConfirmDialog, FreshnessStamp, Panel, type RangeSelection } from './controls';

const PER_PAGE = 25;

/**
 * Accounts, with the privileges that exist and nothing more.
 *
 * There is no role selector: the API deliberately cannot change a role, so this
 * view cannot offer a button that would silently fail. Suspension is the only
 * state change, it is confirmed, and the reason is written to the audit log.
 */
export function UsersPanel({ token, range }: { token: string; range: RangeSelection }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ id: string; name: string; status: 'active' | 'suspended' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Debounced: typing should not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const users = useQuery({
    queryKey: ['admin', 'analytics', 'users', token, range, query, role, status, page],
    queryFn: () =>
      api.adminAnalytics.users(token, range, {
        q: query || undefined,
        role: role || undefined,
        status: status || undefined,
        page,
        perPage: PER_PAGE,
      }),
  });

  const totalPages = users.data ? Math.max(1, Math.ceil(users.data.pagination.total / PER_PAGE)) : 1;

  async function applyStatus(reason: string) {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.adminAnalytics.setUserStatus(token, pending.id, {
        status: pending.status === 'suspended' ? 'suspended' : 'active',
        reason: reason || undefined,
      });
      setNotice(result.note);
      setPending(null);
      await users.refetch();
    } catch (error) {
      setActionError(
        error instanceof ApiClientError ? error.message : 'The account status could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[16rem] flex-1">
          <span className="field-label">Search accounts</span>
          <span className="flex items-center gap-2 border-b border-black/20 py-2">
            <Search className="h-3.5 w-3.5 text-black/40" aria-hidden="true" />
            <input
              type="search"
              className="w-full bg-transparent text-sm outline-none placeholder:text-black/30"
              placeholder="Name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>

        <label>
          <span className="field-label">Role</span>
          <select
            className="rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-xs"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            {['visitor', 'contributor', 'organizer', 'moderator', 'admin'].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="field-label">Status</span>
          <select
            className="rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-xs"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>

        <ExportButton token={token} range={range} />
      </div>

      {actionError && <Notice tone="warn">{actionError}</Notice>}
      {notice && <Notice tone="brand">{notice}</Notice>}

      {users.error && (
        <ErrorState error={users.error} title="The account list could not be loaded" onRetry={() => void users.refetch()} />
      )}
      {users.isLoading && <Skeleton className="h-64" />}

      {users.data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-black/50">{users.data.range.label}</p>
            <FreshnessStamp freshness={users.data.freshness} />
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Accounts', value: formatCount(users.data.summary.total), hint: `${formatCount(users.data.summary.active)} active · ${formatCount(users.data.summary.suspended)} suspended` },
              {
                label: 'New in period',
                value: formatCount(users.data.summary.newInPeriod),
                hint: `${formatPercent(users.data.summary.newChangePercent)} against the previous period`,
              },
              {
                label: 'Active in period',
                value: formatCount(users.data.summary.activeInPeriod),
                hint: 'Accounts with at least one recorded event',
              },
              {
                label: 'No recorded activity',
                value: formatCount(users.data.summary.withNoRecordedActivity),
                hint: 'May predate collection, or the account may be unused',
              },
            ].map((item) => (
              <div key={item.label} className="card p-4">
                <dt className="text-xs uppercase tracking-widest text-black/40">{item.label}</dt>
                <dd className="mt-1 font-display text-2xl font-light tracking-tighter">{item.value}</dd>
                <p className="mt-1 text-[11px] leading-relaxed text-black/45">{item.hint}</p>
              </div>
            ))}
          </dl>

          <Panel
            title="Accounts"
            description={users.data.privacy.note}
            actions={
              <span className="text-[11px] text-black/45">
                Page {page} of {totalPages} · {formatCount(users.data.pagination.total)} matching
              </span>
            }
          >
            <DataTable
              columns={[
                { key: 'name', header: 'Name' },
                { key: 'email', header: 'Email' },
                { key: 'role', header: 'Role' },
                { key: 'status', header: 'Status' },
                { key: 'created', header: 'Joined' },
                { key: 'lastActive', header: 'Last active' },
                { key: 'events', header: 'Events', align: 'right' },
                { key: 'actions', header: 'Action' },
              ]}
              rows={users.data.rows.map((user) => ({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                status: user.status,
                created: formatDateTime(user.createdAt),
                lastActive: user.lastActiveAt ? formatDateTime(user.lastActiveAt) : 'no recorded activity',
                events: user.eventsInPeriod,
                actions: user.status === 'suspended' ? 'suspended' : 'active',
              }))}
              emptyLabel="No account matches that filter."
              dense
            />

            <div className="mt-4 flex flex-wrap gap-2">
              {users.data.rows.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={user.status === 'suspended' ? 'btn-secondary' : 'btn-secondary'}
                  onClick={() =>
                    setPending({
                      id: user.id,
                      name: user.name,
                      status: user.status === 'suspended' ? 'active' : 'suspended',
                    })
                  }
                >
                  {user.status === 'suspended' ? (
                    <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {user.status === 'suspended' ? `Reactivate ${user.name}` : `Suspend ${user.name}`}
                </button>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </button>
              {users.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-deep" aria-hidden="true" />}
            </div>
          </Panel>

          <Panel title="Accounts by role" description="Roles are fixed: registration can only ever create a visitor or an organizer, and no API here can change one.">
            <ul className="flex flex-wrap gap-2">
              {users.data.summary.byRole.map((row) => (
                <li
                  key={row.role}
                  className="rounded-full border border-black/10 bg-white/60 px-3 py-1 text-xs text-black/60"
                >
                  {row.role}: {formatCount(row.count)}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.status === 'suspended' ? `Suspend ${pending?.name}?` : `Reactivate ${pending?.name}?`}
        description={
          pending?.status === 'suspended'
            ? 'A suspended account cannot sign in. Sessions already issued stay valid until their token expires, because sessions are stateless. The account is not deleted, so its history stays readable.'
            : 'The account will be able to sign in again with its existing password. This is recorded in the audit log.'
        }
        confirmLabel={pending?.status === 'suspended' ? 'Suspend account' : 'Reactivate account'}
        requireReason={pending?.status === 'suspended'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void applyStatus(reason)}
      />
    </div>
  );
}

function ExportButton({ token, range }: { token: string; range: RangeSelection }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {failed && <span className="text-[11px] text-[#8E3320]">Export failed</span>}
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void api.adminAnalytics
            .exportCsv(token, 'users', range)
            .then(({ blob, filename }) => {
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = filename;
              link.click();
              URL.revokeObjectURL(url);
            })
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
        Export CSV
      </button>
    </div>
  );
}
