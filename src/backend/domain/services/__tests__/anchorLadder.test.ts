import { mergeLadder } from '../anchorLadder';
import type { PriceComparable } from '../../../../shared/types';

const make = (source: PriceComparable['source'], n: number): PriceComparable => ({
  price: n,
  note: `${source}-${n}`,
  url: null,
  source,
});

describe('mergeLadder', () => {
  it('keeps manual and web rows in order and replaces every auto row', () => {
    const existing = [make('manual', 1), make('auto', 2), make('web', 3), make('auto', 4)];
    const found = [make('auto', 5), make('auto', 6)];
    expect(mergeLadder(existing, found).map((r) => r.note)).toEqual(['manual-1', 'web-3', 'auto-5', 'auto-6']);
  });

  it('caps the total at 30, dropping found rows first', () => {
    const existing = Array.from({ length: 28 }, (_, i) => make('manual', i));
    const found = [make('auto', 100), make('auto', 101), make('auto', 102)];
    const merged = mergeLadder(existing, found);
    expect(merged).toHaveLength(30);
    expect(merged.slice(28).map((r) => r.note)).toEqual(['auto-100', 'auto-101']);
  });
});
