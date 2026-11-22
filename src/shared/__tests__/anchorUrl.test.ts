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
    expect(normalizeAnchorUrl('https://www.ceneo.pl/123?x=1')).toBe('https://ceneo.pl/123');
  });

  // Regression guard: a dismissed row must not come back because the next search spells its link differently.
  it('maps every spelling of one shop link to one key', () => {
    const key = 'https://ceneo.pl/123';
    for (const spelling of [
      'https://ceneo.pl/123',
      'https://www.ceneo.pl/123',
      'https://WWW.Ceneo.PL/123',
      'https://m.ceneo.pl/123',
      'https://ceneo.pl/123/',
      'https://www.ceneo.pl/123/?utm_source=x#opinie',
      'https://user@ceneo.pl/123',
      'https://user:pass@www.ceneo.pl:443/123',
      'https://ceneo.pl:8443/123',
    ]) {
      expect(normalizeAnchorUrl(spelling)).toBe(key);
    }
  });

  it('keeps the root path and the case of the path', () => {
    expect(normalizeAnchorUrl('https://www.allegro.pl/')).toBe('https://allegro.pl/');
    expect(normalizeAnchorUrl('https://allegro.pl/Oferta/X-1')).toBe('https://allegro.pl/Oferta/X-1');
  });

  it('accepts OLX advert links without www or on m. and keys them like the OLX normalizer', () => {
    const key = normalizeOlxAdvertUrl('https://www.olx.pl/d/oferta/x-CID1-ID9.html');
    expect(key).toBe('https://www.olx.pl/d/oferta/x-CID1-ID9.html');
    for (const spelling of [
      'https://olx.pl/d/oferta/x-CID1-ID9.html',
      'https://m.olx.pl/d/oferta/x-CID1-ID9.html?bs=1',
      'https://OLX.pl/d/oferta/x-CID1-ID9.html#gallery',
      'https://user@www.olx.pl:443/d/oferta/x-CID1-ID9.html',
    ]) {
      expect(normalizeAnchorUrl(spelling)).toBe(key);
    }
  });

  it('still rejects an OLX link that is not an advert', () => {
    expect(normalizeAnchorUrl('https://olx.pl/elektronika/')).toBeNull();
  });

  it('rejects plain http', () => {
    expect(normalizeAnchorUrl('http://allegro.pl/x')).toBeNull();
  });

  it('rejects hosts that only mention an allowed name', () => {
    expect(normalizeAnchorUrl('https://evil.example/allegro.pl')).toBeNull();
    expect(normalizeAnchorUrl('https://allegro.pl.evil.com/x')).toBeNull();
    expect(normalizeAnchorUrl('https://www.allegro.pl.evil.com/x')).toBeNull();
    expect(normalizeAnchorUrl('https://m.evil.com/allegro.pl')).toBeNull();
    expect(normalizeAnchorUrl('https://notallegro.pl/x')).toBeNull();
    expect(normalizeAnchorUrl('https://allegro.pl@evil.com/x')).toBeNull();
    expect(normalizeAnchorUrl('https://olx.pl.evil.com/d/oferta/x-CID1-ID9.html')).toBeNull();
  });

  it('rejects text that is not a URL', () => {
    expect(normalizeAnchorUrl('not a url')).toBeNull();
  });
});
