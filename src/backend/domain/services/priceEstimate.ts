import type { EstimateHiddenReason, PriceComparable, PriceEstimate } from '../../../shared/types';
import { ValidationError } from '../shared/DomainError';
import { Err, Ok, type Result } from '../shared/Result';

// Compared in whole cents and percent so the exact 5 % boundary is not lost to float rounding.
const MIN_SURFACE_DIFFERENCE_PERCENT = 5;
const CENTS_PER_UNIT = 100;

const isPositiveFinite = (n: number): boolean => Number.isFinite(n) && n > 0;

/**
 * `researchAnchor` is the seller's retail price that reached the provider (null when there was
 * none, or it was in another currency). The start price may exceed neither that nor the
 * model-returned anchor.
 */
export function validatePriceEstimate(
  e: PriceEstimate,
  researchAnchor: number | null = null,
): Result<PriceEstimate> {
  const numbers: Array<[string, number]> = [
    ['startPrice', e.startPrice],
    ['floorPrice', e.floorPrice],
  ];
  if (e.retailAnchor) numbers.push(['retailAnchor.amount', e.retailAnchor.amount]);
  if (e.usedRange) {
    numbers.push(['usedRange.low', e.usedRange.low], ['usedRange.high', e.usedRange.high]);
  }
  for (const [name, value] of numbers) {
    if (!isPositiveFinite(value)) {
      return Err(new ValidationError(`${name} must be a positive finite number`));
    }
  }
  if (e.floorPrice > e.startPrice) {
    return Err(new ValidationError('floorPrice must not exceed startPrice'));
  }
  if (e.retailAnchor && e.startPrice > e.retailAnchor.amount) {
    return Err(new ValidationError('startPrice must not exceed the retail anchor'));
  }
  if (researchAnchor !== null && e.startPrice > researchAnchor) {
    return Err(new ValidationError("startPrice must not exceed the seller's retail price"));
  }
  if (e.usedRange && e.usedRange.low > e.usedRange.high) {
    return Err(new ValidationError('usedRange.low must not exceed usedRange.high'));
  }
  return Ok(e);
}

export function estimateHiddenReason(
  e: PriceEstimate,
  currentPrice: number,
): Extract<EstimateHiddenReason, 'low_confidence' | 'within_threshold'> | null {
  if (e.confidence === 'low') return 'low_confidence';
  if (!isPositiveFinite(currentPrice)) return 'within_threshold';
  const differenceCents = Math.round(Math.abs(e.startPrice - currentPrice) * CENTS_PER_UNIT);
  const currentCents = Math.round(currentPrice * CENTS_PER_UNIT);
  return differenceCents * 100 >= MIN_SURFACE_DIFFERENCE_PERCENT * currentCents ? null : 'within_threshold';
}

export function shouldSurfacePriceEstimate(e: PriceEstimate, currentPrice: number): boolean {
  if (!isPositiveFinite(currentPrice)) return false;
  return estimateHiddenReason(e, currentPrice) === null;
}

// The start price stays below this share of what the cheapest new substitutes cost.
export const SUBSTITUTE_CEILING_RATIO = 0.7;
const CEILING_PERCENT = Math.round(SUBSTITUTE_CEILING_RATIO * 100);
const NEAREST_SUBSTITUTES = 3;
const CONFIDENCE_RANK: Record<PriceEstimate['confidence'], number> = { low: 0, medium: 1, high: 2 };

// Absorbs binary float error (0.29 x 100 = 28.999999999999996) without rounding a real fraction up.
const FLOAT_GUARD = 1e-9;
const toCents = (amount: number): number => Math.round(amount * CENTS_PER_UNIT);

// Integer-cent arithmetic, so 0.7 x 300 is exactly 210 and not 209.99999999999997.
function floorToCents(amount: number): number {
  return Math.floor(amount * CENTS_PER_UNIT + FLOAT_GUARD) / CENTS_PER_UNIT;
}

function pricesOf(rows: readonly PriceComparable[], tier: PriceComparable['tier']): number[] {
  return rows.filter((r) => r.tier === tier).map((r) => r.price);
}

// A substitute whose class could not be checked (the item's class is unknown) is shown to the
// seller but sets neither the substitute ceiling nor the tier confidence.
const classUnchecked = (r: PriceComparable): boolean => r.classChecked === false;

// Median of the three cheapest new substitutes: one cheap outlier does not set the ceiling.
export function substituteNewReference(rows: readonly PriceComparable[]): number | null {
  const nearest = pricesOf(rows.filter((r) => !classUnchecked(r)), 'substitute_new')
    .sort((a, b) => a - b)
    .slice(0, NEAREST_SUBSTITUTES);
  if (nearest.length === 0) return null;
  const middle = Math.floor(nearest.length / 2);
  if (nearest.length % 2 === 1) return nearest[middle];
  return (toCents(nearest[middle - 1]) + toCents(nearest[middle])) / 2 / CENTS_PER_UNIT;
}

export function startPriceCeiling(
  rows: readonly PriceComparable[],
  researchAnchor: number | null,
): number | null {
  const caps: number[] = [];
  const reference = substituteNewReference(rows);
  if (reference !== null) caps.push(Math.floor((toCents(reference) * CEILING_PERCENT) / 100) / CENTS_PER_UNIT);
  caps.push(...pricesOf(rows, 'last_new_price').map(floorToCents));
  if (researchAnchor !== null) caps.push(floorToCents(researchAnchor));
  return caps.length === 0 ? null : Math.min(...caps);
}

// Untiered rows (manual or older data) are same-model used prices.
export function tierConfidence(rows: readonly PriceComparable[]): PriceEstimate['confidence'] {
  if (rows.some((r) => r.tier == null || r.tier === 'same_model_used')) return 'high';
  const substitutes = rows.filter(
    (r) => (r.tier === 'substitute_new' || r.tier === 'substitute_used') && !classUnchecked(r),
  );
  return substitutes.length >= 2 ? 'medium' : 'low';
}

export function applyLadderRules(
  e: PriceEstimate,
  rows: readonly PriceComparable[],
  researchAnchor: number | null,
): PriceEstimate {
  const ceiling = startPriceCeiling(rows, researchAnchor);
  const startPrice = ceiling === null ? e.startPrice : Math.min(e.startPrice, ceiling);
  const tier = tierConfidence(rows);
  const confidence = CONFIDENCE_RANK[e.confidence] <= CONFIDENCE_RANK[tier] ? e.confidence : tier;
  return { ...e, startPrice, floorPrice: Math.min(e.floorPrice, startPrice), confidence };
}
