import { useId, useState } from 'react';

/**
 * Charts, drawn as plain SVG.
 *
 * No charting dependency was added: the project has none, and these three shapes
 * cover what the console needs. Each one carries the accessibility work that a
 * library would otherwise hide — a labelled figure, a `<title>` per data point, a
 * keyboard-reachable readout, and a table of the same numbers for screen readers
 * and for anyone who wants the figures rather than the picture.
 *
 * The y-axis always starts at zero. A truncated axis makes small movements look
 * dramatic, which is the opposite of what a decision-maker needs.
 */

export interface ChartSeriesPoint {
  label: string;
  /** Two series at most on one axis: unrelated measures get their own chart. */
  values: number[];
  partial?: boolean;
}

export interface ChartSeries {
  name: string;
  color: string;
}

function extent(points: ChartSeriesPoint[]): { max: number } {
  let max = 0;
  for (const point of points) {
    for (const value of point.values) {
      if (value > max) max = value;
    }
  }
  return { max };
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function tickLabels(max: number, count = 4): number[] {
  const ticks: number[] = [];
  for (let index = 0; index <= count; index += 1) ticks.push((max / count) * index);
  return ticks;
}

interface LineChartProps {
  points: ChartSeriesPoint[];
  series: ChartSeries[];
  height?: number;
  formatValue?: (value: number) => string;
  /** Shown when the whole range predates collection. */
  emptyLabel?: string;
  ariaLabel: string;
}

export function LineChart({
  points,
  series,
  height = 220,
  formatValue = (value) => String(value),
  emptyLabel = 'No data has been collected for this period.',
  ariaLabel,
}: LineChartProps) {
  const width = 720;
  const padding = { top: 16, right: 12, bottom: 26, left: 40 };
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-white/50 p-8 text-center text-sm text-black/55">
        {emptyLabel}
      </div>
    );
  }

  const { max } = extent(points);
  const axisMax = niceMax(max);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const stepX = points.length === 1 ? 0 : innerWidth / (points.length - 1);

  const x = (index: number): number => padding.left + index * stepX;
  const y = (value: number): number => padding.top + innerHeight - (value / axisMax) * innerHeight;

  const paths = series.map((entry) =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.values[series.indexOf(entry)] ?? 0).toFixed(1)}`)
      .join(' '),
  );

   const activePoint = active === null ? null : points[active];

  return (
    <figure className="rounded-2xl border border-black/10 bg-white/70 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {series.map((entry) => (
          <span key={entry.name} className="inline-flex items-center gap-2 text-xs text-black/60">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
            {entry.name}
          </span>
        ))}
        <span className="ml-auto text-xs text-black/40" aria-live="polite">
          {activePoint
            ? `${activePoint.label}: ${series
                .map((entry) => `${entry.name} ${formatValue(activePoint.values[series.indexOf(entry)] ?? 0)}`)
                .join(' · ')}`
            : 'Hover or focus the chart to read a point.'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setActive(null)}
      >
        <title id={titleId}>
          {ariaLabel}. Series: {series.map((entry) => entry.name).join(', ')}. Peak value {formatValue(max)}.
        </title>

        {tickLabels(axisMax).map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="rgba(0,0,0,0.08)"
              strokeDasharray={tick === 0 ? undefined : '3 4'}
            />
            <text x={padding.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-black/40" fontSize={10}>
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {paths.map((path, index) => (
          <path
            key={series[index]!.name}
            d={path}
            fill="none"
            stroke={series[index]!.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            {/* A wide invisible hit area per point keeps hovering practical. */}
            <rect
              x={x(index) - stepX / 2}
              y={padding.top}
              width={Math.max(stepX, 8)}
              height={innerHeight}
              fill={active === index ? 'rgba(30,77,51,0.05)' : 'transparent'}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${series
                .map((entry) => `${entry.name} ${formatValue(point.values[series.indexOf(entry)] ?? 0)}`)
                .join(', ')}${point.partial ? ' (period still in progress)' : ''}`}
            >
              <title>
                {point.label}: {series
                  .map((entry) => `${entry.name} ${formatValue(point.values[series.indexOf(entry)] ?? 0)}`)
                  .join(', ')}
              </title>
            </rect>
            {series.map((entry) => (
              <circle
                key={`${entry.name}-${index}`}
                cx={x(index)}
                cy={y(point.values[series.indexOf(entry)] ?? 0)}
                r={active === index ? 4 : 2}
                fill={entry.color}
                pointerEvents="none"
              />
            ))}
          </g>
        ))}

        {points.map((point, index) => {
          // Only a readable number of ticks is drawn, so labels never collide.
          const every = Math.ceil(points.length / 8);
          if (index % every !== 0 && index !== points.length - 1) return null;
          return (
            <text
              key={`label-${point.label}-${index}`}
              x={x(index)}
              y={height - 8}
              textAnchor="middle"
              className="fill-black/40"
              fontSize={10}
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  /** Optional second figure shown under the bar, e.g. a share of the total. */
  secondary?: string;
}

export function BarChart({
  data,
  ariaLabel,
  formatValue = (value) => String(value),
  color = '#1E4D33',
  emptyLabel = 'Nothing to rank yet.',
  onSelect,
}: {
  data: BarDatum[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
  color?: string;
  emptyLabel?: string;
  onSelect?: (label: string) => void;
}) {
  if (data.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-black/15 bg-white/50 p-6 text-center text-sm text-black/55">
        {emptyLabel}
      </p>
    );
  }
  const max = Math.max(...data.map((row) => row.value), 1);

  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {data.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(row.label)}
                  className="truncate text-left text-sm text-ink underline decoration-black/20 underline-offset-4 hover:decoration-brand-deep"
                >
                  {row.label}
                </button>
              ) : (
                <span className="truncate text-sm text-ink">{row.label}</span>
              )}
              <span className="shrink-0 font-mono text-xs text-black/55">{formatValue(row.value)}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(row.value / max) * 100}%`, background: color }}
                role="img"
                aria-label={`${row.label}: ${formatValue(row.value)}`}
              />
            </div>
            {row.secondary && <p className="mt-1 text-[11px] text-black/40">{row.secondary}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DonutChart({
  data,
  ariaLabel,
  formatValue = (value) => String(value),
}: {
  data: Array<{ label: string; value: number; color: string }>;
  ariaLabel: string;
  formatValue?: (value: number) => string;
}) {
  const total = data.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-black/15 bg-white/50 p-6 text-center text-sm text-black/55">
        No breakdown is available for this period.
      </p>
    );
  }

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <figure className="flex flex-wrap items-center gap-6" aria-label={ariaLabel}>
      <svg viewBox="0 0 160 160" className="h-40 w-40" role="img">
        <title>{ariaLabel}</title>
        {data.map((row) => {
          const fraction = row.value / total;
          const dash = fraction * circumference;
          const segment = (
            <circle
              key={row.label}
              cx={80}
              cy={80}
              r={radius}
              fill="none"
              stroke={row.color}
              strokeWidth={18}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            >
              <title>{`${row.label}: ${formatValue(row.value)} (${(fraction * 100).toFixed(1)}%)`}</title>
            </circle>
          );
          offset += dash;
          return segment;
        })}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {data.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} aria-hidden="true" />
            <span className="text-black/70">{row.label}</span>
            <span className="ml-auto font-mono text-xs text-black/50">
              {formatValue(row.value)} · {((row.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A compact period comparison used inside KPI cards. */
export function Sparkline({ values, color = '#1E4D33' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const width = 120;
  const height = 28;
  const stepX = width / (values.length - 1);
  const path = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${index * stepX} ${height - (value / max) * height}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-full" aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

/** The table behind a chart — the same numbers, in a form that can be copied. */
export function DataTable({
  columns,
  rows,
  caption,
  emptyLabel = 'No rows for this period.',
  dense = false,
}: {
  columns: Array<{ key: string; header: string; align?: 'left' | 'right' }>;
  rows: Array<Record<string, string | number | null>>;
  caption?: string;
  emptyLabel?: string;
  dense?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-black/15 bg-white/50 p-6 text-center text-sm text-black/55">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className={`w-full text-left ${dense ? 'text-xs' : 'text-sm'}`}>
        {caption && <caption className="px-4 pt-3 text-left text-xs text-black/45">{caption}</caption>}
        <thead className="bg-black/[0.03] text-[11px] uppercase tracking-widest text-black/40">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-2.5 ${column.align === 'right' ? 'text-right' : ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)} className="hover:bg-black/[0.015]">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-2.5 align-top text-black/70 ${column.align === 'right' ? 'text-right font-mono' : ''}`}
                >
                  {row[column.key] === null || row[column.key] === undefined ? '—' : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
