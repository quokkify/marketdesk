import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileRunRecorder, MAX_RUNS } from '../FileRunRecorder';
import { SecretRegistry } from '../SecretRegistry';
import { MAX_LINE_BYTES } from '../sanitize';

let dir: string;
let registry: SecretRegistry;
let rec: FileRunRecorder;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  registry = new SecretRegistry();
  rec = new FileRunRecorder({ dir, registry });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const readLines = (d: string, runId: string): Array<Record<string, unknown>> =>
  fs
    .readFileSync(path.join(d, runId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

const readIndex = (d: string): string[] =>
  fs.existsSync(path.join(d, 'index.log'))
    ? fs.readFileSync(path.join(d, 'index.log'), 'utf8').split('\n').filter(Boolean)
    : [];

describe('FileRunRecorder', () => {
  it('appends one JSON line per event with ts, seq and runId', () => {
    rec.record('r1', { type: 'run.start', kind: 'http', method: 'POST', path: '/api/x' });
    rec.record('r1', {
      type: 'http.end',
      method: 'POST',
      route: '/api/x',
      status: 200,
      durationMs: 3,
    });
    const lines = readLines(dir, 'r1');
    expect(lines.map((l) => [l.seq, l.type, l.runId])).toEqual([
      [1, 'run.start', 'r1'],
      [2, 'http.end', 'r1'],
    ]);
    expect(readIndex(dir)).toEqual([expect.stringMatching(/^RUN-OK r1 .* POST \/api\/x 200$/)]);
  });

  it('holds lazy events until a non-lazy one arrives, and drops them on discard', () => {
    rec.record('g1', { type: 'run.start', kind: 'http', method: 'GET' }, { lazy: true });
    rec.discard('g1');
    expect(fs.existsSync(path.join(dir, 'g1'))).toBe(false);
    rec.record('g2', { type: 'run.start', kind: 'http', method: 'GET' }, { lazy: true });
    rec.record('g2', {
      type: 'http.end',
      method: 'GET',
      route: '/api/y',
      status: 500,
      durationMs: 1,
    });
    expect(readLines(dir, 'g2').map((l) => l.type)).toEqual(['run.start', 'http.end']);
    expect(readLines(dir, 'g2').map((l) => l.seq)).toEqual([1, 2]);
  });

  it('writes a lazy event at once for a run that has already written, and discard then keeps the run', () => {
    rec.record('g3', { type: 'run.start', kind: 'http', method: 'GET' }, { lazy: true });
    rec.record('g3', { type: 'queue.enqueued', queue: 'q', data: {} });
    rec.record(
      'g3',
      { type: 'http.end', method: 'GET', route: '/api/z', status: 200, durationMs: 1 },
      { lazy: true }
    );
    rec.discard('g3');
    expect(readLines(dir, 'g3').map((l) => l.type)).toEqual([
      'run.start',
      'queue.enqueued',
      'http.end',
    ]);
  });

  it('writes no index line for a successful request that queued a job, then RUN-RETRY and one RUN-FAIL', () => {
    rec.record('r2', { type: 'run.start', kind: 'http', method: 'POST' });
    rec.record('r2', {
      type: 'queue.enqueued',
      queue: 'publish-listing',
      jobId: 'publish:op1',
      data: {},
    });
    rec.record('r2', {
      type: 'http.end',
      method: 'POST',
      route: '/api/l/:id/publish',
      status: 202,
      durationMs: 9,
    });
    const end = (attempt: number) => ({
      type: 'queue.attempt.end' as const,
      queue: 'publish-listing',
      jobId: 'publish:op1',
      attempt,
      maxAttempts: 3,
      ok: false,
      durationMs: 1,
      error: { name: 'E', message: 'm' },
    });
    rec.record('r2', end(1));
    rec.record('r2', end(2));
    rec.record('r2', end(3));
    expect(readIndex(dir).map((l) => l.split(' ')[0])).toEqual([
      'RUN-RETRY',
      'RUN-RETRY',
      'RUN-FAIL',
    ]);
    expect(readIndex(dir)[2]).toMatch(/publish-listing publish:op1 attempt 3\/3 E$/);
  });

  it('classifies an expected 4xx as RUN-BLOCKED and writes nothing for an aborted request', () => {
    rec.record('b1', { type: 'run.start', kind: 'http', method: 'POST' });
    rec.record('b1', {
      type: 'http.error',
      status: 409,
      expected: true,
      error: { name: 'Conflict', message: 'm' },
    });
    rec.record('b1', {
      type: 'http.end',
      method: 'POST',
      route: '/api/b',
      status: 409,
      durationMs: 1,
    });
    rec.record('b2', {
      type: 'http.end',
      method: 'GET',
      route: '/api/b',
      status: 499,
      durationMs: 1,
      aborted: true,
    });
    expect(readIndex(dir).map((l) => l.split(' ')[0])).toEqual(['RUN-BLOCKED']);
  });

  it('never writes a registered secret', () => {
    registry.register('canary-secret-0001', 'ENV:CANARY');
    rec.record('r3', {
      type: 'queue.enqueued',
      queue: 'q',
      data: { note: 'canary-secret-0001', access_token: 'canary-secret-0001' },
    });
    expect(fs.readFileSync(path.join(dir, 'r3', 'events.jsonl'), 'utf8')).not.toContain(
      'canary-secret-0001'
    );
  });

  it('sanitizes the index summary too', () => {
    registry.register('canary-secret-0002', 'ENV:CANARY');
    rec.record('r5', {
      type: 'http.end',
      method: 'GET',
      route: '/api/canary-secret-0002',
      status: 200,
      durationMs: 1,
    });
    expect(readIndex(dir).join('\n')).not.toContain('canary-secret-0002');
  });

  it('writes an oversized event as one line within the byte cap', () => {
    rec.record('r4', {
      type: 'queue.enqueued',
      queue: 'q',
      data: { blob: 'z'.repeat(10 * 1024 * 1024) },
    });
    const raw = fs.readFileSync(path.join(dir, 'r4', 'events.jsonl'), 'utf8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(1);
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(MAX_LINE_BYTES + 1);
  });

  it('keeps an event with hundreds of large fields to one parseable line and keeps its identity fields', () => {
    const word = 'lorem ipsum dolor sit amet ';
    const data: Record<string, string> = {};
    for (let i = 0; i < 400; i++) data[`field${i}`] = `${i} ${word.repeat(200)}`.slice(0, 4000);
    rec.record('r6', { type: 'queue.enqueued', queue: 'q', data });
    const raw = fs.readFileSync(path.join(dir, 'r6', 'events.jsonl'), 'utf8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(1);
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(MAX_LINE_BYTES + 1);
    expect(JSON.parse(raw)).toMatchObject({ type: 'queue.enqueued', runId: 'r6', seq: 1 });
    expect(JSON.parse(raw)).toHaveProperty('ts');
  });

  it('swallows a write fault, reports it once, and keeps accepting calls', () => {
    const faults: unknown[] = [];
    const broken = new FileRunRecorder({
      dir: path.join(dir, 'file-not-dir'),
      onFault: (e) => faults.push(e),
    });
    fs.writeFileSync(path.join(dir, 'file-not-dir'), 'x');
    expect(() => {
      broken.record('a', { type: 'run.start', kind: 'http' });
      broken.record('b', { type: 'run.start', kind: 'http' });
    }).not.toThrow();
    expect(faults).toHaveLength(1);
  });

  it('refuses a run id that would leave the recorder directory', () => {
    const faults: unknown[] = [];
    const guarded = new FileRunRecorder({ dir, onFault: (e) => faults.push(e) });
    guarded.record('../escape', { type: 'run.start', kind: 'http' });
    expect(faults).toHaveLength(1);
    expect(fs.existsSync(path.join(path.dirname(dir), 'escape'))).toBe(false);
  });

  it('probe reports an unwritable directory with a reason', () => {
    fs.writeFileSync(path.join(dir, 'blocked'), 'x');
    expect(FileRunRecorder.probe(path.join(dir, 'blocked', 'runs'))).toEqual({
      ok: false,
      reason: expect.any(String),
    });
  });

  it('probe succeeds for a missing directory and leaves no probe file', () => {
    const target = path.join(dir, 'nested', 'runs');
    expect(FileRunRecorder.probe(target)).toEqual({ ok: true });
    expect(fs.readdirSync(target)).toEqual([]);
  });

  const makeRun = (name: string, withEvents = true) => {
    fs.mkdirSync(path.join(dir, name));
    if (withEvents) fs.writeFileSync(path.join(dir, name, 'events.jsonl'), '');
  };

  it('start writes the marker and keeps only the newest MAX_RUNS run directories', () => {
    for (let i = 0; i < MAX_RUNS + 5; i++) makeRun(`old-${String(i).padStart(4, '0')}`);
    rec.start({ nodeEnv: 'development' });
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('old-'))).toHaveLength(MAX_RUNS);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'recorder.json'), 'utf8'))).toMatchObject({
      pid: process.pid,
      nodeEnv: 'development',
    });
  });

  it('rotation never removes a directory without events.jsonl, nor index.log, recorder.json or a symlink', () => {
    for (let i = 0; i < MAX_RUNS + 5; i++) makeRun(`old-${String(i).padStart(4, '0')}`);
    makeRun('foreign', false);
    makeRun('also-foreign', false);
    fs.writeFileSync(path.join(dir, 'index.log'), 'RUN-OK x\n');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    fs.writeFileSync(path.join(outside, 'events.jsonl'), 'keep');
    fs.symlinkSync(outside, path.join(dir, 'link-run'));
    rec.start({ nodeEnv: 'development' });
    const names = fs.readdirSync(dir);
    expect(names).toEqual(
      expect.arrayContaining(['foreign', 'also-foreign', 'index.log', 'recorder.json', 'link-run'])
    );
    expect(names.filter((n) => n.startsWith('old-'))).toHaveLength(MAX_RUNS);
    expect(fs.readFileSync(path.join(outside, 'events.jsonl'), 'utf8')).toBe('keep');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('treats a run id that is a registered secret as unsafe and writes nothing', () => {
    registry.register('canary-runid-0003', 'ENV:CANARY');
    const faults: unknown[] = [];
    const guarded = new FileRunRecorder({ dir, registry, onFault: (e) => faults.push(e) });
    guarded.record('canary-runid-0003', {
      type: 'http.end',
      method: 'GET',
      route: '/x',
      status: 200,
      durationMs: 1,
    });
    expect(faults).toHaveLength(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('keeps a registered secret out of recorder.json', () => {
    registry.register('canary-env-0004', 'ENV:CANARY');
    rec.start({ nodeEnv: 'canary-env-0004' });
    expect(fs.readFileSync(path.join(dir, 'recorder.json'), 'utf8')).not.toContain(
      'canary-env-0004'
    );
  });

  describe('a run that queued a job closes once, whichever of http.end and the final attempt comes first', () => {
    const start = { type: 'run.start' as const, kind: 'http' as const, method: 'POST' };
    const queued = { type: 'queue.enqueued' as const, queue: 'q', jobId: 'j', data: {} };
    const httpEnd = {
      type: 'http.end' as const,
      method: 'POST',
      route: '/r',
      status: 202,
      durationMs: 1,
    };
    const attempt = (ok: boolean) => ({
      type: 'queue.attempt.end' as const,
      queue: 'q',
      jobId: 'j',
      attempt: 3,
      maxAttempts: 3,
      ok,
      durationMs: 1,
      ...(ok ? {} : { error: { name: 'E', message: 'm' } }),
    });

    it.each([
      [false, 'RUN-FAIL'],
      [true, 'RUN-OK'],
    ])('job first, ok=%s', (ok, tag) => {
      rec.record('j1', start);
      rec.record('j1', queued);
      rec.record('j1', attempt(ok));
      rec.record('j1', httpEnd);
      expect(readIndex(dir).map((l) => l.split(' ')[0])).toEqual([tag]);
    });

    it.each([
      [false, 'RUN-FAIL'],
      [true, 'RUN-OK'],
    ])('http first, ok=%s', (ok, tag) => {
      rec.record('j2', start);
      rec.record('j2', queued);
      rec.record('j2', httpEnd);
      rec.record('j2', attempt(ok));
      expect(readIndex(dir).map((l) => l.split(' ')[0])).toEqual([tag]);
    });
  });

  it('keeps error codes and SQLSTATE in recorded events', () => {
    rec.record('r1', {
      type: 'http.error',
      status: 422,
      expected: true,
      error: { name: 'GuardrailViolationError', message: 'blocked', code: 'GUARDRAIL_VIOLATION' },
    });
    rec.record('r1', {
      type: 'queue.attempt.end',
      queue: 'q',
      jobId: 'j',
      attempt: 1,
      maxAttempts: 3,
      ok: false,
      durationMs: 1,
      error: {
        name: 'Error',
        message: 'dup',
        pg: { code: '23505', constraint: 'listings_pkey', table: 'listings' },
      },
    });
    const lines = readLines(dir, 'r1') as Array<{
      error: { code?: string; pg?: { code: string } };
    }>;
    expect(lines[0].error.code).toBe('GUARDRAIL_VIOLATION');
    expect(lines[1].error.pg?.code).toBe('23505');
  });

  it('keeps unwritten held events when a flush fails', () => {
    const faults: unknown[] = [];
    const flaky = new FileRunRecorder({ dir, registry, onFault: (e) => faults.push(e) });
    flaky.record('h1', { type: 'run.start', kind: 'http' }, { lazy: true });
    fs.writeFileSync(path.join(dir, 'h1'), 'blocker');
    flaky.record('h1', { type: 'link', listingId: 'l' });
    expect(faults).toHaveLength(1);
    fs.rmSync(path.join(dir, 'h1'));
    flaky.record('h1', { type: 'link', listingId: 'l' });
    expect(readLines(dir, 'h1').map((l) => l.type)).toEqual(['run.start', 'link']);
  });
});
