import { Product } from '../../entities/Product';
import { Listing } from '../../entities/Listing';
import {
  InMemoryPriceResearchRepository,
  StubAIProvider,
  money,
  unwrap,
} from '../../testkit/support';
import type { PriceEstimateContext } from '../../ports/IAIProvider';
import type { IPriceResearchRuns } from '../../ports/IPriceResearchRuns';
import type { PriceComparable, PriceEstimate, PriceResearch, ResearchRun } from '../../../../shared/types';
import { buildPriceEstimatePrompt } from '../../../infrastructure/external/priceEstimatePrompt';
import { PriceEstimateService } from '../PriceEstimateService';

const WS = 'w1';
const PID = 'p1';
const OLD_VERSION = '2026-11-21T00:00:00.000Z';

function answer(overrides: Partial<PriceEstimate> = {}): PriceEstimate {
  return {
    startPrice: 90,
    floorPrice: 80,
    retailAnchor: null,
    usedRange: null,
    reasoning: 'Used units sell around 90.',
    confidence: 'medium',
    ...overrides,
  };
}

const SAME_MODEL: PriceComparable = { price: 95, note: 'same model, used', source: 'auto', tier: 'same_model_used' };

function research(overrides: Partial<PriceResearch> = {}): PriceResearch {
  return {
    productId: PID,
    retailPrice: null,
    retailCurrency: null,
    retailSource: null,
    retailCheckedAt: null,
    comparables: [SAME_MODEL],
    specs: null,
    dismissedUrls: [],
    lastAttemptAt: null,
    lastEstimate: null,
    updatedAt: OLD_VERSION,
    ...overrides,
  };
}

function activeRun(): ResearchRun {
  return {
    id: 'r1', workspaceId: WS, productId: PID, trigger: 'analyze', status: 'running', nodes: {},
    outcome: null, failedTiers: [], errorCode: null, consecutiveFailures: 0, queuedAt: OLD_VERSION,
    startedAt: OLD_VERSION, finishedAt: null, leaseUntil: null, nextAutoAt: null,
  };
}

function runsWith(active: ResearchRun | null): IPriceResearchRuns {
  return {
    request: async () => ({ run: active, enqueued: false, reason: 'active' }),
    latest: async () => ({ active, last: null }),
  };
}

// Records every estimate context; beforeAnswer runs inside the call, as a run saving meanwhile would.
class RecordingEstimateAI extends StubAIProvider {
  readonly contexts: PriceEstimateContext[] = [];
  beforeAnswer: (() => Promise<void>) | null = null;
  constructor(private readonly answers: PriceEstimate[]) {
    super();
  }
  async estimatePrice(context: PriceEstimateContext): Promise<PriceEstimate> {
    this.contexts.push(context);
    const index = Math.min(this.contexts.length - 1, this.answers.length - 1);
    const hook = this.beforeAnswer;
    this.beforeAnswer = null;
    if (hook) await hook();
    return this.answers[index];
  }
}

function setup(options: { answers?: PriceEstimate[]; runs?: IPriceResearchRuns | null; missingAccessories?: string | null } = {}) {
  const repo = new InMemoryPriceResearchRepository();
  const ai = new RecordingEstimateAI(options.answers ?? [answer()]);
  const service = new PriceEstimateService({ ai, research: repo, runs: options.runs ?? null });
  const product = unwrap(Product.create({
    id: PID, workspaceId: WS, sku: 'SKU-1', name: 'AOPEN QH11 projektor',
    description: 'Mini projector in good condition, works fine.',
    costPrice: money(1), sellingPrice: money(100), condition: 'good', category: 'projectors',
    missingAccessories: options.missingAccessories ?? null,
  }));
  const listing = unwrap(Listing.create({ id: 'l1', productId: PID, marketplaceId: 'm1', price: money(100) }));
  return { repo, ai, service, product, listing };
}

describe('PriceEstimateService', () => {
  it('records the research version the estimate was computed from', async () => {
    const { repo, service, product, listing } = setup();
    repo.items.set(`${WS}:${PID}`, research());

    const result = await service.estimate(product, listing);

    expect(result.skipped).toBeNull();
    expect(result.suggestion).toMatchObject({ type: 'suggested_lower_price', change: { kind: 'price', to: 90 } });
    expect(result.stored?.researchUpdatedAt).toBe(OLD_VERSION);
    expect(repo.items.get(`${WS}:${PID}`)?.lastEstimate?.researchUpdatedAt).toBe(OLD_VERSION);
  });

  it('records no research version when there is no research', async () => {
    const { service, product, listing } = setup();
    const result = await service.estimate(product, listing);
    expect(result.stored?.researchUpdatedAt).toBeNull();
  });

  it('older researchUpdatedAt does not overwrite', async () => {
    // Analyze reads the ladder, then a run saves a new ladder and re-estimates before Analyze stores.
    const { repo, ai, service, product, listing } = setup({ answers: [answer({ startPrice: 90 }), answer({ startPrice: 70, floorPrice: 60 })] });
    repo.items.set(`${WS}:${PID}`, research());
    let jobVersion = '';
    ai.beforeAnswer = async () => {
      const saved = await repo.saveLadderLocked(WS, PID, (current) => ({
        comparables: [...(current?.comparables ?? []), { ...SAME_MODEL, price: 75 }],
        specs: null,
      }));
      jobVersion = saved!.updatedAt;
      await service.estimate(product, listing);
    };

    const analyze = await service.estimate(product, listing);

    // Refused: the job's newer estimate stays, and the stale one is neither stored nor proposed.
    expect(analyze).toEqual({ suggestion: null, stored: null, skipped: null });
    const stored = repo.items.get(`${WS}:${PID}`)?.lastEstimate;
    expect(jobVersion > OLD_VERSION).toBe(true);
    expect(stored?.researchUpdatedAt).toBe(jobVersion);
    expect(stored?.estimate.startPrice).toBe(70);
  });

  it('an estimate from the same research version replaces the stored one', async () => {
    const { repo, service, product, listing } = setup({ answers: [answer({ startPrice: 90 }), answer({ startPrice: 70, floorPrice: 60 })] });
    repo.items.set(`${WS}:${PID}`, research());
    await service.estimate(product, listing);
    await service.estimate(product, listing);
    expect(repo.items.get(`${WS}:${PID}`)?.lastEstimate?.estimate.startPrice).toBe(70);
  });

  it('skips when research is pending: no ladder stored and a run active', async () => {
    const { repo, ai, service, product, listing } = setup({ runs: runsWith(activeRun()) });

    const result = await service.estimate(product, listing);

    expect(result).toEqual({ suggestion: null, stored: null, skipped: 'research_pending' });
    expect(ai.contexts).toHaveLength(0);
    expect(repo.items.get(`${WS}:${PID}`)).toBeUndefined();
  });

  it('estimates from a stored ladder even while a run is active', async () => {
    const { repo, ai, service, product, listing } = setup({ runs: runsWith(activeRun()) });
    repo.items.set(`${WS}:${PID}`, research());

    const result = await service.estimate(product, listing);

    expect(result.skipped).toBeNull();
    expect(ai.contexts).toHaveLength(1);
  });

  it('estimates without research when no run is active', async () => {
    const { ai, service, product, listing } = setup({ runs: runsWith(null) });
    expect((await service.estimate(product, listing)).skipped).toBeNull();
    expect(ai.contexts).toHaveLength(1);
  });

  it('estimate uses missingAccessories: the price estimate prompt receives it', async () => {
    const { ai, service, product, listing } = setup({ missingAccessories: 'pilot' });

    await service.estimate(product, listing);

    const prompt = buildPriceEstimatePrompt(ai.contexts[0]);
    const block = prompt.slice(prompt.indexOf('<seller_data>'), prompt.indexOf('</seller_data>'));
    expect(block).toContain('"missingAccessories":"pilot"');
  });

  it('keeps the research note it is given on the stored estimate', async () => {
    const { repo, service, product, listing } = setup();
    await service.estimate(product, listing, { researchNote: 'Market research failed; the estimate uses saved data.' });
    expect(repo.items.get(`${WS}:${PID}`)?.lastEstimate?.researchNote).toBe('Market research failed; the estimate uses saved data.');
  });
});
