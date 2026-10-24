import { formatMoney } from './formatters';

const NBSP = '\u00A0';

describe('formatMoney', () => {
  it('renders PLN space-grouped with a zł suffix, including four-digit amounts', () => {
    expect(formatMoney(1050, 'PLN')).toBe(`1${NBSP}050${NBSP}zł`);
    expect(formatMoney(148230, 'PLN')).toBe(`148${NBSP}230${NBSP}zł`);
    expect(formatMoney(0, 'PLN')).toBe(`0${NBSP}zł`);
  });

  it('drops decimals for whole amounts but never rounds away real cents', () => {
    expect(formatMoney(1200, 'PLN')).toBe(`1${NBSP}200${NBSP}zł`);
    expect(formatMoney(1234.5, 'PLN')).toBe(`1${NBSP}234,50${NBSP}zł`);
    expect(formatMoney(0.99, 'PLN')).toBe(`0,99${NBSP}zł`);
  });

  it('keeps the sign of negative amounts', () => {
    expect(formatMoney(-300, 'PLN')).toBe(`-300${NBSP}zł`);
  });

  it('recognises PLN regardless of the code case', () => {
    expect(formatMoney(1050, 'pln')).toBe(`1${NBSP}050${NBSP}zł`);
  });

  it('defaults to the shared default currency', () => {
    expect(formatMoney(5)).toBe(`5${NBSP}zł`);
  });

  it('renders unknown amounts as an em dash instead of zero', () => {
    expect(formatMoney(null, 'PLN')).toBe('—');
    expect(formatMoney(undefined, 'PLN')).toBe('—');
    expect(formatMoney(Number.NaN, 'PLN')).toBe('—');
  });

  it('uses the en-US currency style for other currencies', () => {
    expect(formatMoney(1050, 'EUR')).toBe('€1,050');
    expect(formatMoney(10.5, 'USD')).toBe('$10.50');
  });

  it('falls back to a plain amount and code when the currency code is invalid', () => {
    expect(formatMoney(10, 'not-a-code')).toBe('10.00 not-a-code');
  });
});
