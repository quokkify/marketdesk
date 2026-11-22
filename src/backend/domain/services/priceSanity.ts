import type { PriceComparable } from '../../../shared/types';

const LAST_NEW_PRICE_MAX_FACTOR = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A row that names its own currency must match the research currency; a row without one is taken as in it.
export function applyPriceSanity<T extends PriceComparable & { currency?: string | null }>(rows: T[], currency: string): T[] {
  const inCurrency = rows.filter((row) => !row.currency || row.currency === currency);
  const newPrices = inCurrency.filter((row) => row.tier === 'substitute_new').map((row) => row.price);
  const referencePrices = newPrices.length > 0
    ? newPrices
    : inCurrency.filter((row) => row.tier !== 'last_new_price').map((row) => row.price);
  if (referencePrices.length === 0) return inCurrency;
  const ceiling = median(referencePrices) * LAST_NEW_PRICE_MAX_FACTOR;
  return inCurrency.filter((row) => row.tier !== 'last_new_price' || row.price <= ceiling);
}
