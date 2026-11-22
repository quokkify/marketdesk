import type { PriceComparable } from '../../../shared/types';

export const MAX_ANCHORS_PER_TIER = 5;
export const MAX_AUTO_ROWS = 20;
const MAX_LADDER_ROWS = 30;

// Seller-owned rows (manual, web) stay in order; every auto row is replaced by the fresh ones.
export function mergeLadder(existing: PriceComparable[], found: PriceComparable[]): PriceComparable[] {
  const kept = existing.filter((row) => row.source !== 'auto');
  return [...kept, ...found].slice(0, MAX_LADDER_ROWS);
}
