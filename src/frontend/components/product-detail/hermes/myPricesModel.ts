// "Your prices": the market prices the seller found, added to or removed from the stored research.
// Rows Hermes stored (source auto or web) and the dismissed adverts go back exactly as stored.
import type { AnchorTier, PriceComparable, PriceResearch } from '@shared/types';
import {
  MAX_COMPARABLES,
  MAX_URL_LENGTH,
  PRICE_ERROR,
  isIsoDate,
  parsePrice,
  type PriceResearchBody,
} from '../priceResearchModel.js';

export type MyPriceKind = AnchorTier;

export interface MyPriceInput {
  price: string;
  kind: MyPriceKind;
  url: string;
  seenAt: string;
}

export type MyPriceResult =
  | { ok: true; body: PriceResearchBody }
  | { ok: false; field: 'price' | 'url' | 'seenAt' | 'form'; message: string };

export interface MyPriceRow {
  index: number | 'retail';
  kind: MyPriceKind;
  price: number;
  url: string | null;
  seenAt: string | null;
}

export const MY_PRICE_KINDS: ReadonlyArray<{ kind: MyPriceKind; label: string }> = [
  { kind: 'same_model_used', label: 'Same model, used' },
  { kind: 'last_new_price', label: 'Last new price' },
  { kind: 'substitute_new', label: 'New substitute' },
  { kind: 'substitute_used', label: 'Used substitute' },
];

export const LIMIT_MESSAGE = `${MAX_COMPARABLES} prices is the limit. Remove one to add another.`;
const URL_ERROR = `Enter an https link of at most ${MAX_URL_LENGTH} characters`;
const DATE_ERROR = 'Enter the date as YYYY-MM-DD';
const MANUAL_RETAIL_SOURCE = 'manual';

function bodyOf(research: PriceResearch | null, comparables: PriceComparable[]): PriceResearchBody {
  return {
    retailPrice: research?.retailPrice ?? null,
    retailCurrency: research?.retailCurrency ?? null,
    retailSource: research?.retailSource ?? null,
    retailCheckedAt: research?.retailCheckedAt ?? null,
    comparables,
    baseUpdatedAt: research?.updatedAt ?? null,
  };
}

export function addMyPrice(research: PriceResearch | null, input: MyPriceInput, currency: string): MyPriceResult {
  const price = parsePrice(input.price);
  if (price === null) return { ok: false, field: 'price', message: PRICE_ERROR };
  const url = input.url.trim();
  if (url && (url.length > MAX_URL_LENGTH || !url.startsWith('https://'))) {
    return { ok: false, field: 'url', message: URL_ERROR };
  }
  if (!isIsoDate(input.seenAt)) return { ok: false, field: 'seenAt', message: DATE_ERROR };

  const comparables = research?.comparables ?? [];
  if (input.kind === 'last_new_price') {
    return {
      ok: true,
      body: {
        ...bodyOf(research, comparables),
        retailPrice: price,
        retailCurrency: currency,
        retailSource: url || MANUAL_RETAIL_SOURCE,
        retailCheckedAt: input.seenAt,
      },
    };
  }
  if (comparables.length >= MAX_COMPARABLES) return { ok: false, field: 'form', message: LIMIT_MESSAGE };
  const added: PriceComparable = {
    price,
    note: '',
    source: 'manual',
    tier: input.kind,
    ...(url ? { url } : {}),
    seenAt: input.seenAt,
  };
  return { ok: true, body: bodyOf(research, [...comparables, added]) };
}

export function removeMyPrice(research: PriceResearch, index: number | 'retail'): PriceResearchBody {
  if (index === 'retail') {
    return {
      ...bodyOf(research, research.comparables),
      retailPrice: null,
      retailCurrency: null,
      retailSource: null,
      retailCheckedAt: null,
    };
  }
  return bodyOf(research, research.comparables.filter((_, i) => i !== index));
}

// A comparable stored without a tier is a comparable of the same model.
export function myPrices(research: PriceResearch | null): MyPriceRow[] {
  if (!research) return [];
  const rows: MyPriceRow[] = [];
  if (research.retailPrice !== null) {
    const source = research.retailSource;
    rows.push({
      index: 'retail',
      kind: 'last_new_price',
      price: research.retailPrice,
      url: source?.startsWith('https://') ? source : null,
      seenAt: research.retailCheckedAt,
    });
  }
  research.comparables.forEach((row, index) => {
    if (row.source !== 'manual' && row.source) return;
    rows.push({ index, kind: row.tier ?? 'same_model_used', price: row.price, url: row.url ?? null, seenAt: row.seenAt ?? null });
  });
  return rows;
}
