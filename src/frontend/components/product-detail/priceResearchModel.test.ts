import type { PriceEstimate, PriceResearch } from '@shared/types';
import {
  discountLine,
  discountVsNew,
  estimateLines,
  toPriceResearchBody,
  toPriceResearchForm,
} from './priceResearchModel';

const research: PriceResearch = {
  productId: 'p-1',
  retailPrice: 469.99,
  retailCurrency: 'PLN',
  retailSource: 'MediaMarkt',
  retailCheckedAt: '2026-11-21',
  comparables: [
    { price: 200, note: 'scratched case' },
    { price: 250, note: '' },
    { price: 285, note: 'boxed' },
  ],
  updatedAt: '2026-11-21T10:00:00.000Z',
};

const estimate: PriceEstimate = {
  startPrice: 279,
  floorPrice: 250,
  retailAnchor: { amount: 469.99, basis: 'observed' },
  usedRange: { low: 200, high: 285, basis: 'estimated' },
  reasoning: 'Comparables cluster around 250',
  confidence: 'medium',
};

describe('priceResearchModel', () => {
  it('round-trips the AirPods research through the form', () => {
    const body = toPriceResearchBody(toPriceResearchForm(research));
    expect(body).toEqual({
      ok: true,
      body: {
        retailPrice: 469.99,
        retailCurrency: 'PLN',
        retailSource: 'MediaMarkt',
        retailCheckedAt: '2026-11-21',
        comparables: research.comparables,
      },
    });
  });

  it('turns an empty form into an empty body', () => {
    expect(toPriceResearchBody(toPriceResearchForm(null))).toEqual({
      ok: true,
      body: { retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null, comparables: [] },
    });
  });

  it('rejects a retail price without a currency', () => {
    const form = { ...toPriceResearchForm(research), retailCurrency: '' };
    const result = toPriceResearchBody(form);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toContain('retailCurrency');
  });

  it('mirrors the server limits', () => {
    const base = toPriceResearchForm(research);
    const errorsOf = (patch: Partial<typeof base>) => {
      const result = toPriceResearchBody({ ...base, ...patch });
      return result.ok ? {} : result.errors;
    };
    expect(errorsOf({ retailPrice: '0' })).toHaveProperty('retailPrice');
    expect(errorsOf({ retailPrice: 'abc' })).toHaveProperty('retailPrice');
    expect(errorsOf({ retailSource: 'x'.repeat(201) })).toHaveProperty('retailSource');
    expect(errorsOf({ retailCheckedAt: '21.11.2026' })).toHaveProperty('retailCheckedAt');
    expect(errorsOf({ comparables: [{ price: '-5', note: '' }] })).toHaveProperty(['comparables.0.price']);
    expect(errorsOf({ comparables: [{ price: '5', note: 'n'.repeat(301) }] })).toHaveProperty(['comparables.0.note']);
    expect(errorsOf({ comparables: Array.from({ length: 11 }, () => ({ price: '5', note: '' })) })).toHaveProperty('comparables');
  });

  it('lists the estimate with the basis of every figure', () => {
    expect(estimateLines(estimate, 'PLN')).toEqual([
      'Start 279 zł',
      'Floor 250 zł',
      'New price 469,99 zł · observed',
      'Used range 200–285 zł · estimated',
      '−41% vs new',
      'Confidence: medium',
    ]);
  });

  it('omits the anchor and range lines when the estimate has none', () => {
    const lines = estimateLines({ ...estimate, retailAnchor: null, usedRange: null }, 'PLN');
    expect(lines).toEqual(['Start 279 zł', 'Floor 250 zł', 'Confidence: medium']);
  });

  it('computes the discount against new in whole percent', () => {
    expect(discountVsNew(279, 469.99)).toBe(-41);
    expect(discountVsNew(279, null)).toBeNull();
    expect(discountVsNew(279, 0)).toBeNull();
  });

  it('words the discount with source and date', () => {
    expect(discountLine(279, research, 'PLN')).toBe('−41% vs new · 469,99 zł (MediaMarkt, 2026-11-21)');
    expect(discountLine(279, null, 'PLN')).toBeNull();
    expect(discountLine(279, { ...research, retailPrice: null }, 'PLN')).toBeNull();
  });
});
