import { ValidationError } from '../../../../domain/shared/DomainError';
import { parseHistoryLimit } from '../historyLimit';

describe('parseHistoryLimit', () => {
  it('defaults to 20 when the limit is absent', () => {
    expect(parseHistoryLimit(undefined)).toBe(20);
  });

  it.each([['1', 1], ['20', 20], ['50', 50]])('accepts %s', (raw, expected) => {
    expect(parseHistoryLimit(raw)).toBe(expected);
  });

  it.each(['0', '51', '1.5', 'abc', '-1', '', ' ', '1e1', ['5', '6']])('rejects %p', (raw) => {
    expect(() => parseHistoryLimit(raw)).toThrow(ValidationError);
  });
});
