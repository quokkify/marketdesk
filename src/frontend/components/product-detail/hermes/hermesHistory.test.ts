import type { HermesEvent, ResearchRun, SaleVerdict, VerdictCheck } from '@shared/types';
import { buildHistory, historyQueryState } from './hermesHistory';

const T0 = '2026-11-20T10:00:00.000Z';
const T1 = '2026-11-20T10:01:00.000Z';
const T2 = '2026-11-21T10:00:00.000Z';
const T3 = '2026-11-22T10:00:00.000Z';

function run(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: 'run-1',
    workspaceId: 'ws',
    productId: 'p1',
    trigger: 'analyze',
    status: 'finished',
    nodes: {
      identify: 'done',
      sameModelUsed: 'done',
      lastNewPrice: 'done',
      substitutesNew: 'done',
      substitutesUsed: 'done',
    },
    outcome: 'ok',
    failedTiers: [],
    errorCode: null,
    consecutiveFailures: 0,
    queuedAt: T0,
    startedAt: T0,
    finishedAt: T1,
    leaseUntil: null,
    nextAutoAt: null,
    ...overrides,
  };
}

function check(name: VerdictCheck['check'], status: VerdictCheck['status'], message?: string): VerdictCheck {
  return {
    check: name,
    status,
    reasons: message ? [{ code: 'x', message }] : [],
    checkedAt: T1,
    refs: { eventIds: [] },
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
    overall: 'fix',
    checks: {
      info: check('info', 'ready'),
      price: check('price', 'fix', 'The price is above the market'),
      photos: check('photos', 'needs_human', 'Add photos'),
    },
    researchRunId: null,
    errorCode: null,
    createdAt: T0,
    completedAt: T1,
    ...overrides,
  };
}

function event(overrides: Partial<HermesEvent> = {}): HermesEvent {
  return {
    id: 'e-1',
    workspaceId: 'ws',
    productId: 'p1',
    type: 'suggested_lower_price',
    severity: 'info',
    status: 'pending_review',
    title: 'Lower the price to 279',
    proposedChange: {} as HermesEvent['proposedChange'],
    createdAt: T2,
    ...overrides,
  };
}

const base = { researchRuns: [], verdicts: [], events: [], currency: 'PLN' };

describe('buildHistory', () => {
  it('a verdict with researchRunId and its research run become one Analysis entry with 8 steps', () => {
    const entries = buildHistory({
      ...base,
      researchRuns: [run()],
      verdicts: [verdict({ researchRunId: 'run-1' })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Analysis');
    expect(entries[0]!.steps.map((s) => s.label)).toEqual([
      'Identify the model',
      'Same model used',
      'Last new price',
      'New substitutes',
      'Used substitutes',
      'Price check',
      'Info check',
      'Photos check',
    ]);
    expect(entries[0]!.startedBy).toBe('you');
    expect(entries[0]!.steps[5]).toMatchObject({ status: 'bad', detail: 'The price is above the market' });
  });

  it('a research run no verdict points to is a separate Price search entry', () => {
    const manual = buildHistory({ ...base, researchRuns: [run({ trigger: 'manual' })] });
    expect(manual[0]).toMatchObject({ title: 'Price search', startedBy: 'you' });
    const auto = buildHistory({ ...base, researchRuns: [run({ trigger: 'autopilot' })] });
    expect(auto[0]).toMatchObject({ title: 'Price search', startedBy: 'autopilot' });
  });

  it('an Analysis whose research run was autopilot is started by autopilot', () => {
    const entries = buildHistory({
      ...base,
      researchRuns: [run({ trigger: 'autopilot' })],
      verdicts: [verdict({ researchRunId: 'run-1' })],
    });
    expect(entries[0]!.startedBy).toBe('autopilot');
  });

  it('a verdict without researchRunId is an Analysis entry with 3 steps', () => {
    const entries = buildHistory({ ...base, verdicts: [verdict()] });
    expect(entries[0]!.title).toBe('Analysis');
    expect(entries[0]!.steps.map((s) => s.label)).toEqual(['Price check', 'Info check', 'Photos check']);
    expect(entries[0]!.durationMs).toBe(60_000);
  });

  it('entries are sorted newest first across the three sources', () => {
    const entries = buildHistory({
      ...base,
      researchRuns: [run({ id: 'r-old', startedAt: T0 })],
      verdicts: [verdict({ id: 'v-new', createdAt: T3 })],
      events: [event({ createdAt: T2 })],
    });
    expect(entries.map((e) => e.title)).toEqual(['Analysis', 'Suggestion', 'Price search']);
  });

  it('a failed research run maps errorCode to a sentence and marks the unfinished steps none', () => {
    const entries = buildHistory({
      ...base,
      researchRuns: [
        run({
          trigger: 'manual',
          outcome: 'failed',
          errorCode: 'research_unreachable',
          nodes: { identify: 'done', sameModelUsed: 'failed', lastNewPrice: 'pending' },
        }),
      ],
    });
    const [entry] = entries;
    expect(entry!.outcome).toEqual({ label: 'Failed', tone: 'error' });
    expect(entry!.steps.map((s) => s.status)).toEqual(['ok', 'bad', 'none', 'none', 'none', 'bad']);
    const details = entry!.steps.map((s) => s.detail).join(' ');
    expect(details).toContain('market search is unavailable');
    expect(details).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it('an unknown error code never leaks the raw code', () => {
    const entries = buildHistory({
      ...base,
      verdicts: [verdict({ status: 'failed', overall: null, errorCode: 'weird_new_code', checks: {} })],
    });
    expect(entries[0]!.outcome).toEqual({ label: 'Failed', tone: 'error' });
    const last = entries[0]!.steps[entries[0]!.steps.length - 1]!;
    expect(last.status).toBe('bad');
    expect(last.detail).not.toContain('weird_new_code');
    expect(last.detail).toContain('something went wrong');
  });

  it('a running run has durationMs null and outcome tone info, label Running', () => {
    const entries = buildHistory({
      ...base,
      researchRuns: [run({ status: 'running', outcome: null, finishedAt: null, nodes: { identify: 'running' } })],
    });
    expect(entries[0]!.durationMs).toBeNull();
    expect(entries[0]!.outcome).toEqual({ label: 'Running', tone: 'info' });
  });

  it('outcome labels follow the verdict overall and the research outcome', () => {
    const labels = (outcome: ResearchRun['outcome']) =>
      buildHistory({ ...base, researchRuns: [run({ outcome })] })[0]!.outcome.label;
    expect(labels('ok')).toBe('Prices found');
    expect(labels('partial')).toBe('Partial');
    expect(labels('failed')).toBe('Failed');
    const v = buildHistory({ ...base, verdicts: [verdict({ overall: 'ready' })] })[0]!;
    expect(v.outcome).toEqual({ label: 'Ready to sell', tone: 'success' });
  });

  it('events become Suggestion entries titled by the event summary', () => {
    const entries = buildHistory({ ...base, events: [event()] });
    expect(entries[0]).toMatchObject({
      title: 'Suggestion',
      startedBy: 'Hermes',
      durationMs: null,
      at: T2,
      outcome: { label: 'Pending review', tone: 'warning' },
    });
    expect(entries[0]!.steps[0]!.label).toBe('Lower the price to 279');
    expect(entries[0]!.steps[0]!.detail).toBe('Waiting for your review');
    const resolved = buildHistory({ ...base, events: [event({ status: 'applied', detail: 'raw backend text' })] });
    expect(resolved[0]!.steps[0]!.detail).toBe('');
  });

  it('resolved suggestions keep a plain outcome label, never a raw status code', () => {
    const entries = buildHistory({
      ...base,
      events: [
        event({ id: 'e-applied', status: 'applied', createdAt: T2 }),
        event({ id: 'e-dismissed', status: 'dismissed', createdAt: T1 }),
        event({ id: 'e-failed', status: 'failed', createdAt: T0 }),
      ],
    });
    expect(entries.map((e) => e.outcome)).toEqual([
      { label: 'Applied', tone: 'success' },
      { label: 'Dismissed', tone: 'default' },
      { label: 'Action failed', tone: 'error' },
    ]);
    expect(entries.map((e) => e.steps[0]!.status)).toEqual(['ok', 'none', 'bad']);
  });
});

describe('historyQueryState', () => {
  const ready = { currentData: [], isError: false };

  it('is not loading when every list has data for this product', () => {
    expect(historyQueryState([ready, ready, ready])).toEqual({ loading: false, error: undefined });
  });

  it('is loading while any list has no data yet', () => {
    expect(historyQueryState([ready, { currentData: undefined, isError: false }, ready]).loading).toBe(true);
  });

  it('reports the error, not loading, when a list failed', () => {
    const failure = { status: 503 };
    expect(historyQueryState([ready, { currentData: undefined, isError: true, error: failure }, ready])).toEqual({
      loading: false,
      error: failure,
    });
  });
});
