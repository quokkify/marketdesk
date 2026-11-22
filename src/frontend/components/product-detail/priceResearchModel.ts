// Price research of one product: the form the owner fills in, the body the API takes, and the
// lines that show an estimate. The limits mirror the server's rules.
import type {
  AnchorTier,
  EstimateHiddenReason,
  PriceComparable,
  PriceComparableSource,
  PriceEstimate,
  PriceResearch,
  StoredPriceEstimate,
} from '@shared/types';
import { normalizeOlxAdvertUrl } from '@shared/olxAdvertUrl';
import { currencySymbol, formatMoney } from '../../utils/formatters.js';

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
  comparables: { price: string; note: string; url?: string; source?: PriceComparableSource; tier?: AnchorTier; seenAt?: string }[];
}

export interface PriceResearchBody {
  retailPrice: number | null;
  retailCurrency: string | null;
  retailSource: string | null;
  retailCheckedAt: string | null;
  comparables: PriceComparable[];
}

export type PriceResearchBodyResult =
  | { ok: true; body: PriceResearchBody }
  | { ok: false; errors: Record<string, string> };

export function toPriceResearchForm(r: PriceResearch | null, defaultCurrency = ''): PriceResearchForm {
  if (!r) {
    return { retailPrice: '', retailCurrency: defaultCurrency, retailSource: '', retailCheckedAt: '', comparables: [] };
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
    })),
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

export function usedRangeSourceNote(research: PriceResearch | null): string | null {
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
