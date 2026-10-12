import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import {
  formatCount,
  formatDuration,
  formatKpiValue,
  formatMicrosUsd,
  formatMilliseconds,
  formatMoneyMinor,
  formatPercent,
  type KpiValue,
} from '../../lib/analytics';
import { formatDateTime } from '../../lib/format';
import { BarChart, DataTable, DonutChart, LineChart } from '../charts';
import { EmptyState, ErrorState, Notice, Skeleton } from '../ui';
import { FreshnessStamp, KpiGrid, Panel, type RangeSelection } from './controls';

type ExportDataset = 'overview' | 'discovery' | 'ai' | 'users' | 'audit' | 'bookings';

const DEVICE_COLORS: Record<string, string> = {
  desktop: '#1E4D33',
  mobile: '#C8973F',
  tablet: '#5C7A63',
  unknown: '#B9B4A8',
  bot: '#B4432A',
};

/**
 * Export button.
 *
 * The CSV is fetched with the admin token in a header and saved from a blob —
 * a plain link would put the token in the URL, where it would land in browser
 * history and every proxy log between here and the API.
 */
function ExportButton({
  token,
  dataset,
  range,
  label = 'Export CSV',
}: {
  token: string;
  dataset: ExportDataset;
  range: RangeSelection;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');

  async function download() {
    setState('working');
    try {
      const { blob, filename } = await api.adminAnalytics.exportCsv(token, dataset, range);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setState('idle');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex items-center gap-2">
      {state === 'failed' && <span className="text-[11px] text-[#8E3320]">Export failed</span>}
      <button type="button" className="btn-secondary" onClick={() => void download()} disabled={state === 'working'}>
        {state === 'working' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {label}
      </button>
    </div>
  );
}

function LoadingBlocks({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-28" />
      ))}
    </div>
  );
}

/** Every panel reports its own failure and offers its own retry. */
function QueryState({
  isLoading,
  error,
  refetch,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  children: React.ReactNode;
}) {
  if (error) {
    return (
      <ErrorState
        error={error}
        title="That section could not be loaded"
        onRetry={() => refetch()}
      />
    );
  }
  if (isLoading) return <LoadingBlocks />;
  return <>{children}</>;
}

function StatStrip({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="card p-4">
          <dt className="text-xs uppercase tracking-widest text-black/40">{item.label}</dt>
          <dd className="mt-1 font-display text-2xl font-light tracking-tighter">{item.value}</dd>
          {item.hint && <p className="mt-1 text-[11px] leading-relaxed text-black/45">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

// --- Overview ---------------------------------------------------------------

export function OverviewPanel({
  token,
  range,
  onOpenSection,
}: {
  token: string;
  range: RangeSelection;
  onOpenSection: (section: string) => void;
}) {
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'overview', token, range],
    queryFn: () => api.adminAnalytics.overview(token, range),
  });

  const targetFor = (kpi: KpiValue): string => {
    if (kpi.group === 'audience' || kpi.group === 'engagement') return 'users';
    if (kpi.group === 'discovery') return 'discovery';
    if (kpi.group === 'ai') return 'ai';
    if (kpi.group === 'commerce') return 'commerce';
    return 'health';
  };

  return (
    <QueryState isLoading={query.isLoading} error={query.error} refetch={() => void query.refetch()}>
      {query.data && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-black/50">
              {query.data.range.label} · compared with the equivalent preceding period
            </p>
            <FreshnessStamp freshness={query.data.freshness} />
          </div>

          {query.data.freshness.partial && (
            <Notice tone="warn" title="Partial data">
              This period holds more events than a single read scans. Figures are computed from a partial sample —
              narrow the range for exact totals.
            </Notice>
          )}

          <KpiGrid
            kpis={query.data.kpis}
            onOpen={onOpenSection}
            targetFor={targetFor}
          />

          <Panel
            title="Audience over time"
            description="Visitors and sessions on one axis: both are counts of people-shaped things, so the comparison is meaningful."
            actions={<ExportButton token={token} dataset="overview" range={range} />}
          >
            <LineChart
              ariaLabel="Unique visitors and sessions over time"
              points={query.data.series.map((point) => ({
                label: point.label,
                values: [point.visitors, point.sessions],
                partial: point.partial,
              }))}
              series={[
                { name: 'Visitors', color: '#1E4D33' },
                { name: 'Sessions', color: '#C8973F' },
              ]}
              formatValue={(value) => formatCount(value)}
              emptyLabel="No events have been recorded for this period yet."
            />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="New registrations" description="Accounts created in each bucket, from the users table.">
              <LineChart
                ariaLabel="New registrations over time"
                points={query.data.series.map((point) => ({
                  label: point.label,
                  values: [point.registrations],
                  partial: point.partial,
                }))}
                series={[{ name: 'Registrations', color: '#1E4D33' }]}
                height={200}
                formatValue={(value) => formatCount(value)}
                emptyLabel="No registrations have been recorded for this period."
              />
            </Panel>

            <Panel
              title="Active signed-in users"
              description="Distinct accounts with a recorded event in each bucket. Anonymous visitors are counted separately, not merged in."
            >
              <LineChart
                ariaLabel="Active users over time"
                points={query.data.series.map((point) => ({
                  label: point.label,
                  values: [point.activeUsers],
                  partial: point.partial,
                }))}
                series={[{ name: 'Active users', color: '#5C7A63' }]}
                height={200}
                formatValue={(value) => formatCount(value)}
                emptyLabel="No signed-in activity has been recorded for this period."
              />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Most viewed pages" description="Page views grouped by path, with ids collapsed so one record does not look like many pages.">
              <BarChart
                ariaLabel="Most viewed pages"
                data={query.data.topPages.map((row) => ({ label: row.label, value: row.count }))}
                formatValue={formatCount}
              />
            </Panel>
            <Panel title="Most viewed places" description="Cultural place profiles, by views in the period.">
              <BarChart
                ariaLabel="Most viewed cultural places"
                data={query.data.topPlaces.map((row) => ({ label: row.label, value: row.count }))}
                formatValue={formatCount}
                emptyLabel="No place profiles have been viewed in this period."
              />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Traffic sources" description="Attributed by campaign parameter, then referrer host. Unattributed traffic is shown as direct rather than guessed.">
              <BarChart
                ariaLabel="Traffic sources"
                data={query.data.trafficSources.map((row) => ({ label: row.label, value: row.count }))}
                formatValue={formatCount}
                color="#5C7A63"
              />
            </Panel>
            <Panel title="Devices" description="From the user agent at collection time. Bot traffic is excluded before it reaches this table.">
              <DonutChart
                ariaLabel="Device breakdown"
                data={query.data.devices.map((row) => ({
                  label: row.device,
                  value: row.count,
                  color: DEVICE_COLORS[row.device] ?? '#B9B4A8',
                }))}
                formatValue={formatCount}
              />
            </Panel>
            <Panel title="Engagement" description="Time between the first and last event of a session.">
              <div className="card space-y-3 p-4 text-sm">
                <p className="font-display text-2xl font-light tracking-tighter">
                  {formatDuration(query.data.engagement.averageEngagementSeconds)}
                </p>
                <p className="text-xs text-black/50">
                  Average engagement time · previous period{' '}
                  {formatDuration(query.data.engagement.previous.averageEngagementSeconds)}
                </p>
                <p className="text-xs text-black/50">
                  Engagement rate {formatPercent(query.data.engagement.engagementRatePercent)} (sessions lasting 10s or
                  more, or with more than one page view)
                </p>
                <p className="text-[11px] leading-relaxed text-black/40">
                  {formatCount(query.data.engagement.singleEventSessions)} single-event sessions are excluded from the
                  average: there is no interval to measure, and counting them as zero would understate engagement.
                </p>
              </div>
            </Panel>
          </div>

          <Panel
            title="Conversion funnel"
            description="Each step is measured from the source that can prove it. A step with no source says so instead of showing zero."
          >
            <DataTable
              columns={[
                { key: 'label', header: 'Step' },
                { key: 'value', header: 'Count', align: 'right' },
                { key: 'conversion', header: 'From previous', align: 'right' },
                { key: 'note', header: 'How it is measured' },
              ]}
              rows={query.data.funnel.map((step) => ({
                id: step.id,
                label: step.label,
                value: step.value === null ? null : formatCount(step.value),
                conversion: step.fromPreviousPercent === null ? null : formatPercent(step.fromPreviousPercent),
                note: step.note ?? '',
              }))}
            />
          </Panel>

          <Panel
            title="Places with no recorded views"
            description="A blind spot in what ECHOES has published and verified — not evidence that these places lack history."
          >
            {query.data.unviewedPlaces.length === 0 ? (
              <EmptyState title="Every catalogued place was viewed in this period" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {query.data.unviewedPlaces.map((place) => (
                  <span
                    key={place.id}
                    className="rounded-full border border-black/10 bg-white/60 px-3 py-1 text-xs text-black/60"
                  >
                    {place.name}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
    </QueryState>
  );
}

// --- Discovery --------------------------------------------------------------

export function DiscoveryPanel({ token, range }: { token: string; range: RangeSelection }) {
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'discovery', token, range],
    queryFn: () => api.adminAnalytics.discovery(token, range),
  });

  return (
    <QueryState isLoading={query.isLoading} error={query.error} refetch={() => void query.refetch()}>
      {query.data && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-black/50">{query.data.range.label}</p>
            <FreshnessStamp freshness={query.data.freshness} />
            <ExportButton token={token} dataset="discovery" range={range} />
          </div>

          <Notice>{query.data.integrity.note}</Notice>

          <StatStrip
            items={[
              { label: 'Place views', value: formatCount(query.data.summary.placeViews), hint: `${formatCount(query.data.summary.distinctPlacesViewed)} distinct places viewed` },
              { label: 'Map opens', value: formatCount(query.data.summary.mapOpens) },
              {
                label: 'Route requests',
                value: formatCount(query.data.summary.routeRequests),
                hint: `failures ${formatCount(query.data.summary.routeFailures)} (${formatPercent(query.data.summary.routeFailureRatePercent)})`,
              },
              {
                label: 'Search',
                value: formatCount(query.data.searches.searches),
                hint: `${formatCount(query.data.searches.zeroResultSearches)} returned nothing (${formatPercent(query.data.searches.zeroResultRatePercent)})`,
              },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Most viewed cultural places">
              <BarChart
                ariaLabel="Most viewed cultural places"
                data={query.data.topPlaces.map((row) => ({
                  label: row.label,
                  value: row.count,
                  secondary: row.category ?? undefined,
                }))}
                formatValue={formatCount}
                emptyLabel="No place profile was opened in this period."
              />
            </Panel>
            <Panel title="Most popular categories" description="Views grouped by the place's category.">
              <BarChart
                ariaLabel="Most popular place categories"
                data={query.data.summary.categoryPopularity.map((row) => ({ label: row.label, value: row.count }))}
                formatValue={formatCount}
                color="#C8973F"
              />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Search terms with no results"
              description="Each row is a question the catalogue could not answer. These are leads for research, not failures of the visitor."
            >
              <DataTable
                columns={[
                  { key: 'term', header: 'Term' },
                  { key: 'count', header: 'Searches', align: 'right' },
                ]}
                rows={query.data.searches.noResults.map((row) => ({ id: row.key, term: row.key, count: row.count }))}
                emptyLabel="Every recorded search returned at least one result."
              />
            </Panel>
            <Panel title="Top search terms">
              <DataTable
                columns={[
                  { key: 'term', header: 'Term' },
                  { key: 'count', header: 'Searches', align: 'right' },
                ]}
                rows={query.data.searches.top.map((row) => ({ id: row.key, term: row.key, count: row.count }))}
                emptyLabel="No searches were recorded in this period."
              />
            </Panel>
          </div>

          <Panel
            title="Information gaps"
            description="Places whose checked sources leave dimensions uncovered. A gap in the record is not proof that the knowledge is absent."
            actions={<ExportButton token={token} dataset="discovery" range={range} label="Export all places" />}
          >
            <DataTable
              columns={[
                { key: 'name', header: 'Place' },
                { key: 'category', header: 'Category' },
                { key: 'coverage', header: 'Dimensions covered', align: 'right' },
              ]}
              rows={query.data.incompleteInformation.map((place) => ({
                id: place.id,
                name: place.name,
                category: place.category,
                coverage: `${place.coveredDimensions}/${place.totalDimensions}`,
              }))}
              emptyLabel="No place needs further research right now."
            />
          </Panel>

          <Panel
            title="Community stories"
            description="Submissions, the moderation backlog and what was decided in the period."
          >
            <StatStrip
              items={[
                { label: 'Backlog', value: formatCount(query.data.stories.backlog), hint: 'Waiting for review, however old' },
                { label: 'Submitted in period', value: formatCount(query.data.stories.submittedInPeriod) },
                { label: 'Approved in period', value: formatCount(query.data.stories.byStatus.approved) },
                {
                  label: 'Rejected / corrections',
                  value: `${formatCount(query.data.stories.byStatus.rejected)} / ${formatCount(query.data.stories.byStatus.needsCorrection)}`,
                },
              ]}
            />
          </Panel>
        </div>
      )}
    </QueryState>
  );
}

// --- AI operations ----------------------------------------------------------

export function AiPanel({ token, range }: { token: string; range: RangeSelection }) {
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'ai', token, range],
    queryFn: () => api.adminAnalytics.ai(token, range),
  });

  return (
    <QueryState isLoading={query.isLoading} error={query.error} refetch={() => void query.refetch()}>
      {query.data && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-black/50">
              {query.data.range.label} · provider {query.data.provider}
              {query.data.configured ? ` (${query.data.model})` : ' — no provider configured, answers come from stored records'}
            </p>
            <FreshnessStamp freshness={query.data.freshness} />
            <ExportButton token={token} dataset="ai" range={range} />
          </div>

          <KpiGrid kpis={query.data.kpis} />

          {query.data.budget.alerting && (
            <Notice tone="warn" title="AI budget threshold reached">
              Estimated spend has passed {query.data.budget.alertThresholdPercent}% of the configured budget
              (day {formatMicrosUsd(query.data.budget.daily.spentMicros)} of{' '}
              {formatMicrosUsd(query.data.budget.daily.limitMicros)}, month{' '}
              {formatMicrosUsd(query.data.budget.monthly.spentMicros)} of{' '}
              {formatMicrosUsd(query.data.budget.monthly.limitMicros)}).
            </Notice>
          )}

          <StatStrip
            items={[
              { label: 'Requests', value: formatCount(query.data.rollup.requests), hint: `previous ${formatCount(query.data.previous.requests)}` },
              {
                label: 'Failures',
                value: formatCount(query.data.rollup.failed),
                hint: `${formatPercent(query.data.rollup.failureRatePercent)} · ${formatCount(query.data.rollup.rateLimited)} rate-limited, ${formatCount(query.data.rollup.timeouts)} timed out`,
              },
              {
                label: 'Latency p95',
                value: formatMilliseconds(query.data.rollup.latencyP95Ms),
                hint: `p50 ${formatMilliseconds(query.data.rollup.latencyP50Ms)} · p99 ${formatMilliseconds(query.data.rollup.latencyP99Ms)}`,
              },
              {
                label: 'Estimated cost',
                value: formatMicrosUsd(query.data.rollup.estimatedCostMicros),
                hint:
                  query.data.rollup.costCoverage.unpricedRequests > 0
                    ? `${query.data.rollup.costCoverage.unpricedRequests} request(s) have no known price and are excluded`
                    : `per successful request ${formatMicrosUsd(query.data.rollup.costPerSuccessfulRequestMicros)}`,
              },
            ]}
          />

          {!query.data.rollup.providerCostAvailable && (
            <Notice tone="warn" title="Only estimated costs are available">
              The provider has not reported an amount for these requests. Costs below are our own estimate from published
              token prices, and the unpriced requests are named rather than counted as free.
            </Notice>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Requests over time" description="Provider calls and record-only answers, by bucket.">
              <LineChart
                ariaLabel="AI requests over time"
                points={query.data.rollup.series.map((point) => ({
                  label: point.label,
                  values: [point.requests],
                }))}
                series={[{ name: 'Requests', color: '#1E4D33' }]}
                height={200}
                formatValue={formatCount}
                emptyLabel="No AI requests were recorded in this period."
              />
            </Panel>
            <Panel title="Estimated cost over time" description="Estimated spend per bucket, in USD.">
              <LineChart
                ariaLabel="Estimated AI cost over time"
                points={query.data.rollup.series.map((point) => ({
                  label: point.label,
                  values: [point.estimatedCostMicros / 1_000_000],
                }))}
                series={[{ name: 'Estimated USD', color: '#C8973F' }]}
                height={200}
                formatValue={(value) => `$${value.toFixed(3)}`}
                emptyLabel="No priced AI requests were recorded in this period."
              />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="By feature" description="Usage and failures per AI feature. Share of spend is from the estimate above.">
              <DataTable
                columns={[
                  { key: 'feature', header: 'Feature' },
                  { key: 'requests', header: 'Requests', align: 'right' },
                  { key: 'failure', header: 'Failure rate', align: 'right' },
                  { key: 'cost', header: 'Est. cost', align: 'right' },
                ]}
                rows={query.data.rollup.byFeature.map((row) => ({
                  id: row.key,
                  feature: row.label,
                  requests: row.count,
                  failure: formatPercent(row.failureRatePercent),
                  cost: formatMicrosUsd(row.estimatedCostMicros),
                }))}
                emptyLabel="No AI feature was used in this period."
              />
            </Panel>
            <Panel title="By model" description="Where the spend goes. A model with no known price shows an estimated cost of — rather than zero.">
              <DataTable
                columns={[
                  { key: 'model', header: 'Model' },
                  { key: 'requests', header: 'Requests', align: 'right' },
                  { key: 'cost', header: 'Est. cost', align: 'right' },
                ]}
                rows={query.data.rollup.byModel.map((row) => ({
                  id: row.key,
                  model: row.label,
                  requests: row.count,
                  cost: row.estimatedCostMicros === 0 && row.label === 'records-only' ? 'no model' : formatMicrosUsd(row.estimatedCostMicros),
                }))}
                emptyLabel="No model was called in this period."
              />
            </Panel>
          </div>

          <Notice tone="brand" title="What is stored about AI usage">
            {query.data.notes.join(' ')}
          </Notice>
        </div>
      )}
    </QueryState>
  );
}

// --- Commerce ---------------------------------------------------------------

export function CommercePanel({ token, range }: { token: string; range: RangeSelection }) {
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'commerce', token, range],
    queryFn: () => api.adminAnalytics.commerce(token, range),
  });

  return (
    <QueryState isLoading={query.isLoading} error={query.error} refetch={() => void query.refetch()}>
      {query.data && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-black/50">{query.data.range.label}</p>
            <FreshnessStamp freshness={query.data.freshness} />
            <ExportButton token={token} dataset="bookings" range={range} label="Export bookings" />
          </div>

          <Notice tone={query.data.payments.configured ? 'brand' : 'warn'}>{query.data.payments.note}</Notice>

          <KpiGrid kpis={query.data.kpis} currency={query.data.rollup.currency} />

          <Panel
            title="Booking funnel"
            description="From a visitor arriving to a verified payment. Unconfigured steps are marked, not zeroed."
          >
            <DataTable
              columns={[
                { key: 'label', header: 'Step' },
                { key: 'value', header: 'Count', align: 'right' },
                { key: 'conversion', header: 'From previous', align: 'right' },
                { key: 'note', header: 'How it is measured' },
              ]}
              rows={query.data.funnel.map((step) => ({
                id: step.id,
                label: step.label,
                value: step.value === null ? null : formatCount(step.value),
                conversion: step.fromPreviousPercent === null ? null : formatPercent(step.fromPreviousPercent),
                note: step.note ?? '',
              }))}
            />
          </Panel>

          <StatStrip
            items={[
              { label: 'Confirmed', value: formatCount(query.data.rollup.confirmed) },
              { label: 'Cancelled', value: formatCount(query.data.rollup.cancelled), hint: `failed ${formatCount(query.data.rollup.failed)}` },
              { label: 'Awaiting payment', value: formatCount(query.data.rollup.pendingPayment) },
              {
                label: 'Gross verified revenue',
                value: formatMoneyMinor(query.data.rollup.grossVerifiedMinor, query.data.rollup.currency),
                hint: query.data.rollup.refundsNote,
              },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Popular experiences" description="Confirmed bookings in the period.">
              <DataTable
                columns={[
                  { key: 'title', header: 'Experience' },
                  { key: 'bookings', header: 'Confirmed', align: 'right' },
                  { key: 'revenue', header: 'Booked value', align: 'right' },
                ]}
                rows={query.data.rollup.popularExperiences.map((row) => ({
                  id: row.key,
                  title: row.label,
                  bookings: row.count,
                  revenue: formatMoneyMinor(row.revenueMinor, query.data.rollup.currency),
                }))}
                emptyLabel="No booking was confirmed in this period."
              />
            </Panel>
            <Panel title="Upcoming experiences" description="Scheduled dates with seats sold so far.">
              <DataTable
                columns={[
                  { key: 'title', header: 'Experience' },
                  { key: 'startsAt', header: 'Starts' },
                  { key: 'seats', header: 'Seats', align: 'right' },
                ]}
                rows={query.data.rollup.upcoming.map((row) => ({
                  id: row.scheduleId,
                  title: row.title,
                  startsAt: formatDateTime(row.startsAt),
                  seats: `${row.booked}/${row.capacity}`,
                }))}
                emptyLabel="No future dated experiences are scheduled."
              />
            </Panel>
          </div>

          <Panel
            title="Recent bookings"
            description="Customer addresses are masked: an operator rarely needs the full address, and the dashboard should not become a contact dump."
          >
            <DataTable
              columns={[
                { key: 'reference', header: 'Reference' },
                { key: 'status', header: 'Status' },
                { key: 'experience', header: 'Experience' },
                { key: 'participants', header: 'People', align: 'right' },
                { key: 'total', header: 'Total', align: 'right' },
                { key: 'customer', header: 'Customer' },
                { key: 'createdAt', header: 'Created' },
              ]}
              rows={query.data.recentBookings.map((booking) => ({
                id: booking.reference,
                reference: booking.reference,
                status: booking.status,
                experience: booking.experienceTitle ?? '—',
                participants: booking.participants,
                total: formatMoneyMinor(booking.totalMinor, booking.currency),
                customer: booking.customer,
                createdAt: formatDateTime(booking.createdAt),
              }))}
              emptyLabel="No bookings have been recorded yet."
              dense
            />
          </Panel>

          <Panel
            title="Recent payments"
            description="Server-verified records only. Card data is never stored, so there is nothing here to redact."
          >
            <DataTable
              columns={[
                { key: 'reference', header: 'Reference' },
                { key: 'status', header: 'Status' },
                { key: 'providerStatus', header: 'Provider status' },
                { key: 'amount', header: 'Amount', align: 'right' },
                { key: 'reconciliation', header: 'Reconciliation' },
                { key: 'updatedAt', header: 'Last change' },
              ]}
              rows={query.data.recentPayments.map((payment) => ({
                id: payment.reference,
                reference: payment.reference,
                status: payment.status,
                providerStatus: payment.providerStatus ?? '—',
                amount: formatMoneyMinor(payment.amountMinor, payment.currency),
                reconciliation: payment.reconciliation,
                updatedAt: formatDateTime(payment.updatedAt),
              }))}
              emptyLabel="No payment attempt has been recorded yet."
              dense
            />
          </Panel>
        </div>
      )}
    </QueryState>
  );
}

// --- Health -----------------------------------------------------------------

export function HealthPanel({ token, range }: { token: string; range: RangeSelection }) {
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'health', token, range],
    queryFn: () => api.adminAnalytics.health(token, range),
    refetchInterval: 30_000,
  });

  return (
    <QueryState isLoading={query.isLoading} error={query.error} refetch={() => void query.refetch()}>
      {query.data && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-black/50">
              {query.data.range.label} · store {query.data.store} · process uptime{' '}
              {formatDuration(query.data.uptimeSeconds)}
            </p>
            <FreshnessStamp freshness={query.data.freshness} />
          </div>

          <KpiGrid kpis={query.data.kpis} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Request volume and server errors" description="Counts per bucket, from per-minute aggregates.">
              <LineChart
                ariaLabel="Requests and server errors over time"
                points={query.data.rollup.series.map((point) => ({
                  label: new Date(point.start).toISOString().slice(11, 16),
                  values: [point.requests, point.serverErrors],
                }))}
                series={[
                  { name: 'Requests', color: '#1E4D33' },
                  { name: '5xx', color: '#B4432A' },
                ]}
                height={200}
                formatValue={formatCount}
                emptyLabel="No requests have been recorded in this period."
              />
            </Panel>
            <Panel title="Latency" description="Recomputed from per-minute histograms, so the value is accurate to the bucket width.">
              <StatStrip
                items={[
                  { label: 'p50', value: formatMilliseconds(query.data.rollup.latencyP50Ms) },
                  { label: 'p95', value: formatMilliseconds(query.data.rollup.latencyP95Ms) },
                  { label: 'p99', value: formatMilliseconds(query.data.rollup.latencyP99Ms) },
                  {
                    label: 'Error rate',
                    value: formatPercent(query.data.rollup.errorRatePercent),
                    hint: `${formatCount(query.data.rollup.serverErrors)} server, ${formatCount(query.data.rollup.clientErrors)} client errors`,
                  },
                ]}
              />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Slowest routes" description="By p95. A route with no traffic is omitted rather than shown as instant.">
              <DataTable
                columns={[
                  { key: 'route', header: 'Route' },
                  { key: 'requests', header: 'Requests', align: 'right' },
                  { key: 'p95', header: 'p95', align: 'right' },
                  { key: 'errors', header: '5xx rate', align: 'right' },
                ]}
                rows={query.data.rollup.slowestRoutes.map((route) => ({
                  id: route.key,
                  route: route.key,
                  requests: route.count,
                  p95: formatMilliseconds(route.p95Ms),
                  errors: formatPercent(route.errorRatePercent),
                }))}
                emptyLabel="No request metrics have been recorded in this period."
                dense
              />
            </Panel>
            <Panel title="Busiest routes">
              <DataTable
                columns={[
                  { key: 'route', header: 'Route' },
                  { key: 'requests', header: 'Requests', align: 'right' },
                ]}
                rows={query.data.rollup.busiestRoutes.map((route) => ({
                  id: route.key,
                  route: route.key,
                  requests: route.count,
                }))}
                dense
              />
            </Panel>
          </div>

          <Panel
            title="Recent server errors"
            description={query.data.logNote}
          >
            <DataTable
              columns={[
                { key: 'at', header: 'When' },
                { key: 'route', header: 'Route' },
                { key: 'status', header: 'Status', align: 'right' },
                { key: 'code', header: 'Code' },
                { key: 'requestId', header: 'Correlation id' },
                { key: 'message', header: 'Summary' },
              ]}
              rows={query.data.recentErrors.map((error) => ({
                id: `${error.at}-${error.requestId ?? ''}`,
                at: formatDateTime(error.at),
                route: `${error.method} ${error.route}`,
                status: error.status,
                code: error.code,
                requestId: error.requestId ?? '—',
                message: error.message,
              }))}
              emptyLabel="No server errors since this process started."
              dense
            />
          </Panel>

          <Panel title="Integrations" description="What is configured and what that means for the data above.">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(query.data.integrations).map(([name, detail]) => (
                <div key={name} className="card p-4 text-xs">
                  <p className="text-[11px] uppercase tracking-widest text-black/40">{name}</p>
                  <dl className="mt-2 space-y-1">
                    {Object.entries(detail).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-3">
                        <dt className="text-black/50">{key}</dt>
                        <dd className="text-right text-black/70">
                          {typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </QueryState>
  );
}

// --- Audit ------------------------------------------------------------------

export function AuditPanel({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'audit', token],
    queryFn: () => api.adminAnalytics.audit(token, 200),
  });

  return (
    <QueryState isLoading={query.isLoading} error={query.error} refetch={() => void query.refetch()}>
      {query.data && (
        <div className="space-y-6">
          <Notice tone="brand">{query.data.note}</Notice>
          <DataTable
            columns={[
              { key: 'createdAt', header: 'When' },
              { key: 'actor', header: 'Actor' },
              { key: 'action', header: 'Action' },
              { key: 'entity', header: 'Target' },
              { key: 'details', header: 'Details' },
            ]}
            rows={query.data.audit.map((entry) => ({
              id: entry.id,
              createdAt: formatDateTime(entry.createdAt),
              actor: entry.actor,
              action: entry.action,
              entity: `${entry.entityType} ${entry.entityId}`.slice(0, 60),
              details: entry.details ? JSON.stringify(entry.details).slice(0, 160) : '—',
            }))}
            emptyLabel="No administrative action has been recorded yet."
            dense
          />
        </div>
      )}
    </QueryState>
  );
}

/** Shared so a caller can label a KPI consistently in tables. */
export function kpiText(value: number | null, unit: KpiValue['unit'], currency = 'NGN'): string {
  return formatKpiValue(value, unit, currency);
}
