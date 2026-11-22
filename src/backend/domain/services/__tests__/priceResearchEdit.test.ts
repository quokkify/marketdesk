import type { PriceComparable } from '../../../../shared/types';
import { dismissedAfterEdit, researchChangedSince, withNormalizedAutoUrls } from '../priceResearchEdit';

const URL_A = 'https://allegro.pl/oferta/projektor-123';
const auto = (url: string): PriceComparable => ({ price: 100, note: 'a', url, source: 'auto', tier: 'substitute_new' });
const manual = (url: string): PriceComparable => ({ price: 100, note: 'm', url, source: 'manual' });
const web = (url: string): PriceComparable => ({ price: 100, note: 'w', url, source: 'web' });

describe('dismissedAfterEdit', () => {
  it('records the normalized URL of a removed auto row', () => {
    expect(dismissedAfterEdit([auto(`${URL_A}?utm=1`)], [], [])).toEqual([URL_A]);
  });

  it('adds nothing for a removed manual or web row', () => {
    expect(dismissedAfterEdit([manual(URL_A), web('https://www.olx.pl/d/oferta/x-CID1-ID9.html')], [], [])).toEqual([]);
  });

  it('ignores manual rows: a re-added URL as manual does not undo the dismissal', () => {
    const after = [manual(URL_A)];
    expect(dismissedAfterEdit([auto(URL_A)], after, [])).toEqual([URL_A]);
    expect(after).toEqual([manual(URL_A)]);
  });

  it('keeps an auto row that is still present', () => {
    expect(dismissedAfterEdit([auto(URL_A)], [auto(URL_A)], [])).toEqual([]);
  });

  it('does not add a URL twice', () => {
    expect(dismissedAfterEdit([auto(URL_A)], [], [URL_A])).toEqual([URL_A]);
  });

  it('keeps earlier dismissals', () => {
    expect(dismissedAfterEdit([auto(URL_A)], [], ['https://ceneo.pl/1'])).toEqual(['https://ceneo.pl/1', URL_A]);
  });
});

// Regression guard: a form built before Analyze stored new auto rows must not tombstone them on save.
describe('researchChangedSince', () => {
  const STORED = '2026-11-22T10:00:00.123Z';

  it('skips the check when the client sends no base', () => {
    expect(researchChangedSince(STORED, undefined)).toBe(false);
    expect(researchChangedSince(null, undefined)).toBe(false);
  });

  it('accepts the exact stored stamp, also written with an offset', () => {
    expect(researchChangedSince(STORED, STORED)).toBe(false);
    expect(researchChangedSince(STORED, '2026-11-22T12:00:00.123+02:00')).toBe(false);
  });

  it('refuses a stamp that differs by one millisecond', () => {
    expect(researchChangedSince(STORED, '2026-11-22T10:00:00.122Z')).toBe(true);
  });

  it('refuses a form built from no research once research exists', () => {
    expect(researchChangedSince(STORED, null)).toBe(true);
  });

  it('accepts a form built from no research while there is still none', () => {
    expect(researchChangedSince(null, null)).toBe(false);
  });

  it('refuses a form built from research that is gone', () => {
    expect(researchChangedSince(null, STORED)).toBe(true);
  });
});

describe('withNormalizedAutoUrls', () => {
  it('stores auto links in their normalized form, as the ladder does', () => {
    expect(withNormalizedAutoUrls([auto(`https://www.allegro.pl/oferta/projektor-123/?bi_s=x`)])).toEqual([auto(URL_A)]);
  });

  it('leaves manual and web links as the seller typed them', () => {
    const rows = [manual(`${URL_A}?utm=1`), web('https://www.olx.pl/d/oferta/x-CID1-ID9.html?r=1')];
    expect(withNormalizedAutoUrls(rows)).toEqual(rows);
  });
});
