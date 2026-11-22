import type { SaleVerdict, VerdictCheck } from '@shared/types';
import type { VerdictMark } from '../verdictDisplay.js';
import {
  checkAge,
  checkLabel,
  isVerdictStale,
  leadingReason,
  newestCheckAt,
  overallLabel,
  verdictSettled,
} from '../verdictDisplay.js';

function check(patch: Partial<VerdictCheck>): VerdictCheck {
  return {
    check: 'info',
    status: 'ready',
    reasons: [],
    checkedAt: '2026-11-22T10:00:00.000Z',
    refs: { eventIds: [] },
    ...patch,
  };
}

describe('isVerdictStale', () => {
  const completedAt = '2026-11-22T10:00:00.000Z';

  it('is stale when the product was edited after the run completed', () => {
    expect(isVerdictStale({ completedAt }, '2026-11-22T10:05:00.000Z', null)).toBe(true);
  });

  it('is stale when the listing was edited after the run completed', () => {
    expect(isVerdictStale({ completedAt }, '2026-11-22T09:00:00.000Z', '2026-11-22T10:05:00.000Z')).toBe(true);
  });

  it('is not stale when nothing changed after the run', () => {
    expect(isVerdictStale({ completedAt }, '2026-11-22T09:59:00.000Z', '2026-11-22T10:00:00.000Z')).toBe(false);
  });

  it('is not stale while the run has not completed', () => {
    expect(isVerdictStale({ completedAt: null }, '2026-11-22T10:05:00.000Z', null)).toBe(false);
  });
});

describe('labels', () => {
  it('names the overall verdicts', () => {
    expect(overallLabel('ready')).toBe('Ready to sell');
    expect(overallLabel('fix')).toBe('Not ready');
    expect(overallLabel('needs_human')).toBe('Needs you');
    expect(overallLabel(null)).toBeNull();
  });

  it('marks each check by status', () => {
    expect(checkLabel(check({ check: 'info', status: 'ready' }))).toBe('Info ✓');
    expect(checkLabel(check({ check: 'photos', status: 'fix' }))).toBe('Photos ✗');
    expect(checkLabel(check({ check: 'price', status: 'pending' }))).toBe('Price researching…');
  });

  it('shows the prices of a price check and the count of a photos check', () => {
    const price = check({
      check: 'price',
      status: 'fix',
      refs: { eventIds: [], currentPrice: 349, proposedPrice: 279, currency: 'PLN' },
    });
    expect(checkLabel(price)).toBe('Price ✗ 349 → 279 zł');
    expect(checkLabel(check({ check: 'photos', refs: { eventIds: [], photoCount: 4 } }))).toBe('Photos ✓(4)');
    expect(checkLabel(check({ check: 'photos', status: 'fix', refs: { eventIds: [], photoCount: 0 } }))).toBe('Photos ✗');
  });

  it('leads with the first reason of the first check that is not ready', () => {
    const checks: SaleVerdict['checks'] = {
      info: check({ check: 'info' }),
      price: check({ check: 'price', status: 'fix', reasons: [{ code: 'above', message: 'Price above the ceiling' }] }),
    };
    expect(leadingReason({ checks })).toBe('Price above the ceiling');
    expect(leadingReason({ checks: { info: check({}) } })).toBeNull();
  });
});

describe('checkAge', () => {
  const now = Date.parse('2026-11-22T12:00:00.000Z');
  const newest = '2026-11-22T11:50:00.000Z';

  it('is null for the newest check', () => {
    expect(checkAge(check({ checkedAt: newest }), newest, now)).toBeNull();
  });

  it('ignores a check made seconds before the newest one', () => {
    expect(checkAge(check({ checkedAt: '2026-11-22T11:49:40.000Z' }), newest, now)).toBeNull();
  });

  it('shows the age of an older check', () => {
    expect(checkAge(check({ checkedAt: '2026-11-22T09:00:00.000Z' }), newest, now)).toBe('3 h ago');
    expect(checkAge(check({ checkedAt: '2026-11-20T11:00:00.000Z' }), newest, now)).toBe('2 d ago');
  });

  it('finds the newest check of a verdict', () => {
    const checks: SaleVerdict['checks'] = {
      info: check({ checkedAt: '2026-11-22T09:00:00.000Z' }),
      price: check({ check: 'price', checkedAt: newest }),
    };
    expect(newestCheckAt({ checks })).toBe(newest);
  });
});

describe('verdictSettled', () => {
  const mark = (patch: Partial<VerdictMark> = {}): VerdictMark => ({
    productId: 'p1',
    latestId: 'run-1',
    completedAt: '2026-11-22T10:00:00.000Z',
    active: false,
    ...patch,
  });

  it('settles when a run that was active is gone', () => {
    expect(verdictSettled(mark({ active: true }), mark())).toBe(true);
  });

  it('settles when the latest verdict changed without ever seeing the run active', () => {
    expect(verdictSettled(mark(), mark({ latestId: 'run-2', completedAt: '2026-11-22T10:05:00.000Z' }))).toBe(true);
  });

  it('does not settle while a run is active or when nothing changed', () => {
    expect(verdictSettled(mark(), mark({ active: true }))).toBe(false);
    expect(verdictSettled(mark(), mark())).toBe(false);
  });

  it('does not settle on the first read or when another product is read', () => {
    expect(verdictSettled(null, mark())).toBe(false);
    expect(verdictSettled(mark({ active: true }), mark({ productId: 'p2', latestId: null, completedAt: null }))).toBe(false);
  });
});
