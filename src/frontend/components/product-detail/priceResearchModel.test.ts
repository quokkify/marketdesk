import type { PriceComparable, PriceEstimate, PriceResearch, StoredPriceEstimate } from '@shared/types';
import {
  discountLine,
  MAX_COMPARABLES,
  discountVsNew,
  estimateLines,
  anchorTierLines,
  storedEstimateLines,
  editComparablePrice,
  usedRangeSourceNote,
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
  specs: null, dismissedUrls: [], lastAttemptAt: null, lastEstimate: null,
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

  it('keeps the link and source of a web comparable through the form', () => {
    const url = 'https://www.olx.pl/d/oferta/airpods-4-CID99-ID1d1eUB.html';
    const withWeb: PriceResearch = { ...research, comparables: [{ price: 250, note: 'AirPods 4', url, source: 'web' }] };
    const result = toPriceResearchBody(toPriceResearchForm(withWeb));
    expect(result).toEqual({
      ok: true,
      body: expect.objectContaining({ comparables: [{ price: 250, note: 'AirPods 4', url, source: 'web' }] }),
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
    expect(errorsOf({ retailCheckedAt: '2026-13-45' })).toHaveProperty('retailCheckedAt');
    expect(errorsOf({ retailPrice: '10000000000000' })).toHaveProperty('retailPrice');
    expect(errorsOf({ retailPrice: '9999999999.99' })).not.toHaveProperty('retailPrice');
    expect(errorsOf({ comparables: [{ price: '10000000000', note: '' }] })).toHaveProperty(['comparables.0.price']);
    expect(errorsOf({ comparables: [{ price: '-5', note: '' }] })).toHaveProperty(['comparables.0.price']);
    expect(errorsOf({ comparables: [{ price: '5', note: 'n'.repeat(301) }] })).toHaveProperty(['comparables.0.note']);
    expect(errorsOf({ comparables: Array.from({ length: MAX_COMPARABLES + 1 }, () => ({ price: '5', note: '' })) })).toHaveProperty('comparables');
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

const OLX_URL = 'https://www.olx.pl/d/oferta/airpods-4-CID99-IDabc1.html';
const OLX_URL_2 = 'https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-IDabc2.html';

describe('comparables found on OLX', () => {
  it('sourceNoteCountsWebRows', () => {
    const withRows = (comparables: PriceResearch['comparables']): PriceResearch => ({ ...research, comparables });
    expect(usedRangeSourceNote(withRows([
      { price: 1, note: '', url: OLX_URL, source: 'web' },
      { price: 2, note: '', url: OLX_URL_2, source: 'web' },
      { price: 3, note: '' },
    ]))).toBe('2 from OLX');
    expect(usedRangeSourceNote(research)).toBeNull();
    expect(usedRangeSourceNote(null)).toBeNull();
  });

  it('appends the source note to an observed used range only', () => {
    const observed = { ...estimate, usedRange: { low: 200, high: 285, basis: 'observed' as const } };
    expect(estimateLines(observed, 'PLN', '4 from OLX')).toContain('Used range 200–285 zł · observed (4 from OLX)');
    expect(estimateLines(estimate, 'PLN', '4 from OLX')).toContain('Used range 200–285 zł · estimated');
  });
});

describe('editComparablePrice', () => {
  const web = { price: '340', note: 'AirPods', url: 'https://www.olx.pl/d/oferta/a-CID99-ID1a.html', source: 'web' as const };

  it('dropsSourceAndUrlWhenPriceOfWebRowChanges', () => {
    expect(editComparablePrice([web], 0, '300')).toEqual([{ price: '300', note: 'AirPods' }]);
  });

  it('keepsWebRowWhenPriceIsUnchangedAndOtherRowsUntouched', () => {
    const other = { price: '10', note: 'x' };
    expect(editComparablePrice([web, other], 0, '340')).toEqual([web, other]);
    expect(editComparablePrice([web, other], 1, '11')).toEqual([web, { price: '11', note: 'x' }]);
  });
});

describe('price anchors by tier', () => {
  const withRows = (comparables: PriceComparable[], extra: Partial<PriceResearch> = {}): PriceResearch =>
    ({ ...research, comparables, ...extra });
  const at = (price: number, tier: PriceComparable['tier'], note = '') => ({ price, note, tier, source: 'auto' as const });

  it('always lists four tiers in a fixed order, with not found for an empty one', () => {
    const lines = anchorTierLines(withRows([at(280, 'substitute_new'), at(300, 'substitute_new'), at(320, 'substitute_new')]), 'PLN');
    expect(lines.map((l) => [l.label, l.text])).toEqual([
      ['Same model, used', 'not found'],
      ['Last new price', 'not found'],
      ['New substitutes', 'from 280 zł (3)'],
      ['Used substitutes', 'not found'],
    ]);
    expect(anchorTierLines(null, 'PLN').map((l) => l.text)).toEqual(['not found', 'not found', 'not found', 'not found']);
  });

  it('words the used tiers as a range and the last new price with its note', () => {
    const lines = anchorTierLines(withRows([
      at(250, 'substitute_used'), at(300, 'substitute_used'), at(260, 'substitute_used'),
      at(850, 'last_new_price', 'Ceneo'), at(799, 'last_new_price', 'Komputronik'),
    ]), 'PLN');
    expect(lines.find((l) => l.tier === 'substitute_used')?.text).toBe('250–300 zł (3)');
    expect(lines.find((l) => l.tier === 'last_new_price')?.text).toBe('799 zł · Komputronik');
  });

  it('puts untiered rows into the same-model used tier', () => {
    const lines = anchorTierLines(withRows([{ price: 200, note: 'a' }, { price: 250, note: '' }, { price: 285, note: 'boxed' }]), 'PLN');
    const same = lines.find((l) => l.tier === 'same_model_used');
    expect(same?.text).toBe('200–285 zł (3)');
    expect(same?.rows).toHaveLength(3);
  });
});

describe('storedEstimateLines', () => {
  const stored = (hiddenReason: StoredPriceEstimate['hiddenReason'], researchNote: string | null): StoredPriceEstimate => ({
    estimate, estimatedAt: '2026-11-22T10:00:00.000Z', hiddenReason, researchNote,
  });

  it('is empty without a stored estimate', () => {
    expect(storedEstimateLines(null, 'PLN')).toEqual([]);
  });

  const last = (lines: string[]) => lines[lines.length - 1];

  it('appends the hidden reason and the research note', () => {
    const lines = storedEstimateLines(stored('within_threshold', 'Nothing found for this model'), 'PLN');
    expect(lines.slice(0, 2)).toEqual(['Start 279 zł', 'Floor 250 zł']);
    expect(lines.slice(-2)).toEqual(['Not suggested: within 5 % of the current price.', 'Nothing found for this model']);
    expect(last(storedEstimateLines(stored('low_confidence', null), 'PLN'))).toBe('Not suggested: confidence is low.');
    expect(last(storedEstimateLines(stored('floor_cancels', null), 'PLN')))
      .toBe('Not suggested: your lowest acceptable price blocks this change.');
    expect(last(storedEstimateLines(stored(null, null), 'PLN'))).toBe('Confidence: medium');
  });
});

describe('automatic comparables through the form', () => {
  // Regression guard: a save used to drop source, tier and seenAt, stripping tiers and dismissal tracking.
  it('round-trips an auto row with source, tier and seenAt intact', () => {
    const auto: PriceComparable = {
      price: 280, note: 'Used phone', url: 'https://www.olx.pl/d/oferta/a-CID99-ID1a.html',
      source: 'auto', tier: 'substitute_used', seenAt: '2026-11-22',
    };
    const result = toPriceResearchBody(toPriceResearchForm({ ...research, comparables: [auto] }));
    expect(result).toEqual({ ok: true, body: expect.objectContaining({ comparables: [auto] }) });
  });
});
