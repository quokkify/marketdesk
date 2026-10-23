import { currencySymbol, formatMoney, formatRelative } from './formatters';

describe('formatMoney', () => {
  it('groups thousands with spaces and drops decimals for whole PLN amounts', () => {
    expect(formatMoney(1050, 'PLN')).toBe('1 050 zł');
    expect(formatMoney(329, 'PLN')).toBe('329 zł');
    expect(formatMoney(0, 'PLN')).toBe('0 zł');
    expect(formatMoney(1234567, 'PLN')).toBe('1 234 567 zł');
  });

  it('keeps two decimals with a comma when the amount has cents', () => {
    expect(formatMoney(1050.5, 'PLN')).toBe('1 050,50 zł');
    expect(formatMoney(0.1 + 0.2, 'PLN')).toBe('0,30 zł');
    expect(formatMoney(49.999, 'PLN')).toBe('50 zł');
  });

  it('prefixes negative amounts with a minus sign', () => {
    expect(formatMoney(-50, 'PLN')).toBe('-50 zł');
    expect(formatMoney(-1250.25, 'PLN')).toBe('-1 250,25 zł');
  });

  it('defaults to PLN and falls back to the ISO code for other currencies', () => {
    expect(formatMoney(10)).toBe('10 zł');
    expect(formatMoney(1050, 'EUR')).toBe('1 050 EUR');
  });

  it('renders a dash for missing or invalid amounts', () => {
    expect(formatMoney(null, 'PLN')).toBe('—');
    expect(formatMoney(undefined, 'PLN')).toBe('—');
    expect(formatMoney(Number.NaN, 'PLN')).toBe('—');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it('uses compact minute, hour, day and week units', () => {
    expect(formatRelative(ago(30_000), now)).toBe('just now');
    expect(formatRelative(ago(5 * minute), now)).toBe('5m ago');
    expect(formatRelative(ago(59 * minute), now)).toBe('59m ago');
    expect(formatRelative(ago(2 * hour + 59 * minute), now)).toBe('2h ago');
    expect(formatRelative(ago(23 * hour), now)).toBe('23h ago');
    expect(formatRelative(ago(day), now)).toBe('1d ago');
    expect(formatRelative(ago(6 * day), now)).toBe('6d ago');
    expect(formatRelative(ago(7 * day), now)).toBe('1w ago');
    expect(formatRelative(ago(34 * day), now)).toBe('4w ago');
  });

  it('falls back to a calendar date for old or future timestamps', () => {
    expect(formatRelative(ago(40 * day), now)).toBe('Sep 14, 2026');
    expect(formatRelative(new Date(now.getTime() + 3 * day), now)).toBe('Oct 27, 2026');
    expect(formatRelative(new Date(now.getTime() + 20_000), now)).toBe('just now');
  });

  it('renders a dash for missing or invalid timestamps', () => {
    expect(formatRelative(null, now)).toBe('—');
    expect(formatRelative('not a date', now)).toBe('—');
  });
});

describe('currencySymbol', () => {
  it('uses zł for PLN and the ISO code otherwise', () => {
    expect(currencySymbol('PLN')).toBe('zł');
    expect(currencySymbol('EUR')).toBe('EUR');
    expect(currencySymbol()).toBe('zł');
  });
});
