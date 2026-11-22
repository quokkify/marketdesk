import type {
  HermesEvent,
  PriceResearchView,
  ResearchRun,
  SaleVerdict,
  VerdictCheck,
} from '@shared/types';
import { hermesCardState, hermesProviderNote } from './hermesCardModel';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const T_CHECK = '2026-11-22T10:00:00.000Z'; // 2h before NOW
const T_RESEARCH = '2026-11-21T12:00:00.000Z'; // 1d before NOW

function check(
  name: VerdictCheck['check'],
  status: VerdictCheck['status'],
  message?: string,
  refs: Partial<VerdictCheck['refs']> = {}
): VerdictCheck {
  return {
    check: name,
    status,
    reasons: message ? [{ code: 'x', message }] : [],
    checkedAt: T_CHECK,
    refs: { eventIds: [], ...refs },
  };
}

function verdict(overrides: Partial<SaleVerdict> = {}): SaleVerdict {
  return {
    id: 'v-1',
    productId: 'p1',
    listingId: null,
    graphVersion: '1',
    scope: ['info', 'price', 'photos'],
    status: 'completed',
    overall: 'ready',
    checks: {
      info: check('info', 'ready'),
      price: check('price', 'ready'),
      photos: check('photos', 'ready'),
    },
    researchRunId: null,
    errorCode: null,
    createdAt: T_CHECK,
    completedAt: T_CHECK,
    ...overrides,
  };
}

function priceFix(eventId = 'e-1', refs: Partial<VerdictCheck['refs']> = {}): SaleVerdict {
  return verdict({
    overall: 'fix',
    checks: {
      info: check('info', 'ready'),
      price: check('price', 'fix', 'The price is above the market', {
        eventIds: [eventId],
        researchUpdatedAt: T_RESEARCH,
        currentPrice: 349,
        proposedPrice: 169,
        currency: 'PLN',
        ...refs,
      }),
      photos: check('photos', 'needs_human', 'Add photos', { photoCount: 1 }),
    },
  });
}

function run(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: 'run-1',
    workspaceId: 'ws',
    productId: 'p1',
    trigger: 'analyze',
    status: 'running',
    nodes: { identify: 'done', sameModelUsed: 'done', lastNewPrice: 'running' },
    outcome: null,
    failedTiers: [],
    errorCode: null,
    consecutiveFailures: 0,
    queuedAt: T_RESEARCH,
    startedAt: T_RESEARCH,
    finishedAt: null,
    leaseUntil: null,
    nextAutoAt: null,
    ...overrides,
  };
}

function research(overrides: Partial<PriceResearchView> = {}): PriceResearchView {
  return {
    productId: 'p1',
    retailPrice: null,
    retailCurrency: null,
    retailSource: null,
    retailCheckedAt: null,
    comparables: [],
    specs: null,
    dismissedUrls: [],
    lastAttemptAt: null,
    lastEstimate: null,
    updatedAt: T_RESEARCH,
    run: null,
    lastRun: null,
    nextAutoAt: null,
    readiness: 'ready',
    ...overrides,
  };
}

const ESTIMATE: NonNullable<PriceResearchView['lastEstimate']> = {
  estimate: {
    startPrice: 189,
    floorPrice: 150,
    retailAnchor: null,
    usedRange: null,
    reasoning: 'r',
    confidence: 'medium',
  },
  estimatedAt: T_RESEARCH,
  hiddenReason: null,
  researchNote: null,
  researchUpdatedAt: T_RESEARCH,
};

function event(id: string): HermesEvent {
  return {
    id,
    workspaceId: 'ws',
    productId: 'p1',
    type: 'suggested_lower_price',
    severity: 'info',
    status: 'pending_review',
    title: 'Lower the price',
    proposedChange: null,
    createdAt: T_CHECK,
  };
}

function state(input: Partial<Parameters<typeof hermesCardState>[0]> = {}) {
  return hermesCardState({
    verdict: null,
    research: null,
    stale: false,
    pendingEvents: [],
    suggestionTotal: 0,
    currency: 'PLN',
    now: NOW,
    ...input,
  });
}

const view = (
  latest: SaleVerdict | null,
  active: SaleVerdict | null = null,
  lastFailed = false,
  lastFailedCode: string | null = null
) => ({
  latest,
  active,
  lastFailed,
  lastFailedCode,
});

describe('hermesCardState matrix', () => {
  it('nothing analysed yet', () => {
    const s = state();
    expect(s.chip).toEqual({ label: 'Not analysed', color: 'default', outlined: false });
    expect(s.lead).toBe('Hermes has not looked at this product yet.');
    expect(s.primary).toEqual({ kind: 'analyze', label: 'Analyze product' });
    expect(s.showAnalyzeAgain).toBe(false);
    expect(s.footer).toBe('No runs yet');
  });

  it('active verdict with a research run active counts nodes and checks out of 8', () => {
    const s = state({
      verdict: view(null, verdict({ status: 'running', overall: null, checks: {}, researchRunId: 'run-1' })),
      research: research({ run: run() }),
    });
    expect(s.chip).toEqual({ label: 'Analyzing 3/8', color: 'primary', outlined: false });
    expect(s.lead).toBe('Searching prices: 1 of 4');
    expect(s.primary).toEqual({ kind: 'none' });
    expect(s.showAnalyzeAgain).toBe(false);
    expect(s.footer).toBe('Running now');
  });

  it('finished checks add to the research count', () => {
    const s = state({
      verdict: view(
        null,
        verdict({ status: 'running', overall: null, checks: { price: check('price', 'ready') }, researchRunId: 'run-1' })
      ),
      research: research({ run: run() }),
    });
    expect(s.chip.label).toBe('Analyzing 4/8');
  });

  it('active verdict without a research run counts out of 3', () => {
    const s = state({ verdict: view(null, verdict({ status: 'running', overall: null, checks: {} })) });
    expect(s.chip).toEqual({ label: 'Analyzing 1/3', color: 'primary', outlined: false });
    expect(s.lead).toBe('Price check…');
    expect(s.primary).toEqual({ kind: 'none' });
  });

  it('a verdict linked to a research run counts out of 8 even before the run is read', () => {
    const s = state({
      verdict: view(null, verdict({ status: 'running', overall: null, checks: {}, researchRunId: 'run-1' })),
    });
    expect(s.chip.label).toBe('Analyzing 6/8');
  });

  it('keeps counting the linked research nodes as done after the run finishes (no backwards step)', () => {
    const s = state({
      verdict: view(
        null,
        verdict({ status: 'running', overall: null, checks: { price: check('price', 'ready') }, researchRunId: 'run-1' })
      ),
      research: research({ run: null, lastRun: run({ status: 'finished', outcome: 'ok', finishedAt: T_CHECK }) }),
    });
    expect(s.chip.label).toBe('Analyzing 7/8');
  });

  it('fix on price with a pending event offers set_price', () => {
    const s = state({ verdict: view(priceFix()), pendingEvents: [event('e-1')] });
    expect(s.chip).toEqual({ label: 'Not ready', color: 'warning', outlined: false });
    expect(s.lead).toBe('The price is above the market');
    expect(s.primary).toEqual({ kind: 'set_price', label: 'Set price to 169 zł', eventId: 'e-1' });
    expect(s.showAnalyzeAgain).toBe(true);
    expect(s.footer).toBe('Last run 2h ago');
  });

  it('fix on price whose event is not pending falls back to analyze again', () => {
    const s = state({ verdict: view(priceFix()), pendingEvents: [event('other')] });
    expect(s.chip.label).toBe('Not ready');
    expect(s.lead).toBe('The price is above the market');
    expect(s.primary).toEqual({ kind: 'analyze', label: 'Analyze again' });
    expect(s.showAnalyzeAgain).toBe(false);
  });

  it('ready needs nothing but offers a second look', () => {
    const s = state({ verdict: view(verdict()) });
    expect(s.chip).toEqual({ label: 'Ready to sell', color: 'success', outlined: false });
    expect(s.lead).toBe('Nothing to fix. This product is ready to sell.');
    expect(s.primary).toEqual({ kind: 'none' });
    expect(s.showAnalyzeAgain).toBe(true);
  });

  it('stale keeps the label, outlines the chip and asks to analyze again', () => {
    const s = state({ verdict: view(verdict()), stale: true });
    expect(s.chip).toEqual({ label: 'Ready to sell', color: 'success', outlined: true });
    expect(s.lead).toBe('The product changed since this check.');
    expect(s.primary).toEqual({ kind: 'analyze', label: 'Analyze again' });
    expect(s.showAnalyzeAgain).toBe(false);
  });

  it('last run failed shows the plain reason of the failed run, never the code', () => {
    const s = state({ verdict: view(verdict(), null, true, 'expired') });
    expect(s.chip).toEqual({ label: 'Last run failed', color: 'error', outlined: false });
    expect(s.lead).toBe('The last run failed: the analysis took too long and was stopped.');
    expect(s.primary).toEqual({ kind: 'analyze', label: 'Analyze again' });
    expect(s.showAnalyzeAgain).toBe(false);
  });
});

describe('hermesCardState decisions', () => {
  it('a run in progress beats failed and stale', () => {
    const s = state({
      verdict: view(verdict(), verdict({ status: 'running', overall: null, checks: {} }), true),
      stale: true,
    });
    expect(s.chip.label).toBe('Analyzing 1/3');
  });

  it('failed beats stale', () => {
    const s = state({ verdict: view(verdict(), null, true), stale: true });
    expect(s.chip.label).toBe('Last run failed');
  });

  it.each([
    ['expired', 'the analysis took too long and was stopped'],
    ['run_error', 'the analysis stopped with an error'],
    ['store_failed', 'the result could not be saved'],
    ['research_active', 'a price search was already running'],
    ['enqueue_failed', 'the analysis could not be started'],
  ])('a failed run with code %s gives its own reason', (code, reason) => {
    const s = state({ verdict: view(verdict(), null, true, code) });
    expect(s.lead).toBe(`The last run failed: ${reason}.`);
    expect(s.lead).not.toContain(code);
  });

  it('failed never borrows the reason of a failed research run', () => {
    const s = state({
      verdict: view(verdict(), null, true, 'run_error'),
      research: research({ lastRun: run({ status: 'finished', outcome: 'failed', errorCode: 'timeout' }) }),
    });
    expect(s.lead).toBe('The last run failed: the analysis stopped with an error.');
  });

  it('failed with an unknown or missing code uses the fallback sentence', () => {
    expect(state({ verdict: view(null, null, true) }).lead).toBe('The last run failed: something went wrong.');
    const unknown = state({ verdict: view(null, null, true, 'weird_new_code') }).lead;
    expect(unknown).toBe('The last run failed: something went wrong.');
  });

  // A search with no analysis running (autopilot, or a queued run) counts its own 5 steps.
  it('a research run alone, with no verdict run, is a price search out of 5', () => {
    const s = state({ verdict: view(verdict()), research: research({ run: run() }) });
    expect(s.chip).toEqual({ label: 'Searching prices 3/5', color: 'primary', outlined: false });
    expect(s.lead).toBe('Searching prices: 1 of 4');
    expect(s.primary).toEqual({ kind: 'none' });
    expect(s.showAnalyzeAgain).toBe(false);
  });

  it('a research run alone keeps the last verdict in the check rows', () => {
    const rows = state({
      verdict: view(priceFix()),
      pendingEvents: [event('e-1')],
      research: research({ lastEstimate: ESTIMATE, run: run() }),
    }).rows;
    expect(rows.map((r) => [r.key, r.status])).toEqual([
      ['prices', 'running'],
      ['price', 'bad'],
      ['info', 'ok'],
      ['photos', 'attention'],
      ['suggestions', 'attention'],
    ]);
    expect(rows.find((r) => r.key === 'price')?.value).toBe('349 zł → 169 zł');
  });

  it('a research run alone before any verdict leaves the check rows idle', () => {
    const rows = state({ research: research({ run: run() }) }).rows;
    expect(rows.slice(1, 4).map((r) => [r.status, r.detail])).toEqual([
      ['idle', 'Not checked yet'],
      ['idle', 'Not checked yet'],
      ['idle', 'Not checked yet'],
    ]);
  });

  it('fix for a reason other than price analyzes again without a secondary button', () => {
    const s = state({
      verdict: view(
        verdict({
          overall: 'fix',
          checks: {
            info: check('info', 'fix', 'Add a description'),
            price: check('price', 'ready'),
            photos: check('photos', 'ready'),
          },
        })
      ),
    });
    expect(s.chip.label).toBe('Not ready');
    expect(s.lead).toBe('Add a description');
    expect(s.primary).toEqual({ kind: 'analyze', label: 'Analyze again' });
    expect(s.showAnalyzeAgain).toBe(false);
  });

  it('a price fix with no proposed price analyzes again', () => {
    const s = state({
      verdict: view(priceFix('e-1', { proposedPrice: null })),
      pendingEvents: [event('e-1')],
    });
    expect(s.primary).toEqual({ kind: 'analyze', label: 'Analyze again' });
    expect(s.showAnalyzeAgain).toBe(false);
  });

  it('needs_human takes chip and lead from the verdict and analyzes again', () => {
    const s = state({
      verdict: view(
        verdict({
          overall: 'needs_human',
          checks: {
            info: check('info', 'ready'),
            price: check('price', 'needs_human', 'Confirm the cost price'),
            photos: check('photos', 'ready'),
          },
        })
      ),
    });
    expect(s.chip).toEqual({ label: 'Needs you', color: 'error', outlined: false });
    expect(s.lead).toBe('Confirm the cost price');
    expect(s.primary).toEqual({ kind: 'analyze', label: 'Analyze again' });
    expect(s.showAnalyzeAgain).toBe(false);
  });
});

describe('hermesCardState rows', () => {
  it('always returns five rows in key order with fixed titles and tabs', () => {
    const rows = state().rows;
    expect(rows.map((r) => [r.key, r.title, r.tab])).toEqual([
      ['prices', 'Market prices', 'prices'],
      ['price', 'Price', 'checks'],
      ['info', 'Info', 'checks'],
      ['photos', 'Photos', 'checks'],
      ['suggestions', 'Suggestions', 'suggestions'],
    ]);
  });

  it('check rows map ready, fix and needs_human to ok, bad and attention', () => {
    const rows = state({ verdict: view(priceFix()), pendingEvents: [event('e-1')] }).rows;
    expect(rows.find((r) => r.key === 'info')?.status).toBe('ok');
    expect(rows.find((r) => r.key === 'price')?.status).toBe('bad');
    expect(rows.find((r) => r.key === 'photos')?.status).toBe('attention');
  });

  it('check rows without a result are idle when nothing runs', () => {
    const rows = state().rows;
    expect(rows.filter((r) => ['price', 'info', 'photos'].includes(r.key)).map((r) => r.status)).toEqual([
      'idle',
      'idle',
      'idle',
    ]);
  });

  it('check rows without a result are running during a run', () => {
    const rows = state({
      verdict: view(null, verdict({ status: 'running', overall: null, checks: { price: check('price', 'ready') } })),
    }).rows;
    expect(rows.find((r) => r.key === 'price')?.status).toBe('ok');
    expect(rows.find((r) => r.key === 'info')?.status).toBe('running');
    expect(rows.find((r) => r.key === 'photos')?.status).toBe('running');
  });

  it('price row says which market prices it used', () => {
    const price = state({ verdict: view(priceFix()) }).rows.find((r) => r.key === 'price')!;
    expect(price.detail).toBe('Uses the market prices from 1d ago');
  });

  it('price row falls back to the first reason without research', () => {
    const price = state({ verdict: view(priceFix('e-1', { researchUpdatedAt: null })) }).rows.find(
      (r) => r.key === 'price'
    )!;
    expect(price.detail).toBe('The price is above the market');
  });

  it('market prices row is idle and empty without a stored estimate', () => {
    const row = state().rows[0]!;
    expect(row).toMatchObject({ status: 'idle', value: '', detail: 'No market prices yet' });
  });

  it('market prices row shows Start and joins the existing parts in order', () => {
    const row = state({
      research: research({
        lastEstimate: ESTIMATE,
        comparables: [
          { price: 180, note: '' },
          { price: 200, note: '' },
        ],
        lastRun: run({ status: 'finished', outcome: 'ok', finishedAt: '2026-11-22T11:00:00.000Z' }),
      }),
    }).rows[0]!;
    expect(row.status).toBe('ok');
    expect(row.value).toBe('Start 189 zł');
    expect(row.detail).toBe('Floor 150 zł · 2 prices · 1h ago · confidence: medium');
  });

  it('market prices row leaves out the parts that do not exist', () => {
    const row = state({ research: research({ lastEstimate: ESTIMATE, updatedAt: null }) }).rows[0]!;
    expect(row.detail).toBe('Floor 150 zł · confidence: medium');
  });

  it('market prices row runs with the run progress while a research run is active', () => {
    const row = state({ research: research({ lastEstimate: ESTIMATE, run: run() }) }).rows[0]!;
    expect(row.status).toBe('running');
    expect(row.detail).toBe('Searching prices: 1 of 4');
  });

  it('suggestions row shows the count and how many wait', () => {
    const waiting = state({ suggestionTotal: 4, pendingEvents: [event('a'), event('b')] }).rows[4]!;
    expect(waiting).toMatchObject({ value: '4', detail: '2 waiting for you', status: 'attention' });
    const none = state({ suggestionTotal: 4 }).rows[4]!;
    expect(none).toMatchObject({ value: '4', detail: 'None waiting', status: 'idle' });
  });
});

describe('hermesProviderNote', () => {
  const REVIEW_ONLY = 'Any recommendation will remain review-only.';

  it('names the provider that answers a run in progress, as the old card did', () => {
    expect(hermesProviderNote('hermes', true, true)).toBe(`Hermes is analyzing this product only. ${REVIEW_ONLY}`);
    expect(hermesProviderNote('hermes', null, true)).toBe(`Hermes is analyzing this product only. ${REVIEW_ONLY}`);
    expect(hermesProviderNote('offline', null, true)).toBe(
      `Offline heuristics are analyzing this product only. ${REVIEW_ONLY}`
    );
  });

  it('names the provider that will answer while nothing runs', () => {
    expect(hermesProviderNote('hermes', true, false)).toBe(`Hermes analyzes this product only. ${REVIEW_ONLY}`);
    expect(hermesProviderNote('offline', null, false)).toBe(
      `Offline heuristics analyze this product only while Hermes is unavailable. ${REVIEW_ONLY}`
    );
  });

  it('never credits Hermes while its tools are unsafe, and stays neutral while the provider is unknown', () => {
    expect(hermesProviderNote('hermes', false, true)).toBe(`Analyzing this product only. ${REVIEW_ONLY}`);
    expect(hermesProviderNote(undefined, undefined, true)).toBe(`Analyzing this product only. ${REVIEW_ONLY}`);
    expect(hermesProviderNote('hermes', false, false)).toBe(REVIEW_ONLY);
    expect(hermesProviderNote(undefined, undefined, false)).toBe(REVIEW_ONLY);
  });
});
