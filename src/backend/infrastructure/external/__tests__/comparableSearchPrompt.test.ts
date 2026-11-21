import {
  buildComparableSearchPrompt,
  filterComparableCandidates,
  isResearchToolsetSafe,
  parseComparableCandidates,
  sanitizeSearchName,
} from '../comparableSearchPrompt';

const OWN_URL = 'https://www.olx.pl/d/oferta/airpods-4-moje-CID99-ID1own0.html';
const VALID = {
  price: 340,
  currency: 'PLN',
  title: '  Apple AirPods 4 bez ANC  ',
  url: 'https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1cHIxA.html',
};
const CTX = { currency: 'PLN', ownUrl: OWN_URL };

function advert(index: number): typeof VALID {
  return { ...VALID, url: `https://www.olx.pl/d/oferta/airpods-4-n${index}-CID99-ID1n${index}.html` };
}

describe('sanitizeSearchName', () => {
  it('sanitizesNameMarkupAndUrls', () => {
    const name = sanitizeSearchName('Apple AirPods 4 <item>x</item> https://evil.example/a, bez ANC!!');
    expect(name).toContain('Apple AirPods 4');
    expect(name).toContain('bez ANC');
    for (const banned of ['<', '>', 'evil.example', 'https', '!']) {
      expect(name).not.toContain(banned);
    }
    expect(name).not.toMatch(/ {2}/);
    expect(sanitizeSearchName('a'.repeat(300)).length).toBeLessThanOrEqual(120);
    // Regression guard: hosts without a scheme, a scheme glued to text, any scheme, a bare IPv4 host.
    for (const raw of [
      'AirPods evil.example/a?x=1',
      'AirPodshttps://evil.example/a',
      'ftp://evil.example',
      'AirPods 10.0.0.1/a',
    ]) {
      const cleaned = sanitizeSearchName(raw);
      expect(cleaned).not.toMatch(/evil|example|https|ftp|\/\/|10\.0\.0\.1/);
    }
  });

  it('keepsModelNumbersAndVariants', () => {
    const name = sanitizeSearchName('Apple AirPods 4 MXP63ZM/A, etui USB-C, bez ANC, ocena 4.5/5, A2482');
    for (const kept of ['AirPods 4', 'MXP63ZM/A', 'USB-C', 'bez ANC', '4.5/5', 'A2482']) {
      expect(name).toContain(kept);
    }
  });
});

describe('buildComparableSearchPrompt', () => {
  it('promptNeverContainsDescription', () => {
    const { system, prompt } = buildComparableSearchPrompt({
      name: 'Apple AirPods 4 https://evil.example/x',
      condition: 'like_new',
      category: 'Słuchawki evil.example/x',
      currency: 'PLN',
    });
    expect(prompt).toContain(sanitizeSearchName('Apple AirPods 4 https://evil.example/x'));
    expect(prompt).not.toContain('evil.example');
    expect(prompt).toContain('PLN');
    expect(prompt).toContain('web_search');
    expect(prompt).toContain('web_extract');
    expect(system).toMatch(/data/i);
  });
});

describe('parseComparableCandidates', () => {
  it('parsesFencedAnswer', () => {
    const raw = '```json\n[{"price":340,"currency":"PLN","title":"AirPods","url":"x"}]\n```';
    expect(parseComparableCandidates(raw)).toEqual([
      { price: 340, currency: 'PLN', title: 'AirPods', url: 'x' },
    ]);
  });

  it('nonArrayIsNull', () => {
    expect(parseComparableCandidates('{"a":1}')).toBeNull();
    expect(parseComparableCandidates('not json')).toBeNull();
  });
});

describe('filterComparableCandidates', () => {
  it('filtersEachRule', () => {
    const items = [
      VALID,
      { ...advert(1), url: 'https://evil.example/d/oferta/airpods-CID99-ID1a.html' },
      { ...advert(2), price: 0 },
      { ...advert(3), price: 100001 },
      { ...advert(4), currency: 'EUR' },
      { ...advert(5), url: `${OWN_URL}?reason=observed#gallery` },
    ];
    expect(filterComparableCandidates(items, CTX)).toEqual([
      { price: 340, currency: 'PLN', title: 'Apple AirPods 4 bez ANC', url: VALID.url },
    ]);
  });

  it('dedupesNormalizedUrls', () => {
    const items = [VALID, { ...VALID, price: 349, url: `${VALID.url}?search_reason=x` }];
    const result = filterComparableCandidates(items, CTX);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(VALID.url);
  });

  it('capsAtTen', () => {
    const items = Array.from({ length: 12 }, (_, index) => advert(index));
    expect(filterComparableCandidates(items, { currency: 'PLN', ownUrl: null })).toHaveLength(10);
  });
});

describe('isResearchToolsetSafe', () => {
  it('refusesExtraToolset', () => {
    expect(isResearchToolsetSafe(['web', 'browser'])).toBe(false);
  });

  it('refusesNoToolset', () => {
    expect(isResearchToolsetSafe([])).toBe(false);
  });

  it('acceptsWebOnly', () => {
    expect(isResearchToolsetSafe(['web'])).toBe(true);
  });
});
