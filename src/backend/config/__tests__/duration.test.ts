import { parseDurationMs } from '../duration';

describe('parseDurationMs', () => {
  it.each([
    ['24h', 86_400_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
    ['90m', 5_400_000],
    ['30s', 30_000],
  ])('reads %s as %d ms', (value, ms) => {
    expect(parseDurationMs(value)).toBe(ms);
  });

  it.each(['2 days', '120', '', '1.5h', '-1h'])('rejects %p', (value) => {
    expect(parseDurationMs(value)).toBeNull();
  });
});
