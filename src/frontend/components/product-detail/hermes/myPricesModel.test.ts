import type { PriceComparable, PriceResearch } from '@shared/types';
import { MAX_COMPARABLES, MAX_URL_LENGTH, PRICE_ERROR } from '../priceResearchModel';
import {
  CHANGED_MESSAGE,
  LIMIT_MESSAGE,
  MAX_RETAIL_LINK_LENGTH,
  SAVE_FAILED_MESSAGE,
  addMyPrice,
  formAfterSave,
  myPrices,
  removeMyPrice,
  saveFailure,
  type MyPriceInput,
  type MyPriceResult,
} from './myPricesModel';

const auto: PriceComparable = {
  price: 290, note: 'ProjectorShop', url: 'https://www.ceneo.pl/123', source: 'auto', tier: 'substitute_new',
  seenAt: '2026-11-20', classAttributes: [{ name: 'lumens', value: 200, unit: 'ANSI', match: 'ratio' }], classChecked: true,
};
const web: PriceComparable = { price: 210, note: 'Acer', url: 'https://www.olx.pl/d/oferta/acer-CID99-ID1d1eUB.html', source: 'web' };
const mine: PriceComparable = { price: 180, note: '', source: 'manual', tier: 'same_model_used', seenAt: '2026-11-19' };
const untieredManual: PriceComparable = { price: 175, note: 'old note' };

const research: PriceResearch = {
  productId: 'p-1',
  retailPrice: 649,
  retailCurrency: 'PLN',
  retailSource: 'Acer store',
  retailCheckedAt: '2026-11-18',
  comparables: [auto, web, mine, untieredManual],
  specs: null,
  dismissedUrls: ['https://www.olx.pl/d/oferta/gone-CID99-IDzzzz.html'],
  lastAttemptAt: null,
  lastEstimate: null,
  updatedAt: '2026-11-21T10:00:00.000Z',
};

const input = (patch: Partial<MyPriceInput> = {}): MyPriceInput => ({
  price: '180', kind: 'same_model_used', url: '', seenAt: '2026-11-22', ...patch,
});

function okBody(result: MyPriceResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.field}: ${result.message}`);
  return result.body;
}

describe('addMyPrice', () => {
  it('kind last_new_price writes the retail fields and leaves comparables untouched', () => {
    const body = okBody(addMyPrice(research, input({ price: '599', kind: 'last_new_price', url: 'https://shop.example/p' }), 'PLN'));
    expect(body).toEqual({
      retailPrice: 599,
      retailCurrency: 'PLN',
      retailSource: 'https://shop.example/p',
      retailCheckedAt: '2026-11-22',
      comparables: research.comparables,
      baseUpdatedAt: research.updatedAt,
    });
  });

  it('uses the source "manual" for a last new price without a link', () => {
    expect(okBody(addMyPrice(research, input({ kind: 'last_new_price' }), 'PLN')).retailSource).toBe('manual');
  });

  it('the other kinds append a comparable with source manual, the tier, url and seenAt', () => {
    const body = okBody(addMyPrice(research, input({ price: '230', kind: 'substitute_used', url: 'https://www.olx.pl/d/x' }), 'PLN'));
    expect(body.comparables.slice(0, 4)).toEqual(research.comparables);
    expect(body.comparables[4]).toEqual({
      price: 230, note: '', source: 'manual', tier: 'substitute_used', url: 'https://www.olx.pl/d/x', seenAt: '2026-11-22',
    });
    expect(body.retailPrice).toBe(649);
    expect(body.retailSource).toBe('Acer store');
  });

  it('leaves the url out of a comparable added without a link', () => {
    const added = okBody(addMyPrice(research, input(), 'PLN')).comparables[4];
    expect(added).not.toHaveProperty('url');
  });

  it('works without stored research and sends no stale-write guard', () => {
    const body = okBody(addMyPrice(null, input(), 'PLN'));
    expect(body.baseUpdatedAt).toBeNull();
    expect(body.comparables).toHaveLength(1);
    expect(body.retailPrice).toBeNull();
  });

  it("rejects the prices '0', '-5', 'abc' and '10000000000' on field price", () => {
    for (const price of ['0', '-5', 'abc', '10000000000', '']) {
      expect(addMyPrice(research, input({ price }), 'PLN')).toEqual({ ok: false, field: 'price', message: PRICE_ERROR });
    }
  });

  it("accepts '180,50' as 180.5", () => {
    expect(okBody(addMyPrice(research, input({ price: '180,50' }), 'PLN')).comparables[4].price).toBe(180.5);
  });

  it('rejects a url longer than the limit, a non-https url, and accepts an empty one', () => {
    const long = `https://shop.example/${'a'.repeat(MAX_URL_LENGTH)}`;
    expect(addMyPrice(research, input({ url: long }), 'PLN')).toMatchObject({ ok: false, field: 'url' });
    expect(addMyPrice(research, input({ url: 'http://shop.example' }), 'PLN')).toMatchObject({ ok: false, field: 'url' });
    expect(addMyPrice(research, input({ url: '' }), 'PLN').ok).toBe(true);
  });

  it('a last new price link longer than the stored retail source fails with a plain message', () => {
    const at = (length: number) => `https://shop.example/${'a'.repeat(length - 'https://shop.example/'.length)}`;
    expect(MAX_RETAIL_LINK_LENGTH).toBe(200);
    expect(addMyPrice(research, input({ kind: 'last_new_price', url: at(201) }), 'PLN')).toEqual({
      ok: false,
      field: 'url',
      message: 'Enter an https link of at most 200 characters',
    });
    expect(okBody(addMyPrice(research, input({ kind: 'last_new_price', url: at(200) }), 'PLN')).retailSource).toBe(at(200));
    expect(addMyPrice(research, input({ url: at(201) }), 'PLN').ok).toBe(true);
  });

  it('rejects a seenAt that is not an ISO date', () => {
    for (const seenAt of ['', '22.11.2026', '2026-13-45']) {
      expect(addMyPrice(research, input({ seenAt }), 'PLN')).toMatchObject({ ok: false, field: 'seenAt' });
    }
  });

  it('30 comparables: adding returns field form with the limit message', () => {
    const full: PriceResearch = { ...research, comparables: Array.from({ length: MAX_COMPARABLES }, () => mine) };
    expect(addMyPrice(full, input(), 'PLN')).toEqual({ ok: false, field: 'form', message: '30 prices is the limit. Remove one to add another.' });
    expect(LIMIT_MESSAGE).toBe('30 prices is the limit. Remove one to add another.');
  });

  it('the limit does not apply to the retail value', () => {
    const full: PriceResearch = { ...research, comparables: Array.from({ length: MAX_COMPARABLES }, () => mine) };
    expect(addMyPrice(full, input({ kind: 'last_new_price' }), 'PLN').ok).toBe(true);
  });
});

describe('myPrices', () => {
  it("lists the retail value as a 'retail' row and only manual comparables (a row without a source is manual, without a tier it is same model)", () => {
    expect(myPrices(research)).toEqual([
      { index: 'retail', kind: 'last_new_price', price: 649, url: null, seenAt: '2026-11-18' },
      { index: 2, kind: 'same_model_used', price: 180, url: null, seenAt: '2026-11-19' },
      { index: 3, kind: 'same_model_used', price: 175, url: null, seenAt: null },
    ]);
  });

  it('lists nothing without research, and a link source as the row url', () => {
    expect(myPrices(null)).toEqual([]);
    expect(myPrices({ ...research, comparables: [], retailSource: 'https://shop.example/p' })[0].url).toBe('https://shop.example/p');
  });
});

describe('removeMyPrice', () => {
  it("'retail' clears the four retail fields and keeps the comparables", () => {
    expect(removeMyPrice(research, 'retail')).toEqual({
      retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null,
      comparables: research.comparables, baseUpdatedAt: research.updatedAt,
    });
  });

  it('an index drops only that comparable and keeps the rest in order', () => {
    const body = removeMyPrice(research, 2);
    expect(body.comparables).toEqual([auto, web, untieredManual]);
    expect(body.retailPrice).toBe(649);
  });
});

describe('saveFailure', () => {
  it('a 409 asks to reload and add the price again', () => {
    expect(saveFailure({ status: 409, data: { error: { message: 'Price research changed' } } })).toEqual({
      message: CHANGED_MESSAGE,
      conflict: true,
    });
    expect(CHANGED_MESSAGE).toBe('Prices changed. Reload and add it again.');
  });

  it('another error shows the server message without a reload', () => {
    expect(saveFailure({ status: 400, data: { error: { message: 'Too many prices' } } })).toEqual({
      message: 'Too many prices',
      conflict: false,
    });
  });

  it('an error without a status or a server message gives a generic sentence', () => {
    for (const err of [new Error('Failed to fetch'), { status: 'FETCH_ERROR', error: 'TypeError' }, { status: 500 }, null]) {
      expect(saveFailure(err)).toEqual({ message: SAVE_FAILED_MESSAGE, conflict: false });
    }
  });
});

describe('formAfterSave', () => {
  const typed = input({ price: '199', url: 'https://shop.example/p', kind: 'substitute_new' });

  it('a failed save, a conflict included, leaves the typed values untouched', () => {
    expect(formAfterSave(typed, false)).toEqual(typed);
  });

  it('a saved price clears the price and the link and keeps the kind and the date', () => {
    expect(formAfterSave(typed, true)).toEqual({ ...typed, price: '', url: '' });
  });
});
