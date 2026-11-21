import {
  buildComparableSearchPrompt,
  filterComparableCandidates,
  isResearchToolsetSafe,
  parseComparableCandidates,
  SEARCH_NAME_TOO_SHORT,
  sanitizeSearchName,
} from '../comparableSearchPrompt';
import { ValidationError } from '../../../domain/shared/DomainError';

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
    // Regression guard: every URL-like token is stripped, including hosts without a scheme.
    for (const raw of [
      'AirPods evil.example/a?x=1',
      'AirPods EVIL.EXAMPLE/a',
      'AirPods evil.pl',
      'AirPods shop.store/x',
      'AirPods xn--80ak6aa92e.com',
      'AirPods evil.com:8080',
      'AirPods ftp://evil.com',
      'AirPods file:///etc/passwd',
      'AirPods http:evil.com',
      'AirPods //evil.com',
      'AirPods user@evil.com',
      'AirPods www.evil.info',
      'AirPods 10.0.0.1/a',
      'AirPods 10.0.0.1:8080',
    ]) {
      const cleaned = sanitizeSearchName(raw);
      expect(cleaned).toMatch(/^AirPods/);
      expect(cleaned).not.toMatch(/evil|example|shop|xn--|https|ftp|file|passwd|\/\/|10\.0\.0\.1|8080/i);
    }
    // A scheme glued to a word may take the word with it; the URL must still go.
    expect(sanitizeSearchName('AirPodshttps://evil.com/a')).not.toMatch(/evil|https|\/\//);
  });

  it('keepsWordsJoinedByAPeriod', () => {
    expect(sanitizeSearchName('Apple iPhone 15 Pro 256GB.Czarny')).toBe('Apple iPhone 15 Pro 256GB.Czarny');
    expect(sanitizeSearchName('AirPods 4.Etui')).toBe('AirPods 4.Etui');
    // An unlisted TLD-like word is a word, not a host.
    expect(sanitizeSearchName('Etui.Nowe, stan.bdb')).toBe('Etui.Nowe stan.bdb');
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
      category: 'Słuchawki evil.com/x',
      currency: 'PLN',
    });
    expect(prompt).toContain(sanitizeSearchName('Apple AirPods 4 https://evil.example/x'));
    expect(prompt).not.toContain('evil.');
    expect(prompt).toContain('PLN');
    expect(prompt).toContain('web_search');
    expect(prompt).toContain('web_extract');
    expect(system).toMatch(/data/i);
  });
});

describe('buildComparableSearchPrompt with nothing left of the name', () => {
  it('refusesEmptySanitizedName', () => {
    const build = () =>
      buildComparableSearchPrompt({ name: 'https://evil.com/a <> !!', condition: 'good', category: 'x', currency: 'PLN' });
    expect(build).toThrow(ValidationError);
    expect(build).toThrow(SEARCH_NAME_TOO_SHORT);
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
