// Price research of one product: the body the API takes and the lines that show an estimate.
// The limits mirror the server's rules.
import type {
  AnchorTier,
  EstimateHiddenReason,
  PriceComparable,
  PriceEstimate,
  PriceResearch,
  PriceResearchView,
  ResearchRun,
} from '@shared/types';
import { currencySymbol, formatDateTime, formatMoney, formatRelative } from '../../utils/formatters.js';

export const OLX_PLN_ONLY = 'OLX search needs a PLN listing';
export const OLX_CURRENCY = 'PLN';
export const MAX_COMPARABLES = 30;
export const MAX_URL_LENGTH = 500;
export const MAX_PRICE = 9_999_999_999.99;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUS = '−';

export interface PriceResearchBody {
  retailPrice: number | null;
  retailCurrency: string | null;
  retailSource: string | null;
  retailCheckedAt: string | null;
  comparables: PriceComparable[];
  baseUpdatedAt: string | null;
}

export const PRICE_ERROR = 'Enter a price above zero and at most 9999999999.99';

export function parsePrice(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= MAX_PRICE ? value : null;
}

export function isIsoDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function discountVsNew(price: number, retail: number | null): number | null {
  if (retail === null || !(retail > 0)) return null;
  return Math.round((price / retail - 1) * 100);
}

function percentText(percent: number): string {
  if (percent < 0) return `${MINUS}${-percent}%`;
  return percent > 0 ? `+${percent}%` : '0%';
}

// A percentage across two currencies would be meaningless, so it is only worded in one currency.
export function discountLine(price: number, research: PriceResearch | null, currency: string): string | null {
  if (!research || (research.retailCurrency && research.retailCurrency !== currency)) return null;
  const percent = discountVsNew(price, research.retailPrice);
  if (percent === null || research.retailPrice === null) return null;
  const origin = [research.retailSource, research.retailCheckedAt].filter(Boolean).join(', ');
  return `${percentText(percent)} vs new · ${formatMoney(research.retailPrice, currency)}${origin ? ` (${origin})` : ''}`;
}

export function usedRangeSourceNote(research: Pick<PriceResearch, 'comparables'> | null): string | null {
  const fromWeb = research?.comparables.filter((c) => c.source === 'web').length ?? 0;
  return fromWeb > 0 ? `${fromWeb} from OLX` : null;
}

export function estimateLines(e: PriceEstimate, currency: string, sourceNote: string | null = null): string[] {
  const lines = [`Start ${formatMoney(e.startPrice, currency)}`, `Floor ${formatMoney(e.floorPrice, currency)}`];
  if (e.retailAnchor) {
    lines.push(`New price ${formatMoney(e.retailAnchor.amount, currency)} · ${e.retailAnchor.basis}`);
  }
  if (e.usedRange) {
    const suffix = ` ${currencySymbol(currency)}`;
    const low = formatMoney(e.usedRange.low, currency).slice(0, -suffix.length);
    const note = sourceNote && e.usedRange.basis === 'observed' ? ` (${sourceNote})` : '';
    lines.push(`Used range ${low}–${formatMoney(e.usedRange.high, currency)} · ${e.usedRange.basis}${note}`);
  }
  if (e.retailAnchor) {
    const percent = discountVsNew(e.startPrice, e.retailAnchor.amount);
    if (percent !== null) lines.push(`${percentText(percent)} vs new`);
  }
  lines.push(`Confidence: ${e.confidence}`);
  return lines;
}

const TIER_LABELS: [AnchorTier, string][] = [
  ['same_model_used', 'Same model, used'],
  ['last_new_price', 'Last new price'],
  ['substitute_new', 'New substitutes'],
  ['substitute_used', 'Used substitutes'],
];
const HIDDEN_REASON_TEXT: Record<EstimateHiddenReason, string> = {
  low_confidence: 'Not suggested: confidence is low.',
  within_threshold: 'Not suggested: within 5 % of the current price.',
  floor_cancels: 'Not suggested: your lowest acceptable price blocks this change.',
};

export function hiddenReasonText(reason: EstimateHiddenReason | null): string | null {
  return reason ? HIDDEN_REASON_TEXT[reason] : null;
}

const TIER_NODES = ['sameModelUsed', 'lastNewPrice', 'substitutesNew', 'substitutesUsed'] as const;
const NODE_OVER = new Set(['done', 'failed', 'timeout']);

// What an active run is doing, or null when no run is active.
export function runProgressText(run: ResearchRun | null): string | null {
  if (!run || run.status === 'finished') return null;
  if (run.status === 'queued' || !run.nodes.identify || !NODE_OVER.has(run.nodes.identify)) return 'Identifying the model…';
  const done = TIER_NODES.filter((node) => NODE_OVER.has(run.nodes[node] ?? '')).length;
  return done === TIER_NODES.length ? 'Saving…' : `Searching prices: ${done} of ${TIER_NODES.length}`;
}

const ERROR_REASONS: Record<string, string> = {
  job_lost: 'the search was interrupted',
  lease_expired: 'the search was interrupted',
  enqueue_failed: 'the search was interrupted',
  unsafe_toolset: 'market search is unavailable',
  not_configured: 'market search is unavailable',
  research_unreachable: 'market search is unavailable',
  hermes_unavailable: 'market search is unavailable',
  unusable_answer: 'the search returned an unusable answer',
  no_substitutes: 'no comparable items were found',
  all_tiers_failed: 'none of the price searches returned an answer',
  not_pln: 'the listing is not in PLN',
  name_too_short: 'the product name is too short to search',
  product_missing: 'the product no longer exists',
  timeout: 'the search took too long',
};
const FALLBACK_REASON = 'something went wrong';

// An error code in words; an unknown or missing code gives the fallback, never the raw code.
export function errorReason(code: string | null): string {
  return (code && ERROR_REASONS[code]) || FALLBACK_REASON;
}

// The codes a sale verdict (analysis) run fails with; some share a name with a search code.
const VERDICT_ERROR_REASONS: Record<string, string> = {
  expired: 'the analysis took too long and was stopped',
  run_error: 'the analysis stopped with an error',
  store_failed: 'the result could not be saved',
  research_active: 'a price search was already running',
  enqueue_failed: 'the analysis could not be started',
};

// A verdict run's error code in words; an unknown or missing code gives the fallback, never the raw code.
export function verdictErrorReason(code: string | null): string {
  return (code && VERDICT_ERROR_REASONS[code]) || FALLBACK_REASON;
}

// When the anchors were last updated: the last finished run, else the research's own version.
export function anchorsUpdatedAt(last: ResearchRun | null, research: PriceResearch | null): string | null {
  if (last?.status === 'finished' && last.finishedAt) return last.finishedAt;
  return research?.updatedAt ?? null;
}

// The last finished run in words; never the raw error code.
export function lastRunText(last: ResearchRun | null, nextAutoAt: string | null, now: Date): string | null {
  if (!last || last.status !== 'finished' || !last.outcome) return null;
  const when = formatRelative(last.finishedAt, now);
  const retry = nextAutoAt ? formatDateTime(nextAutoAt) : null;
  if (last.outcome === 'ok') return `Prices searched ${when}`;
  if (last.outcome === 'partial') {
    const labels = last.failedTiers.map((tier) => TIER_LABELS.find(([t]) => t === tier)?.[1].toLowerCase() ?? tier);
    const failed = labels.length > 0 ? `; ${labels.join(', ')} search failed` : '';
    return `Prices searched ${when}${failed}${retry ? `, will retry ${retry}` : ''}`;
  }
  const reason = errorReason(last.errorCode);
  return `Price search failed: ${reason}.${retry ? ` Will retry ${retry}` : ''}`;
}

// What a substitute row was matched on, for the line under its price.
export function classLine(row: PriceComparable): string | null {
  if (row.classChecked === false) return 'class unchecked';
  const parts = (row.classAttributes ?? []).map((a) => `${a.value}${a.unit ? ` ${a.unit}` : ''}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// The stored research of a view, or null while the view only carries a run that has stored nothing yet.
export function storedResearch(view: PriceResearchView | null | undefined): PriceResearch | null {
  if (!view || view.updatedAt === null) return null;
  return { ...view, updatedAt: view.updatedAt };
}
