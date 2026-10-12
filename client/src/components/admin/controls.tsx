import { useEffect, useId, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarRange, Info, Loader2, RefreshCw, X } from 'lucide-react';
import {
  FRESHNESS_LABEL,
  FRESHNESS_STYLE,
  RANGE_PRESETS,
  changeDisplay,
  formatKpiValue,
  type DataFreshness,
  type KpiValue,
} from '../../lib/analytics';

export interface RangeSelection {
  preset: 'today' | '7d' | '30d' | '90d' | 'custom';
  from?: string;
  to?: string;
}

/**
 * The period every section reads. The selection is controlled by the console so
 * one range applies to every panel — a dashboard where each card has its own
 * silently different window is worse than no dashboard.
 */
export function DateRangePicker({
  value,
  onChange,
  onRefresh,
  refreshing,
  freshness,
}: {
  value: RangeSelection;
  onChange: (next: RangeSelection) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  freshness?: DataFreshness;
}) {
  const [customOpen, setCustomOpen] = useState(value.preset === 'custom');
  const [from, setFrom] = useState(value.from ?? '');
  const [to, setTo] = useState(value.to ?? '');

  useEffect(() => {
    if (value.preset === 'custom') {
      setFrom(value.from ?? '');
      setTo(value.to ?? '');
    }
  }, [value]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <span className="field-label">Period</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={value.preset === preset.id}
              onClick={() => {
                if (preset.id === 'custom') {
                  setCustomOpen(true);
                  onChange({ preset: 'custom', from: from || undefined, to: to || undefined });
                  return;
                }
                setCustomOpen(false);
                onChange({ preset: preset.id });
              }}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                value.preset === preset.id
                  ? 'bg-brand-deep text-white'
                  : 'border border-black/15 text-black/60 hover:bg-black/[0.04]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {customOpen && (
        <div className="flex items-end gap-2">
          <label className="text-xs">
            <span className="field-label">From</span>
            <input
              type="date"
              className="rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-xs"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              onBlur={() => onChange({ preset: 'custom', from: from || undefined, to: to || undefined })}
            />
          </label>
          <label className="text-xs">
            <span className="field-label">To</span>
            <input
              type="date"
              className="rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-xs"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              onBlur={() => onChange({ preset: 'custom', from: from || undefined, to: to || undefined })}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onChange({ preset: 'custom', from: from || undefined, to: to || undefined })}
          >
            <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
            Apply
          </button>
        </div>
      )}

      {onRefresh && (
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Refresh
        </button>
      )}

      {freshness && <FreshnessStamp freshness={freshness} />}
    </div>
  );
}

/**
 * When the figures were computed, how far back collection actually reaches, and
 * any caveat that changes how they should be read. Every claim on the page is
 * qualified here rather than in a footnote nobody opens.
 */
export function FreshnessStamp({ freshness }: { freshness: DataFreshness }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const last = freshness.lastEventAt ? new Date(freshness.lastEventAt) : null;

  return (
    <div className="ml-auto max-w-md text-right text-[11px] text-black/45">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-2.5 py-1 hover:bg-black/[0.03]"
      >
        <Info className="h-3 w-3" aria-hidden="true" />
        Data as of {new Date(freshness.generatedAt).toLocaleTimeString()} · {freshness.timezone}
        {freshness.caveats.length > 0 && (
          <span className="rounded-full bg-[#C8973F]/20 px-1.5 py-0.5 text-[10px] text-[#7A5518]">
            {freshness.caveats.length} note{freshness.caveats.length === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {open && (
        <div
          id={detailsId}
          className="mt-2 space-y-1.5 rounded-2xl border border-black/10 bg-white/80 p-3 text-left text-[11px] leading-relaxed text-black/60"
        >
          <p>
            Last recorded event:{' '}
            {last ? `${last.toLocaleDateString()} ${last.toLocaleTimeString()}` : 'none yet'}
          </p>
          <p>
            Collection began:{' '}
            {freshness.collectionStart ? new Date(freshness.collectionStart).toLocaleDateString() : 'not yet started'}
          </p>
          <p>
            {freshness.totalEventsStored.toLocaleString()} events stored · raw events are kept for{' '}
            {freshness.retentionDays} days
          </p>
          {freshness.caveats.map((caveat) => (
            <p key={caveat} className="text-[#7A5518]">
              {caveat}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One KPI. The card shows the number and its comparison; the definition, source,
 * time window and freshness are one interaction away but always present, because
 * an operator should never have to trust a figure they cannot check.
 */
export function KpiCard({
  kpi,
  currency = 'NGN',
  onOpen,
  openTarget,
}: {
  kpi: KpiValue;
  currency?: string;
  onOpen?: () => void;
  openTarget?: string;
}) {
  const [showDefinition, setShowDefinition] = useState(false);
  const change = changeDisplay(kpi, currency);
  const detailsId = useId();

  const tone =
    change.direction === 'up'
      ? 'text-brand-deep'
      : change.direction === 'down'
        ? 'text-[#8E3320]'
        : 'text-black/45';

  return (
    // `data-kpi` is the stable hook tests and deep links use; the label is for humans.
    <div className="card flex flex-col p-4" data-kpi={kpi.id}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-widest text-black/40">{kpi.label}</p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${FRESHNESS_STYLE[kpi.freshness]}`}
          title={`Freshness: ${FRESHNESS_LABEL[kpi.freshness]}`}
        >
          {FRESHNESS_LABEL[kpi.freshness]}
        </span>
      </div>

      <p className="mt-2 font-display text-3xl font-light tracking-tighter">
        {formatKpiValue(kpi.value, kpi.unit, currency)}
      </p>

      <p className={`mt-1 text-xs ${tone}`} title={change.title}>
        {change.text}
        {change.direction !== 'unknown' && change.direction !== 'new' && kpi.percentChange !== null && (
          <span className="ml-1.5 text-black/40">({change.absoluteText})</span>
        )}
      </p>

      <div className="mt-auto pt-3">
        <button
          type="button"
          onClick={() => setShowDefinition((current) => !current)}
          aria-expanded={showDefinition}
          aria-controls={detailsId}
          className="inline-flex items-center gap-1 text-[11px] text-black/45 hover:text-brand-deep"
        >
          <Info className="h-3 w-3" aria-hidden="true" />
          Definition
        </button>
        {showDefinition && (
          <div id={detailsId} className="mt-2 space-y-1 text-[11px] leading-relaxed text-black/60">
            <p>{kpi.definition}</p>
            <p className="text-black/45">
              Source: {kpi.source}
              {kpi.previous !== null && kpi.previous !== undefined
                ? ` · previous period: ${formatKpiValue(kpi.previous, kpi.unit, currency)}`
                : ''}
            </p>
            {kpi.unavailableReason && <p className="text-[#7A5518]">{kpi.unavailableReason}</p>}
          </div>
        )}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="mt-2 block text-[11px] text-brand-deep underline decoration-brand-deep/30 underline-offset-4"
          >
            Open {openTarget ?? 'details'}
          </button>
        )}
      </div>
    </div>
  );
}

export function KpiGrid({
  kpis,
  currency,
  onOpen,
  targetFor,
}: {
  kpis: KpiValue[];
  currency?: string;
  onOpen?: (section: string) => void;
  targetFor?: (kpi: KpiValue) => string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {kpis.map((kpi) => {
        const target = targetFor?.(kpi);
        return (
          <KpiCard
            key={kpi.id}
            kpi={kpi}
            currency={currency}
            openTarget={target}
            onOpen={onOpen && target ? () => onOpen(target) : undefined}
          />
        );
      })}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-xl tracking-tight">{title}</h3>
          {description && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-black/55">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Confirmation for anything destructive, with the reason captured for the audit log. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  requireReason = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  requireReason?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const titleId = useId();

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl border border-black/10 bg-cream p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#8E3320]" aria-hidden="true" />
          <div>
            <h4 id={titleId} className="font-display text-lg tracking-tight">
              {title}
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-black/60">{description}</p>
          </div>
          <button type="button" className="ml-auto text-black/40 hover:text-black" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {requireReason && (
          <label className="mt-4 block">
            <span className="field-label">Reason (recorded in the audit log)</span>
            <textarea
              rows={2}
              className="field-input resize-none"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || (requireReason && reason.trim().length < 3)}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
