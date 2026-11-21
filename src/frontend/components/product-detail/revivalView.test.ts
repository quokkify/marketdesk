import type { RevivalProposal } from '@shared/types';
import {
  BELOW_COST_REASON,
  CONDITION_REASON,
  DESCRIPTION_REASON,
  aiIssuesNote,
  parseCostPrice,
  revivalFailureMessage,
  revivalView,
  type RevivalForm,
} from './revivalView';

const proposal: RevivalProposal = {
  listingId: 'l-1',
  productId: 'p-1',
  productUpdatedAt: '2026-11-21T10:00:00.000Z',
  listingUpdatedAt: '2026-11-21T10:00:00.000Z',
  missingFacts: [{ field: 'condition', required: true, note: 'Condition is unknown' }],
  title: { current: 'Old', proposed: 'New title', rationale: 'Clearer' },
  description: { current: 'Old text', proposed: 'A description that is long enough to apply', rationale: 'More detail' },
  price: { current: 120, proposed: 100, currency: 'PLN', rationale: 'Market' },
  priceGuard: { status: 'ok', costPrice: 50 },
  aiIssues: [],
  aiUsage: { provider: 'offline', calls: 0, promptTokens: null, completionTokens: null, totalTokens: null, costStatus: 'not_applicable' },
};

const form: RevivalForm = {
  condition: 'good',
  costPrice: '',
  useTitle: true,
  useDescription: true,
  usePrice: true,
  allowBelowCost: false,
};

describe('revivalView', () => {
  it('blocks the apply while the condition is unknown', () => {
    const view = revivalView(proposal, { ...form, condition: 'unknown' });
    expect(view.canApply).toBe(false);
    expect(view.reasons).toEqual([CONDITION_REASON]);
  });

  it('allows the apply once a condition is chosen', () => {
    expect(revivalView(proposal, form)).toMatchObject({ canApply: true, reasons: [] });
  });

  it('shows the price row only when a price is proposed, ticked unless it is below cost', () => {
    expect(revivalView({ ...proposal, price: undefined }, form).priceRow.show).toBe(false);
    expect(revivalView(proposal, form).priceRow).toEqual({
      show: true,
      checkedByDefault: true,
      needsBelowCostConfirmation: false,
    });
    const below = { ...proposal, priceGuard: { status: 'below_cost' as const, costPrice: 150 } };
    expect(revivalView(below, form).priceRow).toMatchObject({ checkedByDefault: false, needsBelowCostConfirmation: true });
  });

  it('asks for the below-cost confirmation until it is ticked', () => {
    const below = { ...proposal, priceGuard: { status: 'below_cost' as const, costPrice: 150 } };
    expect(revivalView(below, form).reasons).toEqual([BELOW_COST_REASON]);
    expect(revivalView(below, { ...form, allowBelowCost: true }).canApply).toBe(true);
  });

  it('compares an entered cost price with the proposed price when it is ticked, else the current one', () => {
    const costly = { ...form, costPrice: '110' };
    expect(revivalView(proposal, costly).priceRow.needsBelowCostConfirmation).toBe(true);
    expect(revivalView(proposal, { ...costly, usePrice: false }).priceRow.needsBelowCostConfirmation).toBe(false);
  });

  it('refuses a cost price that is not a positive number', () => {
    expect(revivalView(proposal, { ...form, costPrice: 'abc' }).canApply).toBe(false);
    expect(revivalView(proposal, { ...form, costPrice: '-5' }).canApply).toBe(false);
  });

  it('refuses a ticked description outside 20..2000 characters', () => {
    const short = { ...proposal, description: { current: 'a', proposed: 'too short', rationale: '' } };
    expect(revivalView(short, form).reasons).toEqual([DESCRIPTION_REASON]);
    expect(revivalView(short, { ...form, useDescription: false }).canApply).toBe(true);
  });
});

describe('parseCostPrice', () => {
  it('reads a decimal comma, keeps empty as null and flags junk as NaN', () => {
    expect(parseCostPrice('12,5')).toBe(12.5);
    expect(parseCostPrice('  ')).toBeNull();
    expect(parseCostPrice('0')).toBeNaN();
  });
});

describe('aiIssuesNote', () => {
  it('names only the failed Hermes parts', () => {
    expect(aiIssuesNote([])).toBe('');
    expect(aiIssuesNote(['price'])).toBe('Hermes could not suggest: price — reviving keeps the current values');
    expect(aiIssuesNote(['copy', 'price'])).toBe('Hermes could not suggest: copy / price — reviving keeps the current values');
  });
});

describe('revivalFailureMessage', () => {
  it('says what happened to the advert for each refused step', () => {
    expect(revivalFailureMessage({ outcome: 'update_refused', step: 'update', reason: 'Bad title.' })).toContain(
      'was not reactivated: Bad title.'
    );
    expect(revivalFailureMessage({ outcome: 'live', step: 'update', reason: 'Bad title' })).toContain('old text');
    expect(revivalFailureMessage({ outcome: 'unchanged', step: 'activate', reason: 'Nope' })).toContain(
      'refused to bring the advert back: Nope'
    );
    expect(revivalFailureMessage({ outcome: 'live', step: 'done', reason: null })).toBe('');
  });
});
