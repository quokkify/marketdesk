import { filterAnchorRows } from '../anchorLadderPrompt';
import { MAX_ANCHORS_PER_TIER, MAX_AUTO_ROWS } from '../../../domain/services/anchorLadder';

const OWN_URL = 'https://www.olx.pl/d/oferta/airpods-4-moje-CID99-ID1own0.html';
const TODAY = '2026-11-22';
const VALID = {
  tier: 'same_model_used',
  price: 340,
  currency: 'PLN',
  title: '  Apple AirPods 4 bez ANC  ',
  url: 'https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1cHIxA.html',
};
const CTX = { currency: 'PLN', ownUrl: OWN_URL, dismissed: new Set<string>(), today: TODAY };

function row(index: number, tier = 'same_model_used'): typeof VALID {
  return { ...VALID, tier, url: `https://www.olx.pl/d/oferta/airpods-4-n${index}-CID99-ID1n${index}.html` };
}

describe('filterAnchorRows', () => {
  it('carries a non-empty classAttributes array and leaves the field off otherwise', () => {
    const attributes = [{ name: 'brightness', value: 200, unit: 'ANSI lumens', match: 'ratio' }];
    const [withAttributes] = filterAnchorRows([{ ...VALID, classAttributes: attributes }], CTX);
    expect(withAttributes.classAttributes).toEqual(attributes);
    for (const classAttributes of [[], undefined, 'brightness 200']) {
      const [row] = filterAnchorRows([{ ...VALID, classAttributes }], CTX);
      expect(row).not.toHaveProperty('classAttributes');
    }
  });

  it('keeps a .pl shop row for substitute_new and drops it for substitute_used', () => {
    const shop = { ...VALID, url: 'https://tst.pl/produkty/x' };
    expect(filterAnchorRows([{ ...shop, tier: 'substitute_new' }], CTX)).toHaveLength(1);
    expect(filterAnchorRows([{ ...shop, tier: 'substitute_used' }], CTX)).toEqual([]);
  });

  it('drops a substitute_used row on an allowlist offer URL that the PUT schema still accepts', () => {
    expect(filterAnchorRows([{ ...VALID, tier: 'substitute_used', url: 'https://allegro.pl/oferta/projektor-1' }], CTX)).toEqual([]);
  });

  it('keeps a valid row as an auto anchor', () => {
    expect(filterAnchorRows([VALID], CTX)).toEqual([
      {
        price: 340,
        note: 'Apple AirPods 4 bez ANC',
        url: 'https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1cHIxA.html',
        source: 'auto',
        tier: 'same_model_used',
        seenAt: TODAY,
      },
    ]);
  });

  it('drops rows with wrong currency, type or host', () => {
    const bad = [
      { ...VALID, currency: 'EUR' },
      { ...VALID, price: '299' },
      { ...VALID, url: 'https://unknown-shop.example/p/1' },
      { ...VALID, tier: 'mystery' },
      { ...VALID, price: 0 },
      { ...VALID, price: 100_001 },
      null,
      'text',
    ];
    expect(filterAnchorRows(bad, CTX)).toEqual([]);
  });

  it('drops the own advert and duplicates', () => {
    expect(filterAnchorRows([{ ...VALID, url: OWN_URL }, VALID, VALID], CTX)).toHaveLength(1);
  });

  it('skips dismissed URLs', () => {
    const dismissed = new Set([VALID.url]);
    expect(filterAnchorRows([VALID], { ...CTX, dismissed })).toEqual([]);
  });

  it('caps each tier and the total', () => {
    const perTier = Array.from({ length: MAX_ANCHORS_PER_TIER + 2 }, (_, i) => row(i));
    expect(filterAnchorRows(perTier, CTX)).toHaveLength(MAX_ANCHORS_PER_TIER);
    const tiers = ['same_model_used', 'last_new_price', 'substitute_new', 'substitute_used'];
    const many = tiers.flatMap((tier, t) =>
      Array.from({ length: MAX_ANCHORS_PER_TIER }, (_, i) => row(t * 10 + i, tier)),
    );
    expect(many.length).toBe(20);
    expect(filterAnchorRows(many, CTX)).toHaveLength(Math.min(20, MAX_AUTO_ROWS));
  });
});
