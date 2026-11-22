import type { PriceComparable } from '../../../../shared/types';
import { dismissedAfterEdit } from '../priceResearchEdit';

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
