import type { ListingResponseRun, ListingResponseSignal, ResponseFinding } from '@shared/types';
import type { ListingResponseView } from '@shared/types';
import {
  askChecking,
  askFailed,
  askProgress,
  askReused,
  canAskWhy,
  checkedLabel,
  currentRowResponse,
  responseActionKind,
  responseControlTarget,
  responseLines,
  stageLabel,
} from '../responseDisplay.js';

function signal(patch: Partial<ListingResponseSignal>): ListingResponseSignal {
  return {
    listingId: 'l-1',
    stage: 'not_seen',
    views: 12,
    viewsPerDay: 3,
    hoursLive: 72,
    viewsNeeded: null,
    ...patch,
  };
}

function finding(message: string): ResponseFinding {
  return { code: 'crowded_market', message, action: null, evidence: {} };
}

function run(findings: ResponseFinding[], completedAt: string | null = '2026-11-23T10:00:00.000Z'): ListingResponseRun {
  return { id: 'r-1', findings, completedAt } as ListingResponseRun;
}

describe('stageLabel', () => {
  it('names a young too_early listing by its day', () => {
    expect(stageLabel(signal({ stage: 'too_early', hoursLive: 30 }))).toBe('Too early · day 2');
  });

  it('shows the views collected so far while collecting', () => {
    expect(stageLabel(signal({ stage: 'too_early', views: 31, viewsNeeded: 80 }))).toBe('Too early · 31 of 80 views');
  });

  it('names a not_seen listing by its day', () => {
    expect(stageLabel(signal({ stage: 'not_seen', hoursLive: 80 }))).toBe('Not seen · day 4');
  });

  it('counts the first hours as day 1', () => {
    expect(stageLabel(signal({ stage: 'not_seen', hoursLive: 2 }))).toBe('Not seen · day 1');
  });

  it('omits the day when the age is unknown', () => {
    expect(stageLabel(signal({ stage: 'not_seen', hoursLive: null }))).toBe('Not seen');
    expect(stageLabel(signal({ stage: 'too_early', hoursLive: null }))).toBe('Too early');
  });

  it('shows the views of a seen listing nobody contacted', () => {
    expect(stageLabel(signal({ stage: 'seen_not_contacted', views: 95 }))).toBe('Seen, no contact · 95 views');
  });

  it('says there are no fresh statistics', () => {
    expect(stageLabel(signal({ stage: 'no_data' }))).toBe('No fresh statistics');
  });

  it('shows nothing for a responding listing', () => {
    expect(stageLabel(signal({ stage: 'responding' }))).toBe('');
  });
});

describe('canAskWhy', () => {
  it.each(['not_seen', 'seen_not_contacted'] as const)('is true for %s with no active run', (stage) => {
    expect(canAskWhy(signal({ stage }), false)).toBe(true);
  });

  it.each(['too_early', 'responding', 'no_data'] as const)('is false for %s', (stage) => {
    expect(canAskWhy(signal({ stage }), false)).toBe(false);
  });

  it('is false without a signal and while a run is active', () => {
    expect(canAskWhy(null, false)).toBe(false);
    expect(canAskWhy(signal({ stage: 'not_seen' }), true)).toBe(false);
  });
});

describe('responseLines', () => {
  const findings = [finding('a'), finding('b'), finding('c')];

  it('returns the messages in stored order up to the limit', () => {
    expect(responseLines(run(findings), 2)).toEqual(['a', 'b']);
    expect(responseLines(run(findings), 10)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for no run or a run without findings', () => {
    expect(responseLines(null, 2)).toEqual([]);
    expect(responseLines(run([]), 2)).toEqual([]);
  });
});

describe('checkedLabel', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');

  it('shows the relative time of the run', () => {
    expect(checkedLabel(run([finding('a')]), now)).toBe('checked 2h ago');
  });

  it('says nothing found for a run without findings', () => {
    expect(checkedLabel(run([]), now)).toBe('checked 2h ago · nothing found');
  });

  it('is null without a completed run', () => {
    expect(checkedLabel(null, now)).toBeNull();
    expect(checkedLabel(run([], null), now)).toBeNull();
  });
});

describe('row ask state', () => {
  const old = run([finding('old')], '2026-11-23T09:00:00.000Z');
  const fresh = run([finding('new')], '2026-11-23T11:00:00.000Z');
  const view = (patch: Partial<ListingResponseView>): ListingResponseView => ({
    latest: null,
    active: null,
    lastFailed: false,
    outOfDate: false,
    ...patch,
  });

  it('goes idle to checking to done', () => {
    const checking = askChecking({}, 'p-1', old);
    expect(checking['p-1']).toEqual({ active: true, outOfDate: false, latest: old });

    const polling = askProgress(checking, 'p-1', view({ active: run([]), latest: old }));
    expect(polling['p-1']?.active).toBe(true);

    const done = askProgress(polling, 'p-1', view({ latest: fresh, outOfDate: true }));
    expect(done['p-1']).toEqual({ active: false, outOfDate: true, latest: fresh });
  });

  it('shows a reused run as done at once, whatever failed after it', () => {
    const done = askReused(askChecking({}, 'p-1', null), 'p-1', fresh);
    expect(done['p-1']).toEqual({ active: false, outOfDate: false, latest: fresh });
  });

  it('drops the entry on error and leaves other products alone', () => {
    const map = askChecking(askChecking({}, 'p-1', old), 'p-2', null);
    const failed = askFailed(map, 'p-1');
    expect(failed['p-1']).toBeUndefined();
    expect(failed['p-2']?.active).toBe(true);
  });

  it('keeps an active entry whatever the list shows', () => {
    const entry = { active: true, outOfDate: false, latest: old };
    expect(currentRowResponse(entry, fresh)).toBe(entry);
  });

  it('keeps a finished entry until the list item carries its run or a newer one', () => {
    const entry = { active: false, outOfDate: false, latest: fresh };
    expect(currentRowResponse(entry, old)).toBe(entry);
    expect(currentRowResponse(entry, fresh)).toBeUndefined();
    expect(currentRowResponse(entry, run([], '2026-11-23T11:30:00.000Z'))).toBeUndefined();
  });

  it('has no entry without one', () => {
    expect(currentRowResponse(undefined, fresh)).toBeUndefined();
  });
});

describe('finding action to page control', () => {
  it('maps every action to the page control or none', () => {
    expect(responseActionKind('retry')).toBeNull();
    expect(responseActionKind(null)).toBeNull();
    expect(responseControlTarget('analyze')).toEqual({ kind: 'analyze' });
    expect(responseControlTarget('review_price')).toEqual({ kind: 'tab', tab: 'checks' });
    expect(responseControlTarget('edit_title')).toEqual({ kind: 'edit' });
    expect(responseControlTarget('open_proposal')).toEqual({ kind: 'tab', tab: 'suggestions' });
  });
});
