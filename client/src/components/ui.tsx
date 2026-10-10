import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { ApiClientError } from '../lib/api';
import { COVERAGE_LABELS, COVERAGE_SHORT, COVERAGE_TONE, SEVERITY_TONE } from '../lib/knowledge';
import type { CoverageStatus, KnowledgeGap } from '../lib/types';
import { Reveal, WordReveal } from './layout';

export function Loading({ label = 'Loading records…' }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white/60 px-5 py-4 text-sm text-black/60"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin text-brand-deep" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-black/[0.06] ${className}`} aria-hidden="true" />;
}

export function ErrorState({
  error,
  onRetry,
  title = 'Something went wrong',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const isNetwork = error instanceof ApiClientError && error.status === 0;
  const message =
    error instanceof ApiClientError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred.';

  return (
    <div
      className="rounded-2xl border border-[#B4432A]/25 bg-[#B4432A]/[0.06] p-6 text-sm text-[#7A2C1B]"
      role="alert"
    >
      <div className="mb-2 flex items-center gap-2 font-medium">
        {isNetwork ? (
          <WifiOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        )}
        {isNetwork ? 'The ECHOES API is unreachable' : title}
      </div>
      <p className="leading-relaxed">{message}</p>
      {error instanceof ApiClientError && Array.isArray(error.details) && (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {(error.details as Array<{ path: string; message: string }>).map((detail) => (
            <li key={`${detail.path}-${detail.message}`}>
              <span className="font-medium">{detail.path}</span>: {detail.message}
            </li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-4">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-black/15 bg-white/50 p-8 text-center">
      <p className="font-display text-lg tracking-tight">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-black/55">{description}</p>}
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div>
  );
}

export function OfflineBanner({ onRetry, notice }: { onRetry?: () => void; notice: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#C8973F]/30 bg-[#C8973F]/10 px-5 py-4 text-sm text-[#7A5518]">
      <div className="flex items-start gap-2">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="leading-relaxed">{notice}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary shrink-0">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}

export function StatusPill({ status, short = false }: { status: CoverageStatus; short?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${COVERAGE_TONE[status]}`}
      title={COVERAGE_LABELS[status]}
    >
      {short ? COVERAGE_SHORT[status] : COVERAGE_LABELS[status]}
    </span>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'dark' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${
        tone === 'dark'
          ? 'border-white/20 text-white/70'
          : 'border-black/15 text-black/60'
      }`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'warn' | 'brand';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    neutral: 'border-black/10 bg-white/60 text-black/70',
    warn: 'border-[#C8973F]/30 bg-[#C8973F]/10 text-[#7A5518]',
    brand: 'border-brand-deep/20 bg-brand-soft/60 text-brand-deep',
  } as const;
  return (
    <div className={`rounded-2xl border px-5 py-4 text-sm leading-relaxed ${tones[tone]}`}>
      {title && <p className="mb-1 font-medium">{title}</p>}
      {children}
    </div>
  );
}

export function GapRow({ gap }: { gap: KnowledgeGap }) {
  return (
    <li className="rounded-2xl border border-black/10 bg-white/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm tracking-tight">{gap.label}</span>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${SEVERITY_TONE[gap.severity]}`}
        >
          {COVERAGE_LABELS[gap.status]}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-black/60">{gap.evidence}</p>
      {gap.contributionHint && (
        <p className="mt-2 text-xs leading-relaxed text-brand-deep">
          <span className="font-medium">How to help: </span>
          {gap.contributionHint}
        </p>
      )}
    </li>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  accent,
  description,
  dark = false,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  description?: string;
  dark?: boolean;
}) {
  return (
    <div className="max-w-3xl">
      {eyebrow && (
        <Reveal>
          <p
            className={`mb-6 text-xs font-medium uppercase tracking-[0.25em] ${
              dark ? 'text-brand' : 'text-brand-deep'
            }`}
          >
            {eyebrow}
          </p>
        </Reveal>
      )}
      <h2
        className={`font-display text-4xl font-light leading-[1.05] tracking-tighter sm:text-5xl ${
          dark ? 'text-white' : 'text-ink'
        }`}
      >
        <WordReveal text={title} as="span" />
        {accent && (
          <>
            {' '}
            <em className="font-serif font-normal italic">
              <WordReveal text={accent} as="span" delay={0.12} />
            </em>
          </>
        )}
      </h2>
      {description && (
        <Reveal delay={0.1}>
          <p className={`mt-6 max-w-xl text-base leading-relaxed ${dark ? 'text-white/60' : 'text-black/60'}`}>
            {description}
          </p>
        </Reveal>
      )}
    </div>
  );
}
