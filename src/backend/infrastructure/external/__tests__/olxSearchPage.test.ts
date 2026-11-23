import { olxSearchUrl, parseOlxSearchPage } from '../olxSearchPage';

interface FakeAd {
  id?: number;
  isPromoted?: boolean;
  searchReason?: string;
  price?: Record<string, unknown>;
}

const ppl = (value: number) => ({ regularPrice: { value, currencyCode: 'PLN' } });

function pageWith(state: unknown): string {
  const literal = JSON.stringify(JSON.stringify(state));
  return `<html><body><script>\n window.__PRERENDERED_STATE__= ${literal};\n window.__TAURUS__= [];\n</script></body></html>`;
}

function listingPage(ads: unknown, extra: Record<string, unknown> = {}): string {
  return pageWith({ listing: { listing: { totalElements: 966, totalPages: 25, ads, ...extra } } });
}

describe('olxSearchUrl', () => {
  it('builds the query path and adds ?page= from page 2', () => {
    expect(olxSearchUrl('https://www.olx.pl', 'słuchawki apple', 1)).toBe(
      'https://www.olx.pl/oferty/q-s%C5%82uchawki-apple/'
    );
    expect(olxSearchUrl('https://www.olx.pl', 'słuchawki apple', 3)).toBe(
      'https://www.olx.pl/oferty/q-s%C5%82uchawki-apple/?page=3'
    );
  });

  it('throws on an unsafe query and on a page below 1', () => {
    expect(() => olxSearchUrl('https://www.olx.pl', 'a/../b', 1)).toThrow();
    expect(() => olxSearchUrl('https://www.olx.pl', 'airpods', 0)).toThrow();
  });
});

describe('parseOlxSearchPage', () => {
  it('reads cards in order with string ids, totals and promotion flags', () => {
    const ads: FakeAd[] = [
      { id: 11, price: ppl(279) },
      { id: 12, isPromoted: true, price: ppl(300) },
      { id: 13, searchReason: 'promoted', price: ppl(310) },
      { id: 14, isPromoted: false, searchReason: 'organic', price: ppl(320) },
      { id: 15, isPromoted: true, searchReason: 'organic', price: ppl(330) },
    ];
    expect(parseOlxSearchPage(listingPage(ads))).toEqual({
      total: 966,
      totalPages: 25,
      cards: [
        { id: '11', price: 279, promoted: false },
        { id: '12', price: 300, promoted: true },
        { id: '13', price: 310, promoted: true },
        { id: '14', price: 320, promoted: false },
        { id: '15', price: 330, promoted: false },
      ],
    });
  });

  it('keeps a card whose price shape is odd, with a null price', () => {
    const ads = [
      { id: 1, price: { regularPrice: null } },
      { id: 2, price: null },
      { id: 3, price: { regularPrice: { value: 'x', currencyCode: 'PLN' } } },
      { id: 4, isPromoted: null, searchReason: 7 },
    ];
    const page = parseOlxSearchPage(listingPage(ads));
    expect(page?.cards).toEqual([
      { id: '1', price: null, promoted: false },
      { id: '2', price: null, promoted: false },
      { id: '3', price: null, promoted: false },
      { id: '4', price: null, promoted: false },
    ]);
  });

  it('keeps both occurrences of the same advert and reads numeric string ids', () => {
    const ads = [{ id: 9, searchReason: 'promoted' }, { id: '9', searchReason: 'organic' }, { id: 'abc' }];
    expect(parseOlxSearchPage(listingPage(ads))?.cards).toEqual([
      { id: '9', price: null, promoted: true },
      { id: '9', price: null, promoted: false },
    ]);
  });

  it('gives a null price for other currencies, free, exchange and a missing price', () => {
    const ads: FakeAd[] = [
      { id: 1, price: { regularPrice: { value: 50, currencyCode: 'EUR' } } },
      { id: 2, price: { ...ppl(10), free: true } },
      { id: 3, price: { ...ppl(10), exchange: true } },
      { id: 4 },
    ];
    const page = parseOlxSearchPage(listingPage(ads));
    expect(page?.cards.map((card) => card.price)).toEqual([null, null, null, null]);
    expect(page?.cards).toHaveLength(4);
  });

  it('skips an ad without an id', () => {
    const page = parseOlxSearchPage(listingPage([{ price: ppl(1) }, { id: 5, price: ppl(2) }]));
    expect(page?.cards).toEqual([{ id: '5', price: 2, promoted: false }]);
  });

  it('returns null totals when the page omits them', () => {
    const html = pageWith({ listing: { listing: { ads: [{ id: 1 }] } } });
    expect(parseOlxSearchPage(html)).toEqual({
      total: null,
      totalPages: null,
      cards: [{ id: '1', price: null, promoted: false }],
    });
  });

  it('returns null without the state, with broken JSON or with ads that are not an array', () => {
    expect(parseOlxSearchPage('<html>captcha</html>')).toBeNull();
    expect(parseOlxSearchPage('window.__PRERENDERED_STATE__= "{not json";')).toBeNull();
    expect(parseOlxSearchPage(listingPage({ not: 'an array' }))).toBeNull();
    expect(parseOlxSearchPage(pageWith({ other: 1 }))).toBeNull();
  });
});
