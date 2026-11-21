import type { AiUsageSummary, HermesLimits } from '@shared/types';
import { aiUsageLine, limitsView, REFRESH_FAILED_NOTE } from './aiUsageText.js';

const hermes = (over: Partial<AiUsageSummary>): AiUsageSummary => ({
  provider: 'hermes',
  calls: 1,
  promptTokens: 1840,
  completionTokens: 412,
  totalTokens: 2252,
  costStatus: 'included',
  ...over,
});

const limits = (over: Partial<HermesLimits>): HermesLimits => ({
  state: 'fresh',
  scope: 'account',
  provider: 'openai-codex',
  plan: 'Plus',
  fetchedAt: '2026-11-21T10:00:00Z',
  ageSeconds: 30,
  windows: [{ label: 'Session', usedPercent: 10, resetsAt: null }],
  details: [],
  reason: null,
  ...over,
});

describe('aiUsageLine', () => {
  it('states Hermes tokens and the subscription', () => {
    expect(aiUsageLine(hermes({}))).toBe(
      'Hermes · 1,840 in / 412 out tokens · included in subscription'
    );
  });
  it('never turns missing tokens into zero', () => {
    expect(
      aiUsageLine(hermes({ promptTokens: null, completionTokens: null, totalTokens: null }))
    ).toBe('Hermes · usage not reported');
  });
  it('omits the subscription claim when the cost is unknown', () => {
    expect(aiUsageLine(hermes({ costStatus: 'unknown' }))).toBe(
      'Hermes · 1,840 in / 412 out tokens'
    );
  });
  it('says the offline heuristics used no AI', () => {
    expect(
      aiUsageLine(hermes({ provider: 'offline', promptTokens: null, completionTokens: null }))
    ).toBe('Offline heuristics · no AI usage');
  });
  it('is empty without a usage summary', () => {
    expect(aiUsageLine(undefined)).toBe('');
    expect(aiUsageLine(hermes({ provider: 'none' }))).toBe('');
  });
});

describe('limitsView', () => {
  it('colours bars by how full they are', () => {
    const view = limitsView(
      limits({
        windows: [
          { label: 'A', usedPercent: 79, resetsAt: null },
          { label: 'B', usedPercent: 80, resetsAt: null },
          { label: 'C', usedPercent: 100, resetsAt: null },
          { label: 'D', usedPercent: null, resetsAt: null },
        ],
      })
    );
    expect(view.bars.map((b) => b.tone)).toEqual(['ok', 'warning', 'error', 'ok']);
    expect(view.note).toBe('');
  });
  it('flags a stale reading with its age', () => {
    expect(limitsView(limits({ state: 'stale', ageSeconds: 1230 })).note).toBe(
      'checked 21 min ago — may be out of date'
    );
  });
  it('shows no numbers when the reading is unknown', () => {
    const view = limitsView(limits({ state: 'unknown', windows: [], reason: 'fetch failed' }));
    expect(view.bars).toEqual([]);
    expect(view.note).toBe('Limits unavailable — fetch failed');
  });
  it('says unavailable when Hermes is not configured', () => {
    expect(limitsView(limits({ state: 'not_configured', windows: [] })).note).toBe(
      'Limits unavailable'
    );
  });
  it('does not invent an age for a stale reading without one', () => {
    expect(limitsView(limits({ state: 'stale', ageSeconds: null })).note).toBe('may be out of date');
  });
  it('keeps percent null for a window that reported none', () => {
    const view = limitsView(limits({ windows: [{ label: 'Weekly', usedPercent: null, resetsAt: null }] }));
    expect(view.bars[0].percent).toBeNull();
  });
  it('says so when a reading has no windows', () => {
    expect(limitsView(limits({ windows: [] })).note).toBe('No limit windows reported');
  });
  it('marks the last reading when a later refresh failed', () => {
    const view = limitsView(limits({}), true);
    expect(view.note).toBe(REFRESH_FAILED_NOTE);
    expect(view.stale).toBe(true);
    expect(view.bars).toHaveLength(1);
  });
});
