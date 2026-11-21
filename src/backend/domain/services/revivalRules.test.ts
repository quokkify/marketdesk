import { fitsOlxTitle, missingFacts, OLX_TITLE_MAX_LENGTH, priceGuard } from './revivalRules';
import { Money } from '../valueObjects/Money';

function money(minor: number): Money {
  const result = Money.fromMinor(minor, 'PLN');
  if (result.isErr()) throw result.error;
  return result.value;
}

describe('missingFacts', () => {
  it('asks for an unknown condition as required and a missing cost price as optional', () => {
    expect(missingFacts({ condition: 'unknown', costPrice: null })).toEqual([
      { field: 'condition', required: true, note: "Choose the product's condition before publishing to OLX" },
      { field: 'costPrice', required: false, note: 'Without a cost price the price floor cannot be checked' },
    ]);
  });

  it('lists nothing when the condition and the cost price are known', () => {
    expect(missingFacts({ condition: 'good', costPrice: money(5000) })).toEqual([]);
  });

  it('treats a zero cost price as known', () => {
    expect(missingFacts({ condition: 'new', costPrice: money(0) })).toEqual([]);
  });
});

describe('priceGuard', () => {
  it('reports no proposal when there is no proposed price', () => {
    expect(priceGuard(null, 50)).toEqual({ status: 'no_proposal', costPrice: 50 });
    expect(priceGuard(null, null)).toEqual({ status: 'no_proposal', costPrice: null });
  });

  it('cannot check a proposed price without a cost price', () => {
    expect(priceGuard(120, null)).toEqual({ status: 'unchecked', costPrice: null });
  });

  it('flags a proposed price below the cost price', () => {
    expect(priceGuard(49.99, 50)).toEqual({ status: 'below_cost', costPrice: 50 });
  });

  it('accepts a proposed price at or above the cost price', () => {
    expect(priceGuard(50, 50)).toEqual({ status: 'ok', costPrice: 50 });
    expect(priceGuard(120, 50)).toEqual({ status: 'ok', costPrice: 50 });
  });
});

describe('fitsOlxTitle', () => {
  it('keeps a title of up to 70 characters and drops a longer one', () => {
    expect(fitsOlxTitle('a'.repeat(OLX_TITLE_MAX_LENGTH))).toBe(true);
    expect(fitsOlxTitle(` ${'a'.repeat(OLX_TITLE_MAX_LENGTH)} `)).toBe(true);
    expect(fitsOlxTitle('a'.repeat(OLX_TITLE_MAX_LENGTH + 1))).toBe(false);
  });
});
