import type { PriceComparable } from '../../../../shared/types';
import { applyPriceSanity } from '../priceSanity';

const row = (tier: PriceComparable['tier'], price: number, currency?: string): PriceComparable & { currency?: string } => ({
  price, note: `${tier} ${price}`, tier, ...(currency ? { currency } : {}),
});

describe('applyPriceSanity', () => {
  it('drops a row priced in another currency', () => {
    const result = applyPriceSanity([row('substitute_new', 300, 'PLN'), row('substitute_new', 70, 'EUR')], 'PLN');
    expect(result.map((r) => r.price)).toEqual([300]);
  });

  it('drops a last new price above 3x the median of the new substitutes and keeps a plausible one', () => {
    const subs = [row('substitute_new', 273), row('substitute_new', 360)];
    expect(applyPriceSanity([...subs, row('last_new_price', 2594)], 'PLN').map((r) => r.price)).toEqual([273, 360]);
    expect(applyPriceSanity([...subs, row('last_new_price', 799)], 'PLN').map((r) => r.price)).toEqual([273, 360, 799]);
  });

  it('compares with the median of the other rows when there are no new substitutes', () => {
    const others = [row('same_model_used', 200), row('substitute_used', 250)];
    expect(applyPriceSanity([...others, row('last_new_price', 2594)], 'PLN')).toHaveLength(2);
    expect(applyPriceSanity([...others, row('last_new_price', 600)], 'PLN')).toHaveLength(3);
  });

  it('keeps a last new price when nothing else can be compared', () => {
    expect(applyPriceSanity([row('last_new_price', 2594)], 'PLN')).toHaveLength(1);
  });
});
