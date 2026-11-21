import { normalizeOlxAdvertUrl } from '../olxAdvertUrl';

describe('normalizeOlxAdvertUrl', () => {
  it('acceptsOlxAdvert', () => {
    const url = 'https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1d1eUB.html';
    expect(normalizeOlxAdvertUrl(url)).toBe(url);
  });

  it('normalizesQueryAndFragment', () => {
    expect(
      normalizeOlxAdvertUrl('https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1btjsA.html?search_reason=search%7Corganic#x'),
    ).toBe('https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1btjsA.html');
  });

  it.each([
    'https://olx.pl/elektronika/q-airpods',
    'https://www.olx.pl/d/oferta/x.html',
    'http://www.olx.pl/d/oferta/a-CID99-ID1a.html',
    'https://evil.example/d/oferta/a-CID99-ID1a.html',
  ])('rejectsNonAdvert %s', (url) => {
    expect(normalizeOlxAdvertUrl(url)).toBeNull();
  });
});
