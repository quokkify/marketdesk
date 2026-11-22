// Price research of one product: the form the owner fills in, the body the API takes, and the
// lines that show an estimate. The limits mirror the server's rules.
import type {
  AnchorTier,
  ClassAttribute,
  EstimateHiddenReason,
  PriceComparable,
  PriceComparableSource,
  PriceEstimate,
  PriceResearch,
  PriceResearchView,
  ResearchRun,
  StoredPriceEstimate,
} from '@shared/types';
import { normalizeOlxAdvertUrl } from '@shared/olxAdvertUrl';
import { currencySymbol, formatDateTime, formatMoney, formatRelative } from '../../utils/formatters.js';

export const MAX_COMPARABLES = 30;
export const MAX_SOURCE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 300;
export const MAX_URL_LENGTH = 500;
export const MAX_PRICE = 9_999_999_999.99;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUS = '−';

export interface PriceResearchForm {
  retailPrice: string;
  retailCurrency: string;
  retailSource: string;
  retailCheckedAt: string;
  comparables: { price: string; note: string; url?: string; source?: PriceComparableSource; tier?: AnchorTier;
    seenAt?: string;
    classAttributes?: ClassAttribute[];
    classChecked?: boolean;
  }[];
  // The updatedAt of the research this form was built from; the server refuses the save if it moved on.
  baseUpdatedAt: string | null;
}

export interface PriceResearchBody {
  retailPrice: number | null;
  retailCurrency: string | null;
  retailSource: string | null;
  retailCheckedAt: string | null;
  comparables: PriceComparable[];
  baseUpdatedAt: string | null;
}

export type PriceResearchBodyResult =
  | { ok: true; body: PriceResearchBody }
  | { ok: false; errors: Record<string, string> };

export function toPriceResearchForm(r: PriceResearch | null, defaultCurrency = ''): PriceResearchForm {
  if (!r) {
    return { retailPrice: '', retailCurrency: defaultCurrency, retailSource: '', retailCheckedAt: '', comparables: [], baseUpdatedAt: null };
  }
  return {
    retailPrice: r.retailPrice === null ? '' : String(r.retailPrice),
    retailCurrency: r.retailCurrency ?? defaultCurrency,
    retailSource: r.retailSource ?? '',
    retailCheckedAt: r.retailCheckedAt ?? '',
    comparables: r.comparables.map((c) => ({
      price: String(c.price),
      note: c.note,
      ...(c.url ? { url: c.url } : {}),
      ...(c.source ? { source: c.source } : {}),
      ...(c.tier ? { tier: c.tier } : {}),
      ...(c.seenAt ? { seenAt: c.seenAt } : {}),
      ...(c.classAttributes ? { classAttributes: c.classAttributes } : {}),
      ...(typeof c.classChecked === 'boolean' ? { classChecked: c.classChecked } : {}),
    })),
    baseUpdatedAt: r.updatedAt,
  };
}

const PRICE_ERROR = 'Enter a price above zero and at most 9999999999.99';

function parsePrice(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= MAX_PRICE ? value : null;
}

function isIsoDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function toPriceResearchBody(f: PriceResearchForm): PriceResearchBodyResult {
  const errors: Record<string, string> = {};

  const priceText = f.retailPrice.trim();
  let retailPrice: number | null = null;
  if (priceText) {
    retailPrice = parsePrice(priceText);
    if (retailPrice === null) errors.retailPrice = PRICE_ERROR;
  }

  const currency = f.retailCurrency.trim().toUpperCase();
  if (priceText && !CURRENCY_PATTERN.test(currency)) {
    errors.retailCurrency = 'Enter a three-letter currency code, such as PLN';
  }

  const source = f.retailSource.trim();
  if (source.length > MAX_SOURCE_LENGTH) errors.retailSource = `Keep the source within ${MAX_SOURCE_LENGTH} characters`;

  const checkedAt = f.retailCheckedAt.trim();
  if (checkedAt && !isIsoDate(checkedAt)) errors.retailCheckedAt = 'Enter the date as YYYY-MM-DD';

  const rows = f.comparables
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.price.trim() !== '' || row.note.trim() !== '');
  if (rows.length > MAX_COMPARABLES) errors.comparables = `Keep at most ${MAX_COMPARABLES} comparables`;
  const comparables: PriceComparable[] = [];
  for (const { row, index } of rows) {
    const price = parsePrice(row.price);
    const note = row.note.trim();
    if (price === null) errors[`comparables.${index}.price`] = PRICE_ERROR;
    if (note.length > MAX_NOTE_LENGTH) errors[`comparables.${index}.note`] = `Keep the note within ${MAX_NOTE_LENGTH} characters`;
    const url = row.url?.trim() ?? '';
    if (url && (url.length > MAX_URL_LENGTH || !url.startsWith('https://'))) {
      errors[`comparables.${index}.url`] = `Enter an https link of at most ${MAX_URL_LENGTH} characters`;
    } else if (row.source === 'web' && (!url || normalizeOlxAdvertUrl(url) === null)) {
      errors[`comparables.${index}.url`] = 'Enter an OLX advert link';
    }
    if (price !== null) {
      comparables.push({
        price,
        note,
        ...(url ? { url } : {}),
        ...(row.source ? { source: row.source } : {}),
        ...(row.tier ? { tier: row.tier } : {}),
        ...(row.seenAt ? { seenAt: row.seenAt } : {}),
        ...(row.classAttributes ? { classAttributes: row.classAttributes } : {}),
        ...(typeof row.classChecked === 'boolean' ? { classChecked: row.classChecked } : {}),
      });
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      retailPrice,
      retailCurrency: retailPrice === null ? null : currency,
      retailSource: source || null,
      retailCheckedAt: checkedAt || null,
      comparables,
      baseUpdatedAt: f.baseUpdatedAt,
    },
  };
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

// A price the owner types over a web or auto row is no longer the advert's price, so the row becomes manual.
// An auto row keeps its tier, so it still counts toward its tier's anchor.
export function editComparablePrice(
  rows: PriceResearchForm['comparables'],
  index: number,
  price: string,
): PriceResearchForm['comparables'] {
  return rows.map((row, i) => {
    if (i !== index) return row;
    if (row.price === price) return { ...row, price };
    if (row.source === 'auto') {
      const { url: _url, seenAt: _seenAt, ...rest } = row;
      return { ...rest, price, source: 'manual' };
    }
    if (row.source !== 'web') return { ...row, price };
    const { source: _source, url: _url, ...manual } = row;
    return { ...manual, price };
  });
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

export interface AnchorTierLine {
  tier: AnchorTier;
  label: string;
  text: string;
  rows: PriceComparable[];
}

const TIER_LABELS: [AnchorTier, string][] = [
  ['same_model_used', 'Same model, used'],
  ['last_new_price', 'Last new price'],
  ['substitute_new', 'New substitutes'],
  ['substitute_used', 'Used substitutes'],
];
const NOT_FOUND = 'not found';

function rangeText(prices: number[], currency: string): string {
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  if (low === high) return formatMoney(high, currency);
  const suffix = ` ${currencySymbol(currency)}`;
  return `${formatMoney(low, currency).slice(0, -suffix.length)}–${formatMoney(high, currency)}`;
}

function tierText(tier: AnchorTier, rows: PriceComparable[], currency: string): string {
  if (rows.length === 0) return NOT_FOUND;
  const prices = rows.map((r) => r.price);
  if (tier === 'last_new_price') {
    const cheapest = rows.reduce((a, b) => (b.price < a.price ? b : a));
    return `${formatMoney(cheapest.price, currency)}${cheapest.note ? ` · ${cheapest.note}` : ''}`;
  }
  if (tier === 'substitute_new') return `from ${formatMoney(Math.min(...prices), currency)} (${rows.length})`;
  return `${rangeText(prices, currency)} (${rows.length})`;
}

// A row saved before tiers existed has no tier; it was a comparable of the same model.
export function anchorTierLines(r: PriceResearch | null, currency: string): AnchorTierLine[] {
  return TIER_LABELS.map(([tier, label]) => {
    const rows = (r?.comparables ?? []).filter((c) => (c.tier ?? 'same_model_used') === tier);
    return { tier, label, text: tierText(tier, rows, currency), rows };
  });
}

const HIDDEN_REASON_TEXT: Record<EstimateHiddenReason, string> = {
  low_confidence: 'Not suggested: confidence is low.',
  within_threshold: 'Not suggested: within 5 % of the current price.',
  floor_cancels: 'Not suggested: your lowest acceptable price blocks this change.',
};

export function storedEstimateLines(s: StoredPriceEstimate | null, currency: string): string[] {
  if (!s) return [];
  const lines = estimateLines(s.estimate, currency);
  if (s.hiddenReason) lines.push(HIDDEN_REASON_TEXT[s.hiddenReason]);
  if (s.researchNote) lines.push(s.researchNote);
  return lines;
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
  unusable_answer: 'the model could not be identified',
  timeout: 'the search took too long',
};
const FALLBACK_REASON = 'something went wrong';

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
  const reason = (last.errorCode && ERROR_REASONS[last.errorCode]) || FALLBACK_REASON;
  return `Price search failed: ${reason}.${retry ? ` Will retry ${retry}` : ''}`;
}

// What a substitute row was matched on, for the line under its price.
export function classLine(row: PriceComparable): string | null {
  if (row.classChecked === false) return 'class unchecked';
  const parts = (row.classAttributes ?? []).map((a) => `${a.value}${a.unit ? ` ${a.unit}` : ''}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// New research arrived under an open editor: a clean editor takes it, a dirty one is never overwritten.
export function shouldRekeyEditor(
  dirty: boolean,
  prevUpdatedAt: string | null,
  nextUpdatedAt: string | null,
): 'rekey' | 'notice' | 'keep' {
  if (prevUpdatedAt === nextUpdatedAt) return 'keep';
  return dirty ? 'notice' : 'rekey';
}

// The stored research of a view, or null while the view only carries a run that has stored nothing yet.
export function storedResearch(view: PriceResearchView | null | undefined): PriceResearch | null {
  if (!view || view.updatedAt === null) return null;
  return { ...view, updatedAt: view.updatedAt };
}
