import {
  analysisStateFor,
  canStartRowAnalysis,
  rowAnalysisLabel,
  rowAnalyzeDisabledReason,
  runSequentially,
  stateAfterPendingChange,
} from './productsRowAnalysis';
import type { RowAnalysisState } from './productsRowAnalysis';

describe('row analysis label', () => {
  it.each([
    [undefined, null],
    [{ status: 'running' }, null],
    [{ status: 'done', count: 2 }, '2 to review'],
    [{ status: 'done', count: 1 }, '1 to review'],
    [{ status: 'done', count: 0 }, 'No new suggestions'],
    [{ status: 'reviewed' }, 'All reviewed'],
    [{ status: 'error', message: 'Boom' }, 'Boom'],
  ])('label for %o is %s', (state, label) => {
    expect(rowAnalysisLabel(state as RowAnalysisState | undefined)).toBe(label);
  });
});

describe('row analysis state', () => {
  it('follows the live pending list of an expanded row', () => {
    expect(stateAfterPendingChange({ status: 'done', count: 2 }, 1)).toEqual({
      status: 'done',
      count: 1,
    });
    expect(stateAfterPendingChange({ status: 'done', count: 1 }, 0)).toEqual({
      status: 'reviewed',
    });
    expect(stateAfterPendingChange({ status: 'done', count: 0 }, 0)).toEqual({
      status: 'done',
      count: 0,
    });
    expect(stateAfterPendingChange(undefined, 3)).toEqual({ status: 'done', count: 3 });
    expect(stateAfterPendingChange({ status: 'running' }, 0)).toEqual({ status: 'running' });
  });

  it('refuses to start while running or disabled', () => {
    expect(canStartRowAnalysis({ status: 'running' }, null)).toBe(false);
    expect(
      canStartRowAnalysis(undefined, 'The listing SEO agent is switched off for this workspace.')
    ).toBe(false);
    expect(canStartRowAnalysis({ status: 'done', count: 0 }, null)).toBe(true);
  });

  it('reports the settings reasons only', () => {
    expect(rowAnalyzeDisabledReason({ settingsLoaded: false, listingSeoEnabled: false })).toBe(
      'Hermes settings are still loading.'
    );
    expect(rowAnalyzeDisabledReason({ settingsLoaded: true, listingSeoEnabled: false })).toBe(
      'The listing SEO agent is switched off for this workspace.'
    );
    expect(rowAnalyzeDisabledReason({ settingsLoaded: true, listingSeoEnabled: true })).toBeNull();
  });
});

describe('sequential analysis of selected products', () => {
  it('runs one at a time and stops on 429, keeping finished results', async () => {
    const seen: Array<[string, string]> = [];
    let inFlight = 0;
    const run = async (id: string) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      inFlight -= 1;
      if (id === 'c') throw { status: 429, data: { error: { message: 'Too many AI requests' } } };
      return id === 'a' ? 2 : 0;
    };
    const result = await runSequentially(['a', 'b', 'c', 'd'], run, (id, state) =>
      seen.push([id, state.status])
    );
    expect(result).toEqual({ analyzed: 2, notRun: ['c', 'd'] });
    expect(seen).toEqual([
      ['a', 'running'],
      ['a', 'done'],
      ['b', 'running'],
      ['b', 'done'],
      ['c', 'running'],
      ['c', 'error'],
    ]);
  });

  it('marks a failed product and continues with the next one', async () => {
    const run = async (id: string) => {
      if (id === 'a') throw new Error('Hermes timeout');
      return 1;
    };
    const states: Record<string, RowAnalysisState> = {};
    const result = await runSequentially(['a', 'b'], run, (id, state) => {
      states[id] = state;
    });
    expect(result).toEqual({ analyzed: 1, notRun: [] });
    expect(states.a).toEqual({ status: 'error', message: 'Hermes timeout' });
    expect(states.b).toEqual({ status: 'done', count: 1 });
  });
});

describe('sequential analysis guards', () => {
  // Regression guard: a row already running is never analyzed a second time at once.
  it('skips products that are already running', async () => {
    const ran: string[] = [];
    const result = await runSequentially(
      ['a', 'b'],
      async (id) => {
        ran.push(id);
        return 0;
      },
      () => {},
      { skip: (id) => id === 'a' }
    );
    expect(ran).toEqual(['b']);
    expect(result).toEqual({ analyzed: 1, notRun: [] });
  });

  // Regression guard: leaving the page stops the run instead of spending the AI rate limit.
  it('stops before the next product once told not to continue', async () => {
    let keepGoing = true;
    const ran: string[] = [];
    const result = await runSequentially(
      ['a', 'b', 'c'],
      async (id) => {
        ran.push(id);
        keepGoing = false;
        return 0;
      },
      () => {},
      { shouldContinue: () => keepGoing }
    );
    expect(ran).toEqual(['a']);
    expect(result).toEqual({ analyzed: 1, notRun: ['b', 'c'] });
  });
});

describe('persistent pending counts', () => {
  it('shows server counts unless the session has something more recent', () => {
    expect(analysisStateFor(undefined, 2)).toEqual({ status: 'done', count: 2 });
    expect(analysisStateFor(undefined, undefined)).toBeUndefined();
    expect(analysisStateFor({ status: 'running' }, 2)).toEqual({ status: 'running' });
    expect(analysisStateFor({ status: 'error', message: 'x' }, 2)).toEqual({
      status: 'error',
      message: 'x',
    });
    expect(analysisStateFor({ status: 'reviewed' }, 0)).toEqual({ status: 'reviewed' });
    expect(analysisStateFor({ status: 'done', count: 0 }, 1)).toEqual({ status: 'done', count: 1 });
  });
});
