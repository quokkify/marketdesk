// Presentation formatters. Currency/timezone default to the shared domain
// defaults but callers should pass the active workspace's currency/timezone.
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from '@shared/constants';

export function formatCurrency(
  amount: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  locale = 'en-US',
): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const MONEY_SUFFIX: Record<string, string> = { PLN: 'zł' };

export function currencySymbol(currency: string = DEFAULT_CURRENCY): string {
  return MONEY_SUFFIX[currency] ?? currency;
}

// Catalogue money style from the companion: "1 050 zł", "1 050,50 zł".
export function formatMoney(
  amount: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fraction = cents % 100 === 0 ? '' : `,${String(cents % 100).padStart(2, '0')}`;
  const sign = amount < 0 && cents > 0 ? '-' : '';
  return `${sign}${whole}${fraction} ${currencySymbol(currency)}`;
}

export function formatNumber(value: number | null | undefined, locale = 'en-US'): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
  locale = 'en-US',
): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

export function formatDate(
  iso: string | Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
  locale = 'en-US',
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone,
  }).format(date);
}

export function formatDateTime(
  iso: string | Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
  locale = 'en-US',
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

// Relative time such as "3 hours ago" — handy for Hermes activity feeds.
export function formatRelativeTime(iso: string | Date | null | undefined, locale = 'en-US'): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
    { amount: 4.34524, unit: 'week' },
    { amount: 12, unit: 'month' },
    { amount: Number.POSITIVE_INFINITY, unit: 'year' },
  ];
  let duration = diffMs / 1000;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return rtf.format(Math.round(duration), 'year');
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// Compact relative time ("5m ago", "2h ago", "3d ago", "2w ago") for tables and
// activity lists; anything older than five weeks or in the future shows its date.
export function formatRelative(
  iso: string | Date | null | undefined,
  now: Date | number = Date.now(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  const elapsed = (typeof now === 'number' ? now : now.getTime()) - date.getTime();
  if (Math.abs(elapsed) < MINUTE_MS) return 'just now';
  if (elapsed < 0 || elapsed >= 5 * WEEK_MS) return formatDate(date, timeZone);
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < WEEK_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return `${Math.floor(elapsed / WEEK_MS)}w ago`;
}
