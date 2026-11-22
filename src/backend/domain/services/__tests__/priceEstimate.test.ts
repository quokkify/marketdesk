import type { AnchorTier, PriceComparable, PriceEstimate } from '../../../../shared/types';
import {
  applyLadderRules,
  estimateHiddenReason,
  shouldSurfacePriceEstimate,
  startPriceCeiling,
  substituteNewReference,
  tierConfidence,
  validatePriceEstimate,
} from '../priceEstimate';

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

function row(price: number, tier?: AnchorTier): PriceComparable {
  return { price, note: 'advert', source: 'auto', tier };
}

const NEW_SUBSTITUTES = [row(280, 'substitute_new'), row(300, 'substitute_new'), row(320, 'substitute_new')];

describe('substituteNewReference', () => {
  it('takes the median of the three cheapest new substitutes', () => {
    expect(substituteNewReference(NEW_SUBSTITUTES)).toBe(300);
    expect(
      substituteNewReference([50, 300, 320, 400].map((p) => row(p, 'substitute_new'))),
    ).toBe(300);
  });

  it('averages two rows and keeps a single row as it is', () => {
    expect(substituteNewReference([row(300, 'substitute_new'), row(320, 'substitute_new')])).toBe(310);
    expect(substituteNewReference([row(300, 'substitute_new')])).toBe(300);
  });

  it('is null without new substitutes', () => {
    expect(substituteNewReference([row(300, 'substitute_used'), row(200)])).toBeNull();
    expect(substituteNewReference([])).toBeNull();
  });
});

describe('startPriceCeiling', () => {
  it('is 70 % of the new substitute reference, exactly in cents', () => {
    expect(startPriceCeiling(NEW_SUBSTITUTES, null)).toBe(210);
  });

  it('ignores a last new price above the substitute ceiling', () => {
    expect(startPriceCeiling([...NEW_SUBSTITUTES, row(799, 'last_new_price')], null)).toBe(210);
  });

  it('is capped by a lower last new price', () => {
    expect(startPriceCeiling([...NEW_SUBSTITUTES, row(180, 'last_new_price')], null)).toBe(180);
  });

  it('is capped by the seller retail price', () => {
    expect(startPriceCeiling(NEW_SUBSTITUTES, 150)).toBe(150);
  });

  it('floors a fractional cap instead of rounding it', () => {
    expect(startPriceCeiling([row(199.996, 'last_new_price')], null)).toBe(199.99);
  });

  it('is null without caps', () => {
    expect(startPriceCeiling([row(200, 'same_model_used')], null)).toBeNull();
  });
});

describe('tierConfidence', () => {
  it('is high with a same-model used price', () => {
    expect(tierConfidence([row(250, 'same_model_used')])).toBe('high');
  });

  it('counts untiered rows as same-model used', () => {
    expect(tierConfidence([row(250)])).toBe('high');
  });

  it('is medium with two substitute rows', () => {
    expect(tierConfidence([row(300, 'substitute_new'), row(200, 'substitute_used')])).toBe('medium');
  });

  it('is low with one substitute row', () => {
    expect(tierConfidence([row(300, 'substitute_new')])).toBe('low');
  });
});

describe('applyLadderRules', () => {
  it('lowers start and floor to the ceiling', () => {
    const result = applyLadderRules(
      estimate({ startPrice: 299, floorPrice: 250, confidence: 'high' }),
      NEW_SUBSTITUTES,
      null,
    );
    expect(result).toMatchObject({ startPrice: 210, floorPrice: 210, confidence: 'medium' });
  });

  it('keeps the lower of the model and tier confidence', () => {
    const rows = [row(250, 'same_model_used')];
    expect(applyLadderRules(estimate({ confidence: 'low' }), rows, null).confidence).toBe('low');
    expect(applyLadderRules(estimate({ confidence: 'medium' }), rows, null).confidence).toBe('medium');
  });

  it('drops confidence to low with no rows at all and leaves prices alone', () => {
    const e = estimate({ confidence: 'high' });
    expect(applyLadderRules(e, [], null)).toEqual({ ...e, confidence: 'low' });
  });
});

describe('estimateHiddenReason', () => {
  it('names low confidence', () => {
    expect(estimateHiddenReason(estimate({ confidence: 'low' }), 100)).toBe('low_confidence');
  });

  it('names a difference under 5 %', () => {
    expect(estimateHiddenReason(estimate({ startPrice: 95.1 }), 100)).toBe('within_threshold');
  });

  it('is null from exactly 5 %', () => {
    expect(estimateHiddenReason(estimate({ startPrice: 95 }), 100)).toBeNull();
  });
});

describe('unchecked substitutes do not feed the ceiling', () => {
  const unchecked = (price: number, tier: AnchorTier): PriceComparable => ({ ...row(price, tier), classChecked: false });
  const checked = (price: number, tier: AnchorTier): PriceComparable => ({ ...row(price, tier), classChecked: true });

  it('sets no substitute cap from new substitutes whose class was not checked', () => {
    const rows = [unchecked(280, 'substitute_new'), unchecked(300, 'substitute_new'), unchecked(320, 'substitute_new')];
    expect(substituteNewReference(rows)).toBeNull();
    expect(startPriceCeiling(rows, null)).toBeNull();
  });

  it('caps by the checked substitutes only', () => {
    expect(startPriceCeiling([unchecked(100, 'substitute_new'), checked(300, 'substitute_new')], null)).toBe(210);
  });

  it('leaves tier confidence low when only unchecked substitutes exist', () => {
    expect(tierConfidence([unchecked(300, 'substitute_new'), unchecked(200, 'substitute_used')])).toBe('low');
    expect(tierConfidence([checked(300, 'substitute_new'), checked(200, 'substitute_used')])).toBe('medium');
  });

  it('keeps the estimate low confidence with its own prices instead of dropping it', () => {
    const e = estimate({ startPrice: 299, floorPrice: 250, confidence: 'high' });
    const rows = [unchecked(280, 'substitute_new'), unchecked(300, 'substitute_new')];
    expect(applyLadderRules(e, rows, null)).toEqual({ ...e, confidence: 'low' });
  });
});
