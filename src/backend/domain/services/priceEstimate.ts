import type { PriceEstimate } from '../../../shared/types';
import { ValidationError } from '../shared/DomainError';
import { Err, Ok, type Result } from '../shared/Result';

const MIN_SURFACE_DIFFERENCE = 0.05;

const isPositiveFinite = (n: number): boolean => Number.isFinite(n) && n > 0;

export function validatePriceEstimate(e: PriceEstimate): Result<PriceEstimate> {
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
  return Ok(e);
}

export function shouldSurfacePriceEstimate(e: PriceEstimate, currentPrice: number): boolean {
  if (e.confidence === 'low') return false;
  if (!isPositiveFinite(currentPrice)) return false;
  return Math.abs(e.startPrice - currentPrice) / currentPrice >= MIN_SURFACE_DIFFERENCE;
}
