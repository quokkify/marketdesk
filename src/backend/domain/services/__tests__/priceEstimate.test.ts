import type { PriceEstimate } from '../../../../shared/types';
import { shouldSurfacePriceEstimate, validatePriceEstimate } from '../priceEstimate';

function estimate(overrides: Partial<PriceEstimate> = {}): PriceEstimate {
  return {
    startPrice: 279,
    floorPrice: 250,
    retailAnchor: { amount: 469.99, basis: 'observed' },
    usedRange: { low: 250, high: 320, basis: 'estimated' },
    reasoning: 'Comparable used units sell between 250 and 320.',
    confidence: 'medium',
    ...overrides,
  };
}

describe('validatePriceEstimate', () => {
  it('accepts start 279, floor 250, observed anchor 469.99', () => {
    expect(validatePriceEstimate(estimate()).ok).toBe(true);
  });

  it('rejects floor above start', () => {
    expect(validatePriceEstimate(estimate({ startPrice: 250, floorPrice: 279 })).ok).toBe(false);
  });

  it('rejects start above retail anchor', () => {
    const result = validatePriceEstimate(
      estimate({ startPrice: 500, retailAnchor: { amount: 469.99, basis: 'observed' } }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects non-finite or non-positive numbers', () => {
    expect(validatePriceEstimate(estimate({ startPrice: NaN })).ok).toBe(false);
    expect(validatePriceEstimate(estimate({ floorPrice: 0 })).ok).toBe(false);
    expect(
      validatePriceEstimate(estimate({ usedRange: { low: -1, high: 320, basis: 'estimated' } })).ok,
    ).toBe(false);
  });

  it('accepts a missing anchor', () => {
    expect(validatePriceEstimate(estimate({ retailAnchor: null })).ok).toBe(true);
  });

  it("rejects a start above the seller's retail price even when the model returns no anchor", () => {
    const result = validatePriceEstimate(estimate({ startPrice: 300, retailAnchor: null }), 299.99);
    expect(result.ok).toBe(false);
  });

  it("accepts a start equal to the seller's retail price", () => {
    expect(validatePriceEstimate(estimate({ startPrice: 279, retailAnchor: null }), 279).ok).toBe(true);
  });

  it('rejects a used range whose low exceeds its high', () => {
    const result = validatePriceEstimate(
      estimate({ usedRange: { low: 320, high: 250, basis: 'estimated' } }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('shouldSurfacePriceEstimate', () => {
  it('surfaces medium confidence at 5% difference', () => {
    expect(shouldSurfacePriceEstimate(estimate({ confidence: 'medium' }), 399)).toBe(true);
  });

  it('hides low confidence', () => {
    expect(shouldSurfacePriceEstimate(estimate({ confidence: 'low' }), 399)).toBe(false);
  });

  it.each([
    { current: 100, start: 95 },
    { current: 12, start: 11.4 },
    { current: 10.4, start: 9.88 },
    { current: 12, start: 12.6 },
  ])('surfaces a change of exactly 5% ($current -> $start)', ({ current, start }) => {
    expect(
      shouldSurfacePriceEstimate(estimate({ startPrice: start, confidence: 'medium' }), current),
    ).toBe(true);
  });

  it('hides a change one cent under 5%', () => {
    expect(
      shouldSurfacePriceEstimate(estimate({ startPrice: 11.41, confidence: 'high' }), 12),
    ).toBe(false);
  });

  it('hides a change under 5%', () => {
    expect(
      shouldSurfacePriceEstimate(estimate({ startPrice: 390, confidence: 'high' }), 399),
    ).toBe(false);
  });
});
