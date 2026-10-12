import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpenCheck,
  Bot,
  Clock,
  Compass,
  CreditCard,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiClientError } from '../lib/api';
import { Notice, SectionHeading } from '../components/ui';
import { Wordmark } from '../components/layout';
import { DateRangePicker, type RangeSelection } from '../components/admin/controls';
import {
  AiPanel,
  AuditPanel,
  CommercePanel,
  DiscoveryPanel,
  HealthPanel,
  OverviewPanel,
} from '../components/admin/AnalyticsPanels';
import { UsersPanel } from '../components/admin/UsersPanel';
import { ModerationPanel, PaymentsPanel, QualityPanel } from '../components/admin/OperationsPanels';

type Section =
  | 'overview'
  | 'discovery'
  | 'ai'
  | 'commerce'
  | 'users'
  | 'health'
  | 'moderation'
  | 'payments'
  | 'quality'
  | 'audit';

const SECTIONS: Array<{
  id: Section;
  label: string;
  icon: LucideIcon;
  group: 'Analytics' | 'Operations';
  description: string;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Analytics', description: 'Audience, engagement and conversion at a glance.' },
  { id: 'discovery', label: 'Cultural discovery', icon: BookOpenCheck, group: 'Analytics', description: 'What people look for, and where the record has gaps.' },
  { id: 'ai', label: 'AI operations', icon: Bot, group: 'Analytics', description: 'Guide usage, latency, failures and estimated cost.' },
  { id: 'commerce', label: 'Bookings & revenue', icon: CreditCard, group: 'Analytics', description: 'Bookings, verified payments and the funnel between them.' },
  { id: 'users', label: 'Users', icon: Users, group: 'Analytics', description: 'Accounts, activity and status.' },
  { id: 'health', label: 'System health', icon: Gauge, group: 'Analytics', description: 'Request volume, latency, error rate and integrations.' },
  { id: 'moderation', label: 'Moderation', icon: ListChecks, group: 'Operations', description: 'Stories and guide applications awaiting review.' },
  { id: 'payments', label: 'Payment reconciliation', icon: CreditCard, group: 'Operations', description: 'Provider records, mismatches and unresolved attempts.' },
  { id: 'quality', label: 'Data quality', icon: Sparkles, group: 'Operations', description: 'Coverage gaps and probable duplicates.' },
  { id: 'audit', label: 'Audit log', icon: ShieldCheck, group: 'Operations', description: 'Who changed what, and when.' },
];

const TOKEN_KEY = 'echoes.adminToken';

function sectionFromHash(): Section {
  const hash = window.location.hash.replace('#', '');
  return (SECTIONS.find((section) => section.id === hash)?.id ?? 'overview') as Section;
}

/**
 * The console's own sidebar.
 *
 * The operations console is its own shell: the site rail stands down on this
 * route (see `usesSiteRail`), so this is the navigation an operator gets here —
 * the same in both states, with the way back to the public site at its foot
 * rather than in the header.
 */
function ConsoleSidebar({
  section,
  locked,
  meta,
  onNavigate,
}: {
  section: Section;
  locked: boolean;
  meta?: { timezone: string; store: string; retentionDays: number; adminEmailsConfigured: boolean };
  onNavigate: (next: string) => void;
}) {
  return (
    <nav
      aria-label={locked ? 'Console' : 'Console sections'}
      // Sized to the viewport so the console's own footer — the way back to the
      // public site — is on screen when the page opens, not below the fold. On a
      // screen too short for its contents it scrolls rather than clipping them.
      className="thin-scroll flex flex-col rounded-2xl border border-black/10 bg-white/50 p-3 lg:sticky lg:top-6 lg:h-[calc(100vh-11rem)] lg:min-h-[22rem] lg:self-start lg:overflow-y-auto"
    >
      <Link to="/" className="mb-3 hidden items-center lg:flex" aria-label="ECHOES home">
        <Wordmark />
      </Link>

      {locked ? (
        <p className="hidden items-start gap-2 rounded-xl border border-dashed border-black/15 bg-cream/60 p-4 text-xs leading-relaxed text-black/50 lg:flex">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          The console is locked. Its sections appear once a token is accepted.
        </p>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-1 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0">
            {(['Analytics', 'Operations'] as const).map((group) => (
              <div key={group} className="shrink-0 lg:shrink">
                <p className="mb-2 hidden text-[10px] uppercase tracking-[0.2em] text-black/35 lg:block">{group}</p>
                <ul className="flex gap-2 lg:flex-col lg:gap-1">
                  {SECTIONS.filter((entry) => entry.group === group).map((entry) => {
                    const Icon = entry.icon;
                    const isActive = entry.id === section;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => onNavigate(entry.id)}
                          className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors ${
                            isActive
                              ? 'bg-brand-deep text-white'
                              : 'text-black/60 hover:bg-black/[0.04] hover:text-ink'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {entry.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {meta && (
            <div className="mt-6 hidden rounded-2xl border border-black/10 bg-cream/70 p-4 text-[11px] leading-relaxed text-black/50 lg:block">
              <p className="flex items-center gap-1.5 text-black/60">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {meta.timezone}
              </p>
              <p className="mt-1">Store: {meta.store}</p>
              <p className="mt-1">Retention: {meta.retentionDays} days</p>
              <p className="mt-1">Extra admin allowlist: {meta.adminEmailsConfigured ? 'configured' : 'not configured'}</p>
            </div>
          )}
        </>
      )}

      {/* The way out of the console, at the foot of its own sidebar. */}
      <div className="mt-4 border-t border-black/10 pt-4 lg:mt-auto">
        <Link
          to="/discover"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-3 py-2 text-sm text-ink transition-colors hover:border-brand-deep hover:bg-black/[0.03] lg:justify-start"
        >
          <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
          Back to Discover
        </Link>
      </div>
    </nav>
  );
}

/**
 * The operations console.
 *
 * One date range applies to every analytics section (the panels do not each carry
 * their own window), the section is in the URL hash so a view can be linked to a
 * colleague, and the token gate is a convenience rather than the security
 * boundary: the API authorises every request independently.
 */
export default function Admin() {
  const [token, setToken] = useState('');
  const [draftToken, setDraftToken] = useState('');
  const [section, setSection] = useState<Section>(() => (typeof window === 'undefined' ? 'overview' : sectionFromHash()));
  const [range, setRange] = useState<RangeSelection>({ preset: '30d' });

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
      setDraftToken(stored);
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const meta = useQuery({
    queryKey: ['admin', 'analytics', 'meta', token],
    queryFn: () => api.adminAnalytics.meta(token),
    enabled: Boolean(token),
  });

  const overview = useQuery({
    queryKey: ['admin', 'analytics', 'overview', token, range],
    queryFn: () => api.adminAnalytics.overview(token, range),
    enabled: Boolean(token),
  });

  const active = useMemo(() => SECTIONS.find((entry) => entry.id === section)!, [section]);

  function goTo(next: string) {
    const target = SECTIONS.find((entry) => entry.id === next)?.id;
    if (!target) return;
    setSection(target);
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function unlock(event: FormEvent) {
    event.preventDefault();
    sessionStorage.setItem(TOKEN_KEY, draftToken);
    setToken(draftToken);
  }

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setDraftToken('');
  }

  const locked = !token;

  return (
    <div className="pt-24 sm:pt-28">
      <div className="mx-auto max-w-[100rem] px-4 pb-24 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <ConsoleSidebar
            section={section}
            locked={locked}
            meta={meta.data}
            onNavigate={goTo}
          />

          <div className="min-w-0 space-y-8">
            {locked ? (
              <div className="max-w-3xl">
                <SectionHeading
                  eyebrow="Administration"
                  title="The console is"
                  accent="protected."
                  description="Every endpoint behind this page authorises the request on the server. The token below is what an operator holds; it is not what grants access."
                />
                <form onSubmit={unlock} className="card mt-10 space-y-5 p-6">
                  <label>
                    <span className="field-label">Admin token</span>
                    <span className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-black/40" aria-hidden="true" />
                      <input
                        type="password"
                        className="field-input"
                        value={draftToken}
                        onChange={(event) => setDraftToken(event.target.value)}
                        placeholder="Sent as the x-admin-token header"
                        autoComplete="off"
                      />
                    </span>
                  </label>
                  <button type="submit" className="btn-primary w-full justify-center" disabled={!draftToken}>
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    Unlock the console
                  </button>
                  <p className="text-xs leading-relaxed text-black/45">
                    The token is kept in <code>sessionStorage</code> for this tab and is never written into the bundle.
                    Set <code>ADMIN_API_TOKEN</code> on the API to enable it, or sign in with a moderator account.
                  </p>
                </form>
              </div>
            ) : (
              <>
                <header className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <nav aria-label="Breadcrumb" className="mb-3 text-xs text-black/40">
                      <ol className="flex items-center gap-1.5">
                        <li>ECHOES</li>
                        <li aria-hidden="true">/</li>
                        <li>Administration</li>
                        <li aria-hidden="true">/</li>
                        <li className="text-black/70">{active.label}</li>
                      </ol>
                    </nav>
                    <h1 className="font-display text-3xl font-light tracking-tighter sm:text-4xl">{active.label}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/55">{active.description}</p>
                  </div>
                  <button type="button" className="btn-secondary" onClick={signOut}>
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Sign out
                  </button>
                </header>

                {!meta.isLoading && meta.error && (
                  <Notice tone="warn" title="That token was refused">
                    {meta.error instanceof ApiClientError
                      ? meta.error.message
                      : 'The console could not authenticate. Check ADMIN_API_TOKEN on the API.'}
                  </Notice>
                )}

                {section !== 'moderation' && section !== 'payments' && section !== 'quality' && section !== 'audit' && (
                  <DateRangePicker
                    value={range}
                    onChange={setRange}
                    refreshing={overview.isFetching}
                    onRefresh={() => void overview.refetch()}
                  />
                )}

                {section === 'overview' && <OverviewPanel token={token} range={range} onOpenSection={goTo} />}
                {section === 'discovery' && <DiscoveryPanel token={token} range={range} />}
                {section === 'ai' && <AiPanel token={token} range={range} />}
                {section === 'commerce' && <CommercePanel token={token} range={range} />}
                {section === 'users' && <UsersPanel token={token} range={range} />}
                {section === 'health' && <HealthPanel token={token} range={range} />}
                {section === 'moderation' && <ModerationPanel token={token} />}
                {section === 'payments' && <PaymentsPanel token={token} />}
                {section === 'quality' && <QualityPanel token={token} />}
                {section === 'audit' && <AuditPanel token={token} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Exported for tests: the section list drives both the sidebar and the routes. */
export const ADMIN_SECTIONS = SECTIONS;
