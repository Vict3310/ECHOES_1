export function formatMoney(minor: number, currency = 'NGN'): string {
  const value = minor / 100;
  const formatter = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
  return formatter.format(value);
}

export function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatMeters(meters: number): string {
  return formatDistanceKm(meters / 1000);
}

export function formatSeconds(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function formatMinutes(minutes: number): string {
  return formatSeconds(minutes * 60);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'full',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

const CATEGORY_LABELS: Record<string, string> = {
  'historical-architecture': 'Historical architecture',
  'heritage-site': 'Heritage site',
  'cultural-landmark': 'Cultural landmark',
  museum: 'Museum',
  market: 'Market',
  'public-art': 'Public art',
  'traditional-site': 'Traditional site',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/-/g, ' ');
}

export const PLACE_CATEGORIES = Object.keys(CATEGORY_LABELS);
