import { env } from '../../env';
import { ApiError } from '../../lib/errors';

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
export type Bucket = 'hour' | 'day' | 'week';

export interface ResolvedRange {
  preset: RangePreset;
  timezone: string;
  /** Inclusive ISO instants. */
  from: string;
  to: string;
  /** The same number of milliseconds immediately before `from`, for comparison. */
  previousFrom: string;
  previousTo: string;
  bucket: Bucket;
  /** Human label for the period, e.g. "2 Oct – 12 Oct 2026". */
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 400;

/**
 * Offset of a timezone at a given instant, in milliseconds.
 *
 * JavaScript has no timezone arithmetic, so the offset is read back from
 * `Intl` by formatting the instant in that zone and comparing it with the same
 * wall-clock reading treated as UTC. This is exact for the instant asked about;
 * a range spanning a DST change re-reads it at each boundary rather than
 * assuming a fixed offset.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const read = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - instant.getTime() + instant.getMilliseconds();
}

/** Midnight at the start of the day containing `instant`, in `timeZone`. */
export function startOfDay(instant: Date, timeZone: string): Date {
  const offset = zoneOffsetMs(instant, timeZone);
  const wall = instant.getTime() + offset;
  const midnightWall = Math.floor(wall / DAY_MS) * DAY_MS;
  // Re-read the offset at the candidate instant so a DST change on the boundary
  // lands on the right hour rather than an hour off.
  const candidate = new Date(midnightWall - offset);
  const corrected = midnightWall - zoneOffsetMs(candidate, timeZone);
  return new Date(corrected);
}

/** Adds whole days in local time, keeping the local time of day. */
export function addDays(instant: Date, days: number, timeZone: string): Date {
  return new Date(startOfDay(instant, timeZone).getTime() + days * DAY_MS);
}

/** Parses `YYYY-MM-DD` as local midnight in `timeZone`. */
export function parseLocalDate(value: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw ApiError.badRequest('Dates must be written as YYYY-MM-DD.', { received: value });
  }
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11 || Number(day) < 1 || Number(day) > 31) {
    throw ApiError.badRequest('That date does not exist.', { received: value });
  }
  // The wall clock reading the caller meant, then the offset that maps it back
  // to a real instant. Read twice so a DST boundary resolves correctly.
  const wall = Date.UTC(Number(year), monthIndex, Number(day), 0, 0, 0);
  const offset = zoneOffsetMs(new Date(wall), timeZone);
  return new Date(wall - zoneOffsetMs(new Date(wall - offset), timeZone));
}

function formatDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
}

function chooseBucket(from: Date, to: Date, preset: RangePreset): Bucket {
  if (preset === 'today') return 'hour';
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  return days > 100 ? 'week' : 'day';
}

/**
 * Turns a preset (or a custom `from`/`to`) into concrete instants, plus the
 * immediately preceding window of the same length for period-over-period
 * comparisons. Day boundaries are computed in the configured analytics timezone.
 */
export function resolveRange(input: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): ResolvedRange {
  const timezone = env.analytics.timezone;
  const now = input.now ?? new Date();
  const presetInput = (input.preset ?? '').trim();

  let preset: RangePreset;
  let from: Date;
  let to: Date;

  if (presetInput === 'custom' || (!presetInput && (input.from || input.to))) {
    preset = 'custom';
    const rawFrom = (input.from ?? '').trim();
    const rawTo = (input.to ?? input.from ?? '').trim();
    if (!rawFrom || !rawTo) {
      throw ApiError.badRequest('A custom range needs both `from` and `to` dates.');
    }
    from = parseLocalDate(rawFrom, timezone);
    const toStart = parseLocalDate(rawTo, timezone);
    // The end date is inclusive: the range covers the whole of that day.
    const toEnd = new Date(startOfDay(new Date(toStart.getTime() + DAY_MS), timezone).getTime() - 1);
    to = toEnd.getTime() > now.getTime() ? now : toEnd;
    if (from.getTime() > to.getTime()) {
      throw ApiError.badRequest('The start date must not be after the end date.', {
        from: rawFrom,
        to: rawTo,
      });
    }
    const days = (to.getTime() - from.getTime()) / DAY_MS;
    if (days > MAX_RANGE_DAYS) {
      throw ApiError.badRequest(`Ranges longer than ${MAX_RANGE_DAYS} days are not available.`, {
        days: Math.round(days),
      });
    }
  } else {
    preset = (['today', '7d', '30d', '90d'] as const).includes(presetInput as never)
      ? (presetInput as RangePreset)
      : '30d';
    const daysBack = preset === 'today' ? 0 : preset === '7d' ? 6 : preset === '30d' ? 29 : 89;
    from = addDays(now, -daysBack, timezone);
    to = now;
  }

  const duration = to.getTime() - from.getTime() + 1;
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration + 1);

  return {
    preset,
    timezone,
    from: from.toISOString(),
    to: to.toISOString(),
    previousFrom: previousFrom.toISOString(),
    previousTo: previousTo.toISOString(),
    bucket: chooseBucket(from, to, preset),
    label:
      startOfDay(from, timezone).getTime() === startOfDay(to, timezone).getTime()
        ? formatDate(from, timezone)
        : `${formatDate(from, timezone)} – ${formatDate(to, timezone)}`,
  };
}

export interface BucketPoint {
  /** ISO instant the bucket starts at. */
  start: string;
  /** Calm label for an axis tick. */
  label: string;
  /** The instant the bucket ends (exclusive). */
  end: string;
}

/**
 * Every bucket the range covers, including empty ones — a chart with a missing
 * day would otherwise read as a drop to zero, which is a different fact.
 */
export function buildBuckets(range: ResolvedRange): BucketPoint[] {
  const timezone = range.timezone;
  const from = new Date(range.from);
  const to = new Date(range.to);
  const points: BucketPoint[] = [];
  const stepMs = range.bucket === 'hour' ? 60 * 60 * 1000 : range.bucket === 'week' ? 7 * DAY_MS : DAY_MS;

  const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' });
  const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  let cursor =
    range.bucket === 'hour'
      ? new Date(Math.floor(from.getTime() / stepMs) * stepMs)
      : startOfDay(from, timezone);

  while (cursor.getTime() <= to.getTime()) {
    const end = new Date(cursor.getTime() + stepMs);
    points.push({
      start: cursor.toISOString(),
      end: end.toISOString(),
      label: range.bucket === 'hour' ? hourFormatter.format(cursor) : dayFormatter.format(cursor),
    });
    cursor = end;
  }

  // A week bucket that overshoots the range is trimmed rather than dropped, so
  // the last bar does not imply data beyond `to`.
  return points;
}

/** Which bucket an instant belongs to, given the range's bucketing. */
export function bucketStart(instant: Date, range: ResolvedRange): number {
  if (range.bucket === 'hour') {
    return Math.floor(instant.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
  }
  if (range.bucket === 'week') {
    const start = startOfDay(new Date(range.from), range.timezone).getTime();
    const days = Math.floor((startOfDay(instant, range.timezone).getTime() - start) / DAY_MS);
    return start + Math.floor(days / 7) * 7 * DAY_MS;
  }
  return startOfDay(instant, range.timezone).getTime();
}

/** Local calendar day key (`YYYY-MM-DD`) for a timestamp, in the range's zone. */
export function dayKey(instant: Date, timeZone: string): string {
  const offset = zoneOffsetMs(instant, timeZone);
  return new Date(instant.getTime() + offset).toISOString().slice(0, 10);
}
