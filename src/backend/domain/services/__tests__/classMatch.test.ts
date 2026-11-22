import type { ClassAttribute, PriceComparable } from '../../../../shared/types';
import { applyClassFilter, matchesClass } from '../classMatch';

const item: ClassAttribute[] = [
  { name: 'resolution', value: '720p', match: 'equal' },
  { name: 'lumens', value: 200, unit: 'lm', match: 'ratio' },
];

function candidate(resolution: string | null, lumens: number | null): ClassAttribute[] {
  return [
    ...(resolution === null ? [] : [{ name: 'resolution', value: resolution, match: 'equal' as const }]),
    ...(lumens === null ? [] : [{ name: 'lumens', value: lumens, unit: 'lm', match: 'ratio' as const }]),
  ];
}

describe('matchesClass', () => {
  it.each([
    ['720p', 140, true],
    ['720p', 2500, false],
    ['1080p', 200, false],
    ['720p', 100, true],
    ['720p', 400, true],
    ['720p', 99, false],
    ['720p', 401, false],
  ])('%s / %s lm -> %s', (resolution, lumens, expected) => {
    expect(matchesClass(item, candidate(resolution, lumens))).toBe(expected);
  });

  it('drops a candidate missing an attribute', () => {
    expect(matchesClass(item, candidate('720p', null))).toBe(false);
    expect(matchesClass(item, candidate(null, 200))).toBe(false);
    expect(matchesClass(item, null)).toBe(false);
    expect(matchesClass(item, undefined)).toBe(false);
  });

  it('compares equal attributes ignoring case, spaces and the multiplication sign', () => {
    const size: ClassAttribute[] = [{ name: 'Native resolution', value: '1280x720', match: 'equal' }];
    expect(matchesClass(size, [{ name: 'native resolution', value: '1280 × 720', match: 'equal' }])).toBe(true);
    expect(matchesClass(size, [{ name: 'native resolution', value: '1920 x 1080', match: 'equal' }])).toBe(false);
  });

  it('drops a ratio candidate whose value is not a number', () => {
    expect(matchesClass(item, [...candidate('720p', null), { name: 'lumens', value: 'bright', match: 'ratio' }])).toBe(false);
  });
});

describe('applyClassFilter', () => {
  const row = (tier: PriceComparable['tier'], attrs?: ClassAttribute[]): PriceComparable => ({
    price: 300, note: tier ?? 'none', tier, ...(attrs ? { classAttributes: attrs } : {}),
  });

  it('drops a substitute of another class and marks the kept one checked', () => {
    const rows = [row('substitute_new', candidate('720p', 2500)), row('substitute_used', candidate('720p', 180))];
    const result = applyClassFilter(rows, item);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ tier: 'substitute_used', classChecked: true });
  });

  it('passes same-model and last-new-price rows untouched', () => {
    const rows = [row('same_model_used'), row('last_new_price', candidate('1080p', 3000))];
    expect(applyClassFilter(rows, item)).toEqual(rows);
  });

  it('unknown item class keeps rows unchecked', () => {
    const rows = [row('substitute_new', candidate('1080p', 3000)), row('substitute_used')];
    const result = applyClassFilter(rows, []);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.classChecked === false)).toBe(true);
  });
});
