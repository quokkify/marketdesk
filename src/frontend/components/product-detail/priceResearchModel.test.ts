import type { ComparableCandidate, PriceEstimate, PriceResearch } from '@shared/types';
import {
  discountLine,
  discountVsNew,
  estimateLines,
  mergeFoundComparables,
  selectionFits,
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

const OLX_URL = 'https://www.olx.pl/d/oferta/airpods-4-CID99-IDabc1.html';
const OLX_URL_2 = 'https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-IDabc2.html';
const candidate = (url: string, price = 300): ComparableCandidate => ({ price, currency: 'PLN', title: `Advert ${price}`, url });
const emptyForm = toPriceResearchForm(null, 'PLN');
const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ price: String(100 + i), note: `n${i}` }));

describe('comparables found on OLX', () => {
  it('mergeAppendsWebRows', () => {
    const merged = mergeFoundComparables({ ...emptyForm, comparables: rows(1) }, [candidate(OLX_URL, 290)]);
    expect(merged.comparables).toEqual([
      { price: '100', note: 'n0' },
      { price: '290', note: 'Advert 290', url: OLX_URL, source: 'web' },
    ]);
  });

  it('mergeSkipsKnownUrls', () => {
    const saved = { price: '290', note: 'old', url: `${OLX_URL}?reason=x#top`, source: 'web' as const };
    const merged = mergeFoundComparables({ ...emptyForm, comparables: [saved] }, [candidate(OLX_URL), candidate(OLX_URL_2, 310)]);
    expect(merged.comparables.map((c) => c.url)).toEqual([saved.url, OLX_URL_2]);
  });

  it('capBlocksOverflow', () => {
    expect(selectionFits({ ...emptyForm, comparables: rows(9) }, 3)).toBe(false);
    expect(selectionFits({ ...emptyForm, comparables: rows(7) }, 3)).toBe(true);
    expect(selectionFits({ ...emptyForm, comparables: [...rows(7), { price: '', note: '' }] }, 3)).toBe(true);
  });

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
