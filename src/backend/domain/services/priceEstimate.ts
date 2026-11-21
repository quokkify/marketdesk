import type { PriceEstimate } from '../../../shared/types';
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

export function shouldSurfacePriceEstimate(e: PriceEstimate, currentPrice: number): boolean {
  if (e.confidence === 'low') return false;
  if (!isPositiveFinite(currentPrice)) return false;
  const differenceCents = Math.round(Math.abs(e.startPrice - currentPrice) * CENTS_PER_UNIT);
  const currentCents = Math.round(currentPrice * CENTS_PER_UNIT);
  return differenceCents * 100 >= MIN_SURFACE_DIFFERENCE_PERCENT * currentCents;
}
