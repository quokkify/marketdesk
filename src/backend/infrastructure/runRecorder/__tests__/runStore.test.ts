import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RunEvent } from '../../../application/ports/IRunRecorder';
import { FileRunRecorder } from '../FileRunRecorder';
import { SecretRegistry } from '../SecretRegistry';
import {
  doctor,
  followIndex,
  formatRun,
  listRuns,
  readRun,
  resolveRun,
  STALE_AFTER_MS,
  summarize,
  type StoredEvent,
} from '../runStore';

let dir: string;
let clock: Date;
let rec: FileRunRecorder;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runstore-'));
  clock = new Date('2026-11-15T10:00:00.000Z');
  rec = new FileRunRecorder({ dir, registry: new SecretRegistry(), now: () => clock });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (offsetMs: number): Date =>
  new Date(new Date('2026-11-15T10:00:00.000Z').getTime() + offsetMs);

function write(runId: string, events: RunEvent[], startMs: number): void {
  events.forEach((event, i) => {
    clock = at(startMs + i * 10);
    rec.record(runId, event);
  });
}

const error = {
  name: 'InvalidStateError',
  message: 'listing is not publishable',
  details: { status: 'draft' },
  at: 'src/x.ts:1',
};

const publishHttp: RunEvent[] = [
  { type: 'run.start', kind: 'http', method: 'POST', path: '/api/listings/1/publish' },
  { type: 'link', operationId: 'op1', listingId: 'l1', marketplaceKey: 'ebay' },
  { type: 'queue.enqueued', queue: 'publish', jobId: 'op1', data: { a: 1 } },
  {
    type: 'http.end',
    method: 'POST',
    route: '/api/listings/:id/publish',
    status: 202,
    durationMs: 5,
  },
];

const attempt = (n: number, ok: boolean, queue = 'publish'): RunEvent => ({
  type: 'queue.attempt.end',
  queue,
  jobId: 'op1',
  attempt: n,
  maxAttempts: 3,
  ok,
  durationMs: 9,
  ...(ok ? {} : { error }),
});

const stored = (runId: string): StoredEvent[] => readRun(dir, runId);
const now = (): Date => at(60_000);

describe('summarize', () => {
  it('derives blocked for an expected 4xx without a job', () => {
    write(
      'b1',
      [
        { type: 'run.start', kind: 'http', method: 'POST', path: '/x' },
        { type: 'http.error', status: 409, expected: true, error },
        { type: 'http.end', method: 'POST', route: '/x', status: 409, durationMs: 1 },
      ],
      0
    );
    expect(summarize(stored('b1'), now()).outcome).toBe('blocked');
  });

  it('derives failed only after the last attempt, open before it', () => {
    write('f1', [...publishHttp, attempt(1, false), attempt(2, false)], 0);
    expect(summarize(stored('f1'), now()).outcome).toBe('open');
    write('f2', [...publishHttp, attempt(1, false), attempt(2, false), attempt(3, false)], 0);
    expect(summarize(stored('f2'), now()).outcome).toBe('failed');
  });

  it('derives ok for a completed job and for a request with no job', () => {
    write('o1', [...publishHttp, attempt(1, true)], 0);
    expect(summarize(stored('o1'), now()).outcome).toBe('ok');
    write(
      'o2',
      [
        { type: 'run.start', kind: 'http', method: 'GET', path: '/x' },
        { type: 'http.end', method: 'GET', route: '/x', status: 200, durationMs: 1 },
      ],
      0
    );
    expect(summarize(stored('o2'), now()).outcome).toBe('ok');
  });

  it('keeps a failed single-attempt job run open', () => {
    write('j1', [{ type: 'run.start', kind: 'job', queue: 'sync' }, attempt(1, false, 'sync')], 0);
    const summary = summarize(stored('j1'), now());
    expect(summary.outcome).toBe('open');
    expect(summary.title).toBe('job sync');
  });

  it('derives blocked for a 429 with no recorded error', () => {
    write(
      'rl1',
      [
        { type: 'run.start', kind: 'http', method: 'POST', path: '/x' },
        { type: 'http.end', method: 'POST', route: '/x', status: 429, durationMs: 1 },
      ],
      0
    );
    expect(summarize(stored('rl1'), now()).outcome).toBe('blocked');
  });

  it('treats a missing maxAttempts as a single attempt', () => {
    const { maxAttempts: _omitted, ...noMax } = attempt(1, false) as RunEvent & {
      maxAttempts: number;
    };
    write('m1', [{ type: 'run.start', kind: 'job', queue: 'publish' }, noMax as RunEvent], 0);
    expect(summarize(stored('m1'), now()).outcome).toBe('failed');
  });

  it('treats an aborted request as open', () => {
    write(
      'a1',
      [
        { type: 'run.start', kind: 'http', method: 'GET', path: '/x' },
        { type: 'http.end', method: 'GET', route: '/x', status: 499, durationMs: 1, aborted: true },
      ],
      0
    );
    expect(summarize(stored('a1'), now()).outcome).toBe('open');
    expect(formatRun(stored('a1'), now(), {})).toContain('aborted');
  });

  it('marks an unfinished run stale after ten minutes', () => {
    write('s1', publishHttp, 0);
    const events = stored('s1');
    expect(summarize(events, at(STALE_AFTER_MS)).outcome).toBe('open');
    expect(summarize(events, at(STALE_AFTER_MS + 100)).outcome).toBe('stale');
  });
});

describe('listRuns and resolveRun', () => {
  beforeEach(() => {
    write('r-ok', [...publishHttp, attempt(1, true)], 0);
    write(
      'r-blocked',
      [
        { type: 'run.start', kind: 'http', method: 'POST', path: '/x' },
        { type: 'http.error', status: 409, expected: true, error },
        { type: 'http.end', method: 'POST', route: '/x', status: 409, durationMs: 1 },
      ],
      1000
    );
    write('r-failed', [...publishHttp, attempt(3, false)], 2000);
    fs.mkdirSync(path.join(dir, 'not-a-run'));
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'x');
  });

  it('lists newest first and filters failed to failed plus blocked', () => {
    expect(listRuns(dir, { now: now() }).map((r) => r.runId)).toEqual([
      'r-failed',
      'r-blocked',
      'r-ok',
    ]);
    expect(listRuns(dir, { failed: true, now: now() }).map((r) => r.outcome)).toEqual([
      'failed',
      'blocked',
    ]);
    expect(listRuns(dir, { sinceMs: 59_000, now: now() }).map((r) => r.runId)).toEqual([
      'r-failed',
      'r-blocked',
    ]);
  });

  it('resolves last, a prefix and an operation id', () => {
    expect(resolveRun(dir, 'last', now())).toBe('r-failed');
    expect(resolveRun(dir, 'r-bl', now())).toBe('r-blocked');
    expect(resolveRun(dir, 'r-', now())).toBeUndefined();
    expect(resolveRun(dir, 'op1', now())).toBe('r-failed');
    expect(resolveRun(dir, 'nope', now())).toBeUndefined();
  });

  it('resolves an operation id prefix, newest run when the operation is shared', () => {
    write('r-op2', [{ type: 'link', operationId: 'op2-zzz' }], 3000);
    write('r-op3', [{ type: 'link', operationId: 'op2-yyy' }], 4000);
    write('r-long', [{ type: 'link', operationId: 'longoperation-1' }], 5000);
    expect(resolveRun(dir, 'longop', now())).toBe('r-long');
    expect(resolveRun(dir, 'op2-', now())).toBeUndefined();
    expect(resolveRun(dir, 'op2-z', now())).toBe('r-op2');
    write('r-long2', [{ type: 'link', operationId: 'longoperation-1' }], 6000);
    expect(resolveRun(dir, 'longoperation', now())).toBe('r-long2');
  });

  it('does not prefix-match refs shorter than four characters', () => {
    expect(resolveRun(dir, 'r-f', now())).toBeUndefined();
    expect(resolveRun(dir, 'op', now())).toBeUndefined();
  });
});

describe('readRun', () => {
  it('skips a half-written last line', () => {
    write('h1', publishHttp.slice(0, 2), 0);
    fs.appendFileSync(path.join(dir, 'h1', 'events.jsonl'), '{"ts":"2026');
    expect(readRun(dir, 'h1')).toHaveLength(2);
  });
});

describe('formatRun', () => {
  it('formats a failed publish run with the refusal on one line', () => {
    write('p1', [...publishHttp, attempt(3, false)], 0);
    const text = formatRun(stored('p1'), now(), {});
    expect(text.split('\n')[0]).toBe('RUN-FAIL p1 POST /api/listings/:id/publish op=op1');
    expect(text).toContain('queue   publish:op1 attempt 3/3 failed');
    expect(text).toContain('error   InvalidStateError "listing is not publishable"');
    expect(text).toContain('details {"status":"draft"}');
    expect(text).not.toContain('"a":1');
  });

  it('prints stored events verbatim with full', () => {
    write('p2', publishHttp, 0);
    expect(formatRun(stored('p2'), now(), { full: true })).toContain('"a":1');
  });
});

describe('doctor', () => {
  it('explains a missing marker and a missing directory', () => {
    const missing = doctor(path.join(dir, 'absent'));
    expect(missing.ok).toBe(false);
    expect(missing.lines.join('\n')).toContain('start the app in development');
    const result = doctor(dir);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('no marker');
  });

  it('confirms the marker belongs to the running app', () => {
    clock = new Date();
    rec.start({ nodeEnv: 'development' });
    expect(doctor(dir, { uptimeSeconds: 1 }).ok).toBe(true);
    const stale = doctor(dir, { uptimeSeconds: 100_000 });
    expect(stale.ok).toBe(false);
    expect(stale.lines.join('\n')).toContain('did not write this marker');
    const unreachable = doctor(dir);
    expect(unreachable.ok).toBe(false);
    expect(unreachable.lines.join('\n')).toContain('could not be reached');
  });
});

describe('followIndex', () => {
  const run = async (failed: boolean): Promise<string[]> => {
    const lines: string[] = [];
    const controller = new AbortController();
    write(
      'pre',
      [
        { type: 'run.start', kind: 'http', method: 'GET', path: '/x' },
        { type: 'http.end', method: 'GET', route: '/x', status: 200, durationMs: 1 },
      ],
      0
    );
    const done = followIndex(dir, (l) => lines.push(l), { failed, signal: controller.signal });
    write(
      'n-ok',
      [
        { type: 'run.start', kind: 'http', method: 'GET', path: '/y' },
        { type: 'http.end', method: 'GET', route: '/y', status: 200, durationMs: 1 },
      ],
      100
    );
    write(
      'n-fail',
      [
        { type: 'run.start', kind: 'http', method: 'GET', path: '/z' },
        { type: 'http.end', method: 'GET', route: '/z', status: 500, durationMs: 1 },
      ],
      200
    );
    await new Promise((r) => setTimeout(r, 700));
    controller.abort();
    await done;
    return lines;
  };

  it('delivers appended lines only, not existing content', async () => {
    const lines = await run(false);
    expect(lines.map((l) => l.split(' ')[0])).toEqual(['RUN-OK', 'RUN-FAIL']);
  });

  it('honours --failed', async () => {
    const lines = await run(true);
    expect(lines.map((l) => l.split(' ')[0])).toEqual(['RUN-FAIL']);
  });
});
