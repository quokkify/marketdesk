// Price research of one product: the form the owner fills in, the body the API takes, and the
// lines that show an estimate. The limits mirror the server's rules.
import type { PriceComparable, PriceComparableSource, PriceEstimate, PriceResearch } from '@shared/types';
import { normalizeOlxAdvertUrl } from '@shared/olxAdvertUrl';
import { currencySymbol, formatMoney } from '../../utils/formatters.js';

export const MAX_COMPARABLES = 10;
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
  comparables: { price: string; note: string; url?: string; source?: PriceComparableSource }[];
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
      comparables.push({ price, note, ...(url ? { url } : {}), ...(row.source ? { source: row.source } : {}) });
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

export function estimateLines(e: PriceEstimate, currency: string): string[] {
  const lines = [`Start ${formatMoney(e.startPrice, currency)}`, `Floor ${formatMoney(e.floorPrice, currency)}`];
  if (e.retailAnchor) {
    lines.push(`New price ${formatMoney(e.retailAnchor.amount, currency)} · ${e.retailAnchor.basis}`);
  }
  if (e.usedRange) {
    const suffix = ` ${currencySymbol(currency)}`;
    const low = formatMoney(e.usedRange.low, currency).slice(0, -suffix.length);
    lines.push(`Used range ${low}–${formatMoney(e.usedRange.high, currency)} · ${e.usedRange.basis}`);
  }
  if (e.retailAnchor) {
    const percent = discountVsNew(e.startPrice, e.retailAnchor.amount);
    if (percent !== null) lines.push(`${percentText(percent)} vs new`);
  }
  lines.push(`Confidence: ${e.confidence}`);
  return lines;
}
