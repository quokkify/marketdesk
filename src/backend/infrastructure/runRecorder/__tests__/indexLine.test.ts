import type { RunEvent } from '../../../application/ports/IRunRecorder';
import { formatIndexLine, indexTagFor, type IndexTag, type RunFacts } from '../indexLine';

const httpEnd = (status: number, aborted?: boolean): RunEvent => ({
  type: 'http.end',
  method: 'POST',
  route: '/api/x',
  status,
  durationMs: 1,
  ...(aborted ? { aborted } : {}),
});

const attemptEnd = (ok: boolean, attempt: number, maxAttempts = 3): RunEvent => ({
  type: 'queue.attempt.end',
  queue: 'q',
  attempt,
  maxAttempts,
  ok,
  durationMs: 1,
});

const plain: RunFacts = { queued: false, expectedError: false };

describe('indexTagFor', () => {
  it.each<[string, RunEvent, RunFacts, IndexTag | null]>([
    ['http success, nothing queued', httpEnd(200), plain, 'RUN-OK'],
    ['http success, job queued', httpEnd(202), { queued: true, expectedError: false }, null],
    [
      'http 4xx, expected error',
      httpEnd(409),
      { queued: false, expectedError: true },
      'RUN-BLOCKED',
    ],
    [
      'http 4xx, unexpected error',
      httpEnd(400),
      { queued: false, expectedError: false, errored: true },
      'RUN-FAIL',
    ],
    ['http 429 with no recorded error', httpEnd(429), plain, 'RUN-BLOCKED'],
    ['http 5xx', httpEnd(500), { queued: false, expectedError: true }, 'RUN-FAIL'],
    ['http aborted, no recorded error', httpEnd(499, true), plain, null],
    ['attempt ok', attemptEnd(true, 1), plain, 'RUN-OK'],
    ['attempt failed, retries left', attemptEnd(false, 2), plain, 'RUN-RETRY'],
    ['attempt failed, last attempt', attemptEnd(false, 3), plain, 'RUN-FAIL'],
    ['unrelated event', { type: 'run.start', kind: 'http' }, plain, null],
  ])('%s', (_name, event, facts, expected) => {
    expect(indexTagFor(event, facts)).toBe(expected);
  });
});

describe('formatIndexLine', () => {
  it('formats a line a watcher can match with ^RUN-FAIL', () => {
    expect(
      formatIndexLine(
        'RUN-FAIL',
        'r1',
        new Date('2026-11-15T10:00:00Z'),
        'publish-listing attempt 3/3 InvalidStateError'
      )
    ).toBe('RUN-FAIL r1 2026-11-15T10:00:00.000Z publish-listing attempt 3/3 InvalidStateError');
  });
});
