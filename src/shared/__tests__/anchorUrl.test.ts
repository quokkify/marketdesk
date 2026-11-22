import { advertKey, normalizeAnchorUrl, normalizeAnchorUrlForTier } from '../anchorUrl';
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

describe('normalizeAnchorUrlForTier', () => {
  const tiers = ['same_model_used', 'last_new_price', 'substitute_new', 'substitute_used'] as const;

  it('accepts any .pl shop for the new tiers only', () => {
    expect(normalizeAnchorUrlForTier('https://tst.pl/produkty/x/', 'substitute_new')).toBe('https://tst.pl/produkty/x');
    expect(normalizeAnchorUrlForTier('https://www.tst.pl/produkty/x?a=1', 'last_new_price')).toBe('https://tst.pl/produkty/x');
    expect(normalizeAnchorUrlForTier('https://tst.pl/produkty/x', 'substitute_used')).toBeNull();
    expect(normalizeAnchorUrlForTier('https://tst.pl/produkty/x', 'same_model_used')).toBeNull();
  });

  it('refuses non-shop hosts and non-https links on every tier', () => {
    for (const tier of tiers) {
      expect(normalizeAnchorUrlForTier('https://e-katalog.pl/x', tier)).toBeNull();
      expect(normalizeAnchorUrlForTier('https://www.google.com/search?q=x', tier)).toBeNull();
      expect(normalizeAnchorUrlForTier('http://tst.pl/x', tier)).toBeNull();
      expect(normalizeAnchorUrlForTier('https://tst.example.com/x', tier)).toBeNull();
    }
  });

  it('refuses an OLX search page on every tier', () => {
    for (const tier of tiers) expect(normalizeAnchorUrlForTier('https://www.olx.pl/oferty/q-aopen-qh11/', tier)).toBeNull();
  });

  it('accepts OLX adverts and Allegro Lokalnie offers for the used tiers', () => {
    const advert = 'https://www.olx.pl/d/oferta/x-CID1-ID9.html?r=1';
    expect(normalizeAnchorUrlForTier(advert, 'same_model_used')).toBe('https://www.olx.pl/d/oferta/x-CID1-ID9.html');
    expect(normalizeAnchorUrlForTier(advert, 'substitute_used')).toBe(normalizeAnchorUrl(advert));
    expect(normalizeAnchorUrlForTier('https://allegrolokalnie.pl/oferta/projektor-1', 'substitute_used')).toBe('https://allegrolokalnie.pl/oferta/projektor-1');
    expect(normalizeAnchorUrlForTier('https://allegrolokalnie.pl/oferty/projektor', 'substitute_used')).toBeNull();
  });

  // Regression guard: search-result pages must never be stored as rows.
  it('refuses search and listing pages on any host', () => {
    for (const tier of tiers) {
      expect(normalizeAnchorUrlForTier('https://tst.pl/search?q=projektor', tier)).toBeNull();
      expect(normalizeAnchorUrlForTier('https://www.ceneo.pl/;szukaj-projektor', tier)).toBeNull();
      expect(normalizeAnchorUrlForTier('https://allegro.pl/listing?string=x', tier)).toBeNull();
      expect(normalizeAnchorUrlForTier('https://tst.pl/kategoria/projektory', tier)).toBeNull();
    }
    expect(normalizeAnchorUrlForTier('https://tst.pl/produkty/projektor-x', 'substitute_new')).toBe('https://tst.pl/produkty/projektor-x');
  });
});

describe('advertKey', () => {
  const OWN = 'https://www.olx.pl/d/oferta/projektor-aopen-qh11-led-hd-720p-hdmi-stan-bardzo-dobry-CID99-ID1btQ36.html';
  const RETITLED = 'https://www.olx.pl/d/oferta/projektor-led-aopen-qh11-m7p2001-hd-720p-hdmi-CID99-ID1btQ36.html';

  it('gives a retitled OLX advert the same key', () => {
    expect(advertKey(OWN)).toBe('olx:1btQ36');
    expect(advertKey(RETITLED)).toBe(advertKey(OWN));
  });

  it('ignores query, hash, host spelling and the /d/ prefix', () => {
    for (const spelling of [`${RETITLED}?reason=x#top`, RETITLED.replace('www.', ''), RETITLED.replace('/d/oferta', '/oferta')]) {
      expect(advertKey(spelling)).toBe('olx:1btQ36');
    }
  });

  it('keeps the id token case-sensitive and tells different ids apart', () => {
    expect(advertKey(OWN.replace('ID1btQ36', 'ID1btq36'))).not.toBe(advertKey(OWN));
    expect(advertKey(OWN.replace('ID1btQ36', 'ID1other0'))).not.toBe(advertKey(OWN));
  });

  it('keys a non-OLX link by its normalized URL and rejects a non-anchor link', () => {
    expect(advertKey('https://www.allegro.pl/oferta/projektor-123?bi_s=x')).toBe('https://allegro.pl/oferta/projektor-123');
    expect(advertKey('https://evil.example/d/oferta/x-CID1-ID9.html')).toBeNull();
    expect(advertKey('not a url')).toBeNull();
  });
});
