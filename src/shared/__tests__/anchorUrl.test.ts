import { normalizeAnchorUrl } from '../anchorUrl';
import { normalizeOlxAdvertUrl } from '../olxAdvertUrl';

describe('normalizeAnchorUrl', () => {
  it('delegates OLX links to the OLX normalizer', () => {
    const url = 'https://www.olx.pl/d/oferta/x-CID1-ID9.html?r=1';
    expect(normalizeAnchorUrl(url)).toBe(normalizeOlxAdvertUrl(url));
    expect(normalizeAnchorUrl(url)).toBe('https://www.olx.pl/d/oferta/x-CID1-ID9.html');
  });

  it('drops query and hash on other allowed hosts', () => {
    expect(normalizeAnchorUrl('https://allegro.pl/oferta/projektor-123?bi_s=x#a')).toBe('https://allegro.pl/oferta/projektor-123');
    expect(normalizeAnchorUrl('https://www.ceneo.pl/123?x=1')).toBe('https://www.ceneo.pl/123');
  });

  it('rejects plain http', () => {
    expect(normalizeAnchorUrl('http://allegro.pl/x')).toBeNull();
  });

  it('rejects hosts that only mention an allowed name', () => {
    expect(normalizeAnchorUrl('https://evil.example/allegro.pl')).toBeNull();
    expect(normalizeAnchorUrl('https://allegro.pl.evil.com/x')).toBeNull();
  });

  it('rejects text that is not a URL', () => {
    expect(normalizeAnchorUrl('not a url')).toBeNull();
  });
});
