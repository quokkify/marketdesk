// Pure helpers behind the sale verdict shown in the catalogue row and on the product page.
import type {
  ProductVerdictView,
  SaleVerdict,
  VerdictCheck,
  VerdictCheckName,
  VerdictCheckStatus,
  VerdictOverall,
} from '@shared/types';

export const VERDICT_CHECK_ORDER: readonly VerdictCheckName[] = ['info', 'price', 'photos', 'category', 'attributes', 'delivery'];

const CHECK_NAMES: Record<VerdictCheckName, string> = {
  info: 'Info',
  price: 'Price',
  photos: 'Photos',
  category: 'Category',
  attributes: 'Attributes',
  delivery: 'Delivery',
};

const OVERALL_LABELS: Record<VerdictOverall, string> = {
  ready: 'Ready to sell',
  fix: 'Not ready',
  needs_human: 'Needs you',
};

const STATUS_MARKS: Record<Exclude<VerdictCheckStatus, 'pending'>, string> = {
  ready: '✓',
  fix: '✗',
  needs_human: '?',
};

export const PENDING_LABEL = 'researching…';
export const STALE_LABEL = 'Out of date — run Analyze';
export const LAST_RUN_FAILED_LABEL = 'Last run failed';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function overallLabel(overall: VerdictOverall | null): string | null {
  return overall ? OVERALL_LABELS[overall] : null;
}

export function overallColor(overall: VerdictOverall | null): 'success' | 'warning' | 'error' | 'default' {
  if (overall === 'ready') return 'success';
  if (overall === 'fix') return 'warning';
  if (overall === 'needs_human') return 'error';
  return 'default';
}

function time(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

// A verdict describes the product as it was when the run completed; a later edit of the
// product or of its listing makes it out of date.
export function isVerdictStale(
  verdict: Pick<SaleVerdict, 'completedAt'>,
  productUpdatedAt: string | null | undefined,
  listingUpdatedAt: string | null | undefined
): boolean {
  const completed = time(verdict.completedAt);
  if (Number.isNaN(completed)) return false;
  return time(productUpdatedAt) > completed || time(listingUpdatedAt) > completed;
}

const CURRENCY_SYMBOLS: Record<string, string> = { PLN: 'zł' };

function figure(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// "Price ✗ 349 → 279 zł" when the price check proposes a price, "Photos ✓(4)" with the photo count.
export function checkLabel(check: VerdictCheck): string {
  const name = CHECK_NAMES[check.check];
  if (check.status === 'pending') return `${name} ${PENDING_LABEL}`;
  const label = `${name} ${STATUS_MARKS[check.status]}`;
  const { currentPrice, proposedPrice, currency, photoCount } = check.refs;
  if (check.check === 'price' && currentPrice !== undefined && proposedPrice != null) {
    const unit = currency ? (CURRENCY_SYMBOLS[currency] ?? currency) : '';
    return `${label} ${figure(currentPrice)} → ${figure(proposedPrice)}${unit ? ` ${unit}` : ''}`;
  }
  if (check.check === 'photos' && check.status === 'ready' && photoCount !== undefined) {
    return `${label}(${photoCount})`;
  }
  return label;
}

export function newestCheckAt(verdict: Pick<SaleVerdict, 'checks'>): string | null {
  let newest: string | null = null;
  for (const check of Object.values(verdict.checks)) {
    if (check && (newest === null || time(check.checkedAt) > time(newest))) newest = check.checkedAt;
  }
  return newest;
}

// A check at least a minute older than the newest one of the verdict came from an earlier run:
// say how old it is.
export function checkAge(check: VerdictCheck, newestAt: string | null, now: number): string | null {
  if (!newestAt || time(newestAt) - time(check.checkedAt) < MINUTE_MS) return null;
  const elapsed = Math.max(0, now - time(check.checkedAt));
  if (elapsed < HOUR_MS) return `${Math.max(1, Math.floor(elapsed / MINUTE_MS))} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return `${Math.floor(elapsed / DAY_MS)} d ago`;
}

// The first reason of the first check that is not ready, for the line under the row.
export function leadingReason(verdict: Pick<SaleVerdict, 'checks'>): string | null {
  for (const name of VERDICT_CHECK_ORDER) {
    const check = verdict.checks[name];
    if (check && check.status !== 'ready' && check.reasons.length > 0) return check.reasons[0]!.message;
  }
  return null;
}

export interface VerdictMark {
  productId: string;
  latestId: string | null;
  completedAt: string | null;
  active: boolean;
}

export function verdictMark(productId: string, view: ProductVerdictView): VerdictMark {
  return {
    productId,
    latestId: view.latest?.id ?? null,
    completedAt: view.latest?.completedAt ?? null,
    active: view.active !== null,
  };
}

// A run just ended: no run is active now, and either one was active before or the latest verdict
// changed (a fast run can finish between two reads without ever being seen active). Reading a
// different product is never an ending.
export function verdictSettled(prev: VerdictMark | null, next: VerdictMark): boolean {
  if (!prev || prev.productId !== next.productId || next.active) return false;
  return prev.active || prev.latestId !== next.latestId || prev.completedAt !== next.completedAt;
}
