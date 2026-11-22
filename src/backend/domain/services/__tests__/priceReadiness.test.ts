import type { PriceComparable, PriceResearch, ResearchRun, RunOutcome, StoredPriceEstimate } from '../../../../shared/types';
import { priceReadiness } from '../priceReadiness';

const VERSION = '2026-11-22T10:00:00.000Z';
const OLDER = '2026-11-21T10:00:00.000Z';

function run(outcome: RunOutcome): ResearchRun {
  return {
    id: 'r1', workspaceId: 'w1', productId: 'p1', trigger: 'analyze', status: 'finished', nodes: {},
    outcome, failedTiers: [], errorCode: null, consecutiveFailures: 0, queuedAt: OLDER,
    startedAt: OLDER, finishedAt: VERSION, leaseUntil: null, nextAutoAt: null,
  };
}

const sameModel: PriceComparable = { price: 200, note: 'used', source: 'auto', tier: 'same_model_used' };
const checkedSubstitute: PriceComparable = { price: 300, note: 'new', source: 'auto', tier: 'substitute_new', classChecked: true };
const uncheckedSubstitute: PriceComparable = { ...checkedSubstitute, classChecked: false };

function research(comparables: PriceComparable[]): PriceResearch {
  return {
    productId: 'p1', retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null,
    comparables, specs: null, dismissedUrls: [], lastAttemptAt: null, lastEstimate: null, updatedAt: VERSION,
  };
}

function estimate(researchUpdatedAt: string | null): StoredPriceEstimate {
  return {
    estimate: { startPrice: 200, floorPrice: 180, retailAnchor: null, usedRange: null, reasoning: 'r', confidence: 'medium' },
    estimatedAt: VERSION,
    hiddenReason: null,
    researchNote: null,
    researchUpdatedAt,
  };
}

describe('priceReadiness', () => {
  it('is ready after an ok run with an estimate of the current research', () => {
    expect(priceReadiness({ lastRun: run('ok'), research: research([sameModel]), estimate: estimate(VERSION) })).toBe('ready');
  });

  it('is ready after a partial run that delivered class-checked substitutes', () => {
    expect(priceReadiness({ lastRun: run('partial'), research: research([checkedSubstitute]), estimate: estimate(VERSION) })).toBe('ready');
  });

  it('is degraded after a partial run whose substitutes are unchecked', () => {
    expect(priceReadiness({ lastRun: run('partial'), research: research([sameModel, uncheckedSubstitute]), estimate: estimate(VERSION) })).toBe('degraded');
  });

  it('is degraded when the estimate is from older research', () => {
    expect(priceReadiness({ lastRun: run('ok'), research: research([sameModel]), estimate: estimate(OLDER) })).toBe('degraded');
    expect(priceReadiness({ lastRun: run('ok'), research: research([sameModel]), estimate: estimate(null) })).toBe('degraded');
  });

  it('is degraded with research but no estimate', () => {
    expect(priceReadiness({ lastRun: run('ok'), research: research([sameModel]), estimate: null })).toBe('degraded');
  });

  it('is degraded when the last run failed but an earlier ladder is stored', () => {
    expect(priceReadiness({ lastRun: run('failed'), research: research([sameModel]), estimate: estimate(VERSION) })).toBe('degraded');
  });

  it('is degraded with a manual ladder and no run yet', () => {
    expect(priceReadiness({ lastRun: null, research: research([sameModel]), estimate: estimate(VERSION) })).toBe('degraded');
  });

  it('is blocked when the last run failed with no stored ladder', () => {
    expect(priceReadiness({ lastRun: run('failed'), research: research([]), estimate: estimate(VERSION) })).toBe('blocked');
  });

  it('is blocked with no research at all', () => {
    expect(priceReadiness({ lastRun: null, research: null, estimate: null })).toBe('blocked');
  });
});
