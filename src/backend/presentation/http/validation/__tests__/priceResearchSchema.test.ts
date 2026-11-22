import { priceResearchSchema } from '../schemas';

const body = (comparable: Record<string, unknown>) => ({
  retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null,
  comparables: [{ price: 300, note: 'x', source: 'auto', seenAt: '2026-11-22', ...comparable }],
});

describe('priceResearchSchema auto rows', () => {
  it('accepts an auto substitute_new row on a .pl shop', () => {
    expect(priceResearchSchema.safeParse(body({ tier: 'substitute_new', url: 'https://tst.pl/produkty/x' })).success).toBe(true);
  });

  it('rejects an auto substitute_used row on a shop', () => {
    expect(priceResearchSchema.safeParse(body({ tier: 'substitute_used', url: 'https://tst.pl/produkty/x' })).success).toBe(false);
  });

  it('accepts class attributes and rejects too many or malformed ones', () => {
    const attr = { name: 'lumens', value: 140, unit: 'lm', match: 'ratio' };
    const ok = body({ tier: 'substitute_new', url: 'https://tst.pl/x', classAttributes: [attr], classChecked: true });
    expect(priceResearchSchema.safeParse(ok).success).toBe(true);
    const many = body({ tier: 'substitute_new', url: 'https://tst.pl/x', classAttributes: Array(9).fill(attr) });
    expect(priceResearchSchema.safeParse(many).success).toBe(false);
    const bad = body({ tier: 'substitute_new', url: 'https://tst.pl/x', classAttributes: [{ ...attr, match: 'near' }] });
    expect(priceResearchSchema.safeParse(bad).success).toBe(false);
  });
});
