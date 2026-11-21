# Publish Run Recorder, PR 1 (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `/api` request and every queue job runs under one run id, leaves a sanitized record in `.local/runs/`, and the agent reads it with `npm run runs -- doctor | list | show | tail`.

**Architecture:** An `AsyncLocalStorage` run context is opened by an Express middleware and re-opened in the queue worker from a reserved `__run` key on the job data. All events go through one application port, `IRunRecorder`; the file implementation accepts only values produced by one sanitizer. The read side is a small store module shared by Jest and a thin `tsx` script.

**Tech Stack:** Node 22, TypeScript (ESM), Express 5, Bull, pino, Jest with `@swc/jest`, `tsx`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-publish-run-recorder-design.md` (sections 5.1, 5.2 rows `http`, `queue`, `error`, 5.3, 5.4 without `fixture`, 5.5, 5.9). This plan covers pull request 1 of the five in spec section 6. Pull requests 2 to 5 get their own plans once this one is merged.

## Global Constraints

- No new dependencies. No SQL migration.
- The repository is public: no secret, token, OAuth code or `.env` value in a tracked file or in a record.
- With the recorder off, behaviour is unchanged: nothing is added to job data, no file is written.
- A recorder fault never fails or delays a request or a job. Every recorder call is wrapped; a fault is logged once and swallowed.
- The recorder is on only when `NODE_ENV` is `development` and `RUN_RECORDER` is not `off`. In `production` and in `test` the container wires the no-op recorder.
- Names fixed by the spec: `runId`, header `X-Run-Id`, reserved job key `__run`, directory `.local/runs/`, env `RUN_RECORDER` and `RUN_RECORDER_DIR`, index lines `RUN-OK`, `RUN-BLOCKED`, `RUN-RETRY`, `RUN-FAIL`, script `npm run runs`.
- The `upload-storage-init` Compose service and `scripts/verify-compose-upload-storage.mjs` are not changed.
- Import style: match the neighbouring file (`main.ts` and `config/` use `.js` suffixes, `presentation/http/app.ts` does not).
- Run one Jest file with `npx jest <path> --forceExit`. `npm run type-check` skips `*.test.*`.
- Conventional Commits. Commit on `feat/publish-run-recorder`; do not push.

## Review Focus

1. The recorder directory is not writable (Linux container UID 1001 on a root-owned bind mount): the app starts, the recorder is off, startup logs why. Pinned in Task 3 and Task 4.
2. Job data that is not a plain object (a string, an array, `null`): the queue wrapper adds no `__run`, passes the data through unchanged and does not throw. Pinned in Task 6.
3. A secret inside an error message, or one containing a quote or backslash: it is replaced, because the scan runs on decoded strings before serialization. Pinned in Task 2.
4. The client aborts the request (`close` without `finish`): the run still gets its `http.end` event, marked aborted, and is not left open. Pinned in Task 5.
5. An event larger than the cap (a 10 MB job payload): it is scanned first, capped after, and written as one line no longer than 64 KiB, so two processes appending to one file cannot interleave. Pinned in Task 2 and Task 3.

## File Structure

| File | Responsibility |
|---|---|
| `src/backend/application/ports/IRunRecorder.ts` (create) | Event types, the recorder port, the no-op recorder |
| `src/backend/application/runs/runContext.ts` (create) | The `AsyncLocalStorage` run context |
| `src/backend/application/runs/describeError.ts` (create) | Turn any thrown value into a recordable `ErrorInfo` |
| `src/backend/infrastructure/runRecorder/SecretRegistry.ts` (create) | Process-wide registry of secret values |
| `src/backend/infrastructure/runRecorder/sanitize.ts` (create) | The only producer of `Sanitized<T>` |
| `src/backend/infrastructure/runRecorder/indexLine.ts` (create) | Pure rule: which index line an event produces |
| `src/backend/infrastructure/runRecorder/FileRunRecorder.ts` (create) | Write side: events, index, lazy runs, rotation, marker |
| `src/backend/infrastructure/runRecorder/runStore.ts` (create) | Read side: list, read, derive outcome, format |
| `src/backend/config/runRecorder.ts` (create) | Resolve on/off and directory, build the recorder |
| `src/backend/config/di/recordedQueue.ts` (create) | `__run` stamping and the recorded job processor |
| `src/backend/presentation/http/middleware/RunContextMiddleware.ts` (create) | Open the run per request, record `http.end` |
| `scripts/runs.ts` (create) | Thin command line entry over `runStore` |
| `config/env.ts`, `config/di/container.ts`, `main.ts`, `presentation/http/app.ts`, `presentation/http/middleware/ErrorHandlingMiddleware.ts`, `infrastructure/security/AesGcmCredentialVault.ts`, `infrastructure/external/OlxOAuthClient.ts`, `docker-compose.yml`, `.env.example`, `package.json`, `docs/development.md` (modify) | Wiring |

---

### Task 1: Run context, recorder port, error description

**Files:**
- Create: `src/backend/application/ports/IRunRecorder.ts`
- Create: `src/backend/application/runs/runContext.ts`
- Create: `src/backend/application/runs/describeError.ts`
- Test: `src/backend/application/runs/__tests__/runContext.test.ts`, `src/backend/application/runs/__tests__/describeError.test.ts`

**Interfaces:**
- Produces:

```ts
// IRunRecorder.ts
export type RunKind = 'http' | 'job';
export interface ErrorInfo {
  name: string;
  message: string;
  code?: string;                       // DomainError code or MarketplaceError code
  details?: Record<string, unknown>;   // DomainError.details
  pg?: { code: string; constraint: string | null; table: string | null };
  at?: string;                         // first application stack frame, "path:line"
}
export type RunEvent =
  | { type: 'run.start'; kind: RunKind; method?: string; path?: string; queue?: string }
  | { type: 'http.end'; method: string; route: string; status: number; durationMs: number; aborted?: boolean }
  | { type: 'http.error'; status: number; expected: boolean; error: ErrorInfo }
  | { type: 'link'; operationId?: string; listingId?: string; marketplaceKey?: string }
  | { type: 'queue.enqueued'; queue: string; jobId?: string; data: unknown }
  | { type: 'queue.attempt.start'; queue: string; jobId?: string; attempt: number; maxAttempts: number }
  | { type: 'queue.attempt.end'; queue: string; jobId?: string; attempt: number; maxAttempts: number;
      ok: boolean; durationMs: number; error?: ErrorInfo };
export interface RecordOptions { lazy?: boolean }
export interface IRunRecorder {
  readonly enabled: boolean;
  record(runId: string, event: RunEvent, options?: RecordOptions): void;
  discard(runId: string): void;        // drop lazily held events of a run
}
export const noopRunRecorder: IRunRecorder;   // enabled: false, methods do nothing

// runContext.ts
export interface RunContext { runId: string; kind: RunKind; attempt?: number; lazy?: boolean }
// lazy: the run is a safe-method request that is kept only if it ends with a 5xx
export function runInContext<T>(context: RunContext, fn: () => T): T;
export function currentRun(): RunContext | undefined;
export function newRunId(): string;    // crypto.randomUUID()

// describeError.ts
export function describeError(error: unknown, cwd?: string): ErrorInfo;
```

- [ ] **Step 1: Write the failing tests**

```ts
// runContext.test.ts
it('keeps the run across awaits and isolates parallel runs', async () => {
  const seen: string[] = [];
  await Promise.all(['a', 'b'].map((runId) =>
    runInContext({ runId, kind: 'http' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(currentRun()!.runId);
    })));
  expect(seen.sort()).toEqual(['a', 'b']);
  expect(currentRun()).toBeUndefined();
});
it('the no-op recorder is disabled and never throws', () => {
  expect(noopRunRecorder.enabled).toBe(false);
  expect(() => noopRunRecorder.record('r', { type: 'run.start', kind: 'http' })).not.toThrow();
});

// describeError.test.ts
it('keeps DomainError code and details', () => {
  const info = describeError(new GuardrailViolationError('blocked', { categoryDecision: { allowed: false } }));
  expect(info).toMatchObject({ name: 'GuardrailViolationError', code: 'GUARDRAIL_VIOLATION',
    details: { categoryDecision: { allowed: false } } });
});
it('reads SQLSTATE, constraint and table from a pg error and never its detail', () => {
  const pgError = Object.assign(new Error('duplicate key'), {
    code: '23505', constraint: 'listings_pkey', table: 'listings', detail: 'Key (id)=(secret-row) exists' });
  const info = describeError(pgError);
  expect(info.pg).toEqual({ code: '23505', constraint: 'listings_pkey', table: 'listings' });
  expect(JSON.stringify(info)).not.toContain('secret-row');
});
it('reports the first application frame relative to cwd', () => {
  const error = new Error('x');
  error.stack = 'Error: x\n    at a (/repo/node_modules/lib/i.js:1:1)\n    at b (/repo/src/backend/x/Y.ts:42:7)';
  expect(describeError(error, '/repo').at).toBe('src/backend/x/Y.ts:42');
});
it('describes a non-Error value', () => {
  expect(describeError('boom')).toEqual({ name: 'NonError', message: 'boom' });
});
```

- [ ] **Step 2: Run them and confirm they fail** — `npx jest src/backend/application/runs --forceExit`, expected: cannot find module.
- [ ] **Step 3: Implement the three files.** `pg` is filled only when `code` is a five-character string and `constraint` or `table` is present. A frame counts as application code when its path contains `/src/backend/` or `/dist/backend/` and not `/node_modules/`.
- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Commit** — `feat(runs): add the run context and the recorder port`

---

### Task 2: Secret registry and sanitizer

**Files:**
- Create: `src/backend/infrastructure/runRecorder/SecretRegistry.ts`
- Create: `src/backend/infrastructure/runRecorder/sanitize.ts`
- Test: `src/backend/infrastructure/runRecorder/__tests__/sanitize.test.ts`

**Interfaces:**
- Produces:

```ts
// SecretRegistry.ts
export class SecretRegistry {
  register(value: string | undefined | null, label: string): void;  // ignores values shorter than 8 characters
  scrub(text: string): string;                                      // longest value first, replaces with `[${label}]`
}
export const secretRegistry: SecretRegistry;                        // the process-wide instance

// sanitize.ts
declare const sanitizedBrand: unique symbol;
export type Sanitized<T> = T & { readonly [sanitizedBrand]: true };
export const MAX_STRING_LENGTH = 4096;
export const MAX_LINE_BYTES = 65536;
export function sanitize<T>(value: T, registry?: SecretRegistry): Sanitized<T>;
export function serializeLine(value: Sanitized<unknown>): string;   // one JSON line, at most MAX_LINE_BYTES
```

Rules `sanitize` applies, in this order, on a deep copy (depth cap 8, cycles replaced with `"[Circular]"`, `Error` values converted with `describeError`):

1. A value whose key matches the denylist becomes `"[REDACTED:key]"`. The denylist, case-insensitive: the key contains `token`, `secret`, `password`, `authorization`, `cookie`, `refresh` or `credential`; or the key equals `code`, `state`, `client_id`, `key`, `api_key` or `apikey`. (`marketplaceKey` is kept.)
2. Every string value: `registry.scrub`, then `Bearer <anything>` to `Bearer [REDACTED]`, then a JWT (`eyJ…​.…​.…`) to `[REDACTED:jwt]`, then a run of 40 or more characters of `[A-Za-z0-9_-]` to `[REDACTED:token]`, then a URL query string to `?[REDACTED]` and URL userinfo to nothing.
3. Only then, a string longer than `MAX_STRING_LENGTH` is cut and suffixed with `…[truncated N chars]`.

`serializeLine` serializes; when the line exceeds `MAX_LINE_BYTES` it replaces the largest top-level field with `"[omitted: N bytes]"` until it fits.

- [ ] **Step 1: Write the failing tests**

```ts
const registry = () => { const r = new SecretRegistry(); r.register('s3cr3t-hermes-key', 'ENV:HERMES_API_KEY'); return r; };

it('replaces a registered secret with its label and keeps the event', () => {
  const out = sanitize({ message: 'call failed with s3cr3t-hermes-key in url' }, registry());
  expect(out.message).toBe('call failed with [ENV:HERMES_API_KEY] in url');
});
it('ignores registered values shorter than 8 characters', () => {
  const r = new SecretRegistry(); r.register('olx', 'ENV:X');
  expect(sanitize({ marketplaceKey: 'olx' }, r)).toEqual({ marketplaceKey: 'olx' });
});
it('redacts by key name and keeps marketplaceKey', () => {
  expect(sanitize({ access_token: 'abc', refreshToken: 'def', code: '123', state: 'zz', marketplaceKey: 'olx' }))
    .toEqual({ access_token: '[REDACTED:key]', refreshToken: '[REDACTED:key]', code: '[REDACTED:key]',
      state: '[REDACTED:key]', marketplaceKey: 'olx' });
});
it('redacts bearer values, JWTs, long tokens and URL queries inside free text', () => {
  const out = sanitize({ note: 'Authorization: Bearer abc.def and https://u:p@host/cb?code=42&x=1 and ' + 'A'.repeat(48) });
  expect(out.note).toBe('Authorization: Bearer [REDACTED] and https://host/cb?[REDACTED] and [REDACTED:token]');
});
// Review Focus 3
it('finds a secret that contains a quote and a backslash, inside an error message', () => {
  const r = new SecretRegistry(); r.register('pa"ss\\word-1', 'ENV:DB_PASSWORD');
  const line = serializeLine(sanitize({ error: new Error('auth failed for pa"ss\\word-1') }, r));
  expect(line).not.toContain('ss\\\\word');
  expect(line).toContain('[ENV:DB_PASSWORD]');
});
// Review Focus 5
it('scans before truncating, so a secret at the cut cannot survive', () => {
  const r = new SecretRegistry(); r.register('tail-secret-value', 'ENV:TAIL');
  const out = sanitize({ body: 'x'.repeat(MAX_STRING_LENGTH - 8) + 'tail-secret-value' }, r);
  expect(out.body).not.toContain('tail-sec');
});
it('keeps a line under the byte cap by omitting the largest field', () => {
  const line = serializeLine(sanitize({ type: 'queue.enqueued', data: { blob: Array(200).fill('y'.repeat(4000)) } }));
  expect(Buffer.byteLength(line)).toBeLessThanOrEqual(MAX_LINE_BYTES);
  expect(JSON.parse(line).type).toBe('queue.enqueued');
});
it('keeps an ordinary breaking field readable', () => {
  const body = { error: { validation: [{ field: 'attributes.state', title: 'Field is required' }] } };
  expect(sanitize(body)).toEqual(body);
});
it('survives cycles and deep nesting', () => {
  const a: Record<string, unknown> = {}; a.self = a;
  expect(sanitize(a)).toEqual({ self: '[Circular]' });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx jest src/backend/infrastructure/runRecorder/__tests__/sanitize.test.ts --forceExit`
- [ ] **Step 3: Implement `SecretRegistry.ts` and `sanitize.ts`** to the rules above.
- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Commit** — `feat(runs): add the secret registry and the sanitizer`

---

### Task 3: File recorder and index lines

**Files:**
- Create: `src/backend/infrastructure/runRecorder/indexLine.ts`
- Create: `src/backend/infrastructure/runRecorder/FileRunRecorder.ts`
- Test: `src/backend/infrastructure/runRecorder/__tests__/indexLine.test.ts`, `.../__tests__/FileRunRecorder.test.ts`

**Interfaces:**
- Consumes: `RunEvent`, `IRunRecorder` (Task 1); `sanitize`, `serializeLine`, `secretRegistry` (Task 2).
- Produces:

```ts
// indexLine.ts
export type IndexTag = 'RUN-OK' | 'RUN-BLOCKED' | 'RUN-RETRY' | 'RUN-FAIL';
export interface RunFacts { method?: string; queued: boolean; expectedError: boolean }
export function indexTagFor(event: RunEvent, facts: RunFacts): IndexTag | null;
export function formatIndexLine(tag: IndexTag, runId: string, at: Date, summary: string): string;
// `${tag} ${runId} ${at.toISOString()} ${summary}`

// FileRunRecorder.ts
export const MAX_RUNS = 200;
export interface FileRunRecorderOptions {
  dir: string;
  registry?: SecretRegistry;
  now?: () => Date;
  onFault?: (error: unknown) => void;   // called once per recorder instance
}
export class FileRunRecorder implements IRunRecorder {
  readonly enabled = true;
  constructor(options: FileRunRecorderOptions);
  static probe(dir: string): { ok: true } | { ok: false; reason: string };  // mkdir -p and a write test
  start(meta: { nodeEnv: string }): void;  // writes <dir>/recorder.json {pid, startedAt, nodeEnv}, rotates to MAX_RUNS
  record(runId: string, event: RunEvent, options?: RecordOptions): void;
  discard(runId: string): void;
}
```

On disk: `<dir>/<runId>/events.jsonl`, each line `{ ts, seq, runId, ...event }` written with one `appendFileSync`; `<dir>/index.log`; `<dir>/recorder.json`.

Index rules (`indexTagFor`):

| Event | Condition | Tag |
|---|---|---|
| `http.end` | status below 400, run queued no job | `RUN-OK` |
| `http.end` | status below 400, run queued a job | none (the job closes the run) |
| `http.end` | status 400 to 499 and the error was expected | `RUN-BLOCKED` |
| `http.end` | status 500 or above, or the error was not expected | `RUN-FAIL` |
| `queue.attempt.end` | `ok` | `RUN-OK` |
| `queue.attempt.end` | failed, `attempt < maxAttempts` | `RUN-RETRY` |
| `queue.attempt.end` | failed, `attempt >= maxAttempts` | `RUN-FAIL` |
| anything else | | none |

The recorder keeps `RunFacts` per run in memory (`queued` set by `queue.enqueued`, `expectedError` by `http.error`, `method` by `run.start`) and forgets a run when it writes that run's `http.end` or final `queue.attempt.end`.

Lazy events (`options.lazy`) are held in memory per run. The first non-lazy event for that run writes them first, in order. Once a run has written anything, a later lazy event for it is written immediately. `discard` drops held events and does nothing for a run that has already written. At most 500 runs are held; the oldest is dropped beyond that.

- [ ] **Step 1: Write the failing tests**

```ts
// indexLine.test.ts — one `it.each` row per line of the table above, plus:
it('formats a line a watcher can match with ^RUN-FAIL', () => {
  expect(formatIndexLine('RUN-FAIL', 'r1', new Date('2026-11-15T10:00:00Z'), 'publish-listing attempt 3/3 InvalidStateError'))
    .toBe('RUN-FAIL r1 2026-11-15T10:00:00.000Z publish-listing attempt 3/3 InvalidStateError');
});

// FileRunRecorder.test.ts — each test uses fs.mkdtempSync(os.tmpdir() + '/runs-')
it('appends one JSON line per event with ts, seq and runId', () => {
  rec.record('r1', { type: 'run.start', kind: 'http', method: 'POST', path: '/api/x' });
  rec.record('r1', { type: 'http.end', method: 'POST', route: '/api/x', status: 200, durationMs: 3 });
  const lines = readLines(dir, 'r1');
  expect(lines.map((l) => [l.seq, l.type, l.runId])).toEqual([[1, 'run.start', 'r1'], [2, 'http.end', 'r1']]);
  expect(readIndex(dir)).toEqual([expect.stringMatching(/^RUN-OK r1 /)]);
});
it('holds lazy events until a non-lazy one arrives, and drops them on discard', () => {
  rec.record('g1', { type: 'run.start', kind: 'http', method: 'GET' }, { lazy: true });
  rec.discard('g1');
  expect(fs.existsSync(path.join(dir, 'g1'))).toBe(false);
  rec.record('g2', { type: 'run.start', kind: 'http', method: 'GET' }, { lazy: true });
  rec.record('g2', { type: 'http.end', method: 'GET', route: '/api/y', status: 500, durationMs: 1 });
  expect(readLines(dir, 'g2').map((l) => l.type)).toEqual(['run.start', 'http.end']);
});
it('writes a lazy event at once for a run that has already written, and discard then keeps the run', () => {
  rec.record('g3', { type: 'run.start', kind: 'http', method: 'GET' }, { lazy: true });
  rec.record('g3', { type: 'queue.enqueued', queue: 'q', data: {} });
  rec.record('g3', { type: 'http.end', method: 'GET', route: '/api/z', status: 200, durationMs: 1 }, { lazy: true });
  rec.discard('g3');
  expect(readLines(dir, 'g3').map((l) => l.type)).toEqual(['run.start', 'queue.enqueued', 'http.end']);
});
it('writes no index line for a successful request that queued a job, then RUN-RETRY and one RUN-FAIL', () => {
  rec.record('r2', { type: 'run.start', kind: 'http', method: 'POST' });
  rec.record('r2', { type: 'queue.enqueued', queue: 'publish-listing', jobId: 'publish:op1', data: {} });
  rec.record('r2', { type: 'http.end', method: 'POST', route: '/api/l/:id/publish', status: 202, durationMs: 9 });
  const end = (attempt: number) => ({ type: 'queue.attempt.end' as const, queue: 'publish-listing', jobId: 'publish:op1',
    attempt, maxAttempts: 3, ok: false, durationMs: 1, error: { name: 'E', message: 'm' } });
  rec.record('r2', end(1)); rec.record('r2', end(2)); rec.record('r2', end(3));
  expect(readIndex(dir).map((l) => l.split(' ')[0])).toEqual(['RUN-RETRY', 'RUN-RETRY', 'RUN-FAIL']);
});
it('never writes a registered secret', () => {
  registry.register('canary-secret-0001', 'ENV:CANARY');
  rec.record('r3', { type: 'queue.enqueued', queue: 'q', data: { note: 'canary-secret-0001', access_token: 'canary-secret-0001' } });
  expect(fs.readFileSync(path.join(dir, 'r3', 'events.jsonl'), 'utf8')).not.toContain('canary-secret-0001');
});
// Review Focus 5
it('writes an oversized event as one line within the byte cap', () => {
  rec.record('r4', { type: 'queue.enqueued', queue: 'q', data: { blob: 'z'.repeat(10 * 1024 * 1024) } });
  const raw = fs.readFileSync(path.join(dir, 'r4', 'events.jsonl'), 'utf8');
  expect(raw.split('\n').filter(Boolean)).toHaveLength(1);
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(MAX_LINE_BYTES + 1);
});
// Review Focus 1
it('swallows a write fault, reports it once, and keeps accepting calls', () => {
  const faults: unknown[] = [];
  const broken = new FileRunRecorder({ dir: path.join(dir, 'file-not-dir'), onFault: (e) => faults.push(e) });
  fs.writeFileSync(path.join(dir, 'file-not-dir'), 'x');
  expect(() => { broken.record('a', { type: 'run.start', kind: 'http' }); broken.record('b', { type: 'run.start', kind: 'http' }); }).not.toThrow();
  expect(faults).toHaveLength(1);
});
it('probe reports an unwritable directory with a reason', () => {
  fs.writeFileSync(path.join(dir, 'blocked'), 'x');
  expect(FileRunRecorder.probe(path.join(dir, 'blocked', 'runs'))).toEqual({ ok: false, reason: expect.any(String) });
});
it('start writes the marker and keeps only the newest MAX_RUNS run directories', () => {
  for (let i = 0; i < MAX_RUNS + 5; i++) fs.mkdirSync(path.join(dir, `old-${String(i).padStart(4, '0')}`));
  rec.start({ nodeEnv: 'development' });
  expect(fs.readdirSync(dir).filter((n) => n.startsWith('old-'))).toHaveLength(MAX_RUNS);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'recorder.json'), 'utf8'))).toMatchObject({ pid: process.pid, nodeEnv: 'development' });
});
```

- [ ] **Step 2: Run and confirm failure** — `npx jest src/backend/infrastructure/runRecorder --forceExit`
- [ ] **Step 3: Implement `indexLine.ts`, then `FileRunRecorder.ts`.** Rotation orders run directories by modification time. The index summary is `<METHOD> <route> <status>` for `http.end` and `<queue> <jobId> attempt <n>/<max> <error name or "ok">` for `queue.attempt.end`.
- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Commit** — `feat(runs): add the file run recorder`

---

### Task 4: Configuration, wiring, secret registration

**Files:**
- Create: `src/backend/config/runRecorder.ts`
- Modify: `src/backend/config/env.ts` (add to the `env` object, near `logLevel`)
- Modify: `src/backend/config/di/container.ts` (`ContainerOverrides`, `buildContainer`, the returned `deps`)
- Modify: `src/backend/presentation/http/app.ts` (`AppDeps`)
- Modify: `src/backend/main.ts` (logger, `startupSensitiveValues`, startup line)
- Modify: `src/backend/infrastructure/security/AesGcmCredentialVault.ts` (`decrypt`, `decryptAppCredentials`)
- Modify: `src/backend/infrastructure/external/OlxOAuthClient.ts` (`requestTokens`)
- Test: `src/backend/config/__tests__/runRecorder.test.ts`; extend `src/backend/config/di/__tests__/container.test.ts`

**Interfaces:**
- Consumes: `FileRunRecorder`, `secretRegistry`, `noopRunRecorder`.
- Produces:

```ts
// env.ts
env.runRecorder: { mode: string /* RUN_RECORDER, default '' */; dir: string /* RUN_RECORDER_DIR, default './.local/runs' */ }

// config/runRecorder.ts
export type RunRecorderState =
  | { enabled: true; dir: string }
  | { enabled: false; reason: 'production' | 'test' | 'switched-off' | 'not-writable'; detail?: string };
export function resolveRunRecorder(
  e: { nodeEnv: string; runRecorder: { mode: string; dir: string } },
  probe?: (dir: string) => { ok: true } | { ok: false; reason: string },
): RunRecorderState;
export function createRunRecorder(state: RunRecorderState, onFault: (error: unknown) => void): IRunRecorder;
export function registerEnvSecrets(e: typeof env, registry?: SecretRegistry): void;

// container.ts
ContainerOverrides.runRecorder?: IRunRecorder;   // default: noopRunRecorder
AppDeps.runRecorder?: IRunRecorder;
```

`registerEnvSecrets` registers exactly the values `startupSensitiveValues` in `main.ts` lists today, each with the label `ENV:<VARIABLE_NAME>` (`ENV:DATABASE_URL`, `ENV:DB_PASSWORD`, `ENV:REDIS_URL`, `ENV:REDIS_PASSWORD`, `ENV:JWT_SECRET`, `ENV:JWT_REFRESH_SECRET`, `ENV:HERMES_API_KEY`, `ENV:HERMES_WEBHOOK_SECRET`, `ENV:OLX_CLIENT_SECRET`, `ENV:OLX_ACCESS_TOKEN`, `ENV:OLX_REFRESH_TOKEN`, `ENV:MARKETPLACE_CREDENTIALS_KEY`).

The vault registers `accessToken` and `refreshToken` (label `SECRET:olx-token`) and the app `clientSecret` (label `SECRET:olx-client-secret`) on every successful decrypt. `OlxOAuthClient.requestTokens` registers both tokens of a parsed response with the same labels.

- [ ] **Step 1: Write the failing tests**

```ts
// runRecorder.test.ts
const base = { runRecorder: { mode: '', dir: '/tmp/x' } };
const ok = () => ({ ok: true as const });
it.each([
  ['production', '', { enabled: false, reason: 'production' }],
  ['test', '', { enabled: false, reason: 'test' }],
  ['development', 'off', { enabled: false, reason: 'switched-off' }],
])('is off in %s with RUN_RECORDER=%s', (nodeEnv, mode, expected) => {
  expect(resolveRunRecorder({ nodeEnv, runRecorder: { mode, dir: '/tmp/x' } }, ok)).toEqual(expected);
});
it('is on in development and resolves the directory to an absolute path', () => {
  expect(resolveRunRecorder({ nodeEnv: 'development', ...base }, ok)).toEqual({ enabled: true, dir: '/tmp/x' });
});
it('is off in production even when the directory is set and writable', () => {
  expect(resolveRunRecorder({ nodeEnv: 'production', ...base }, ok).enabled).toBe(false);
});
// Review Focus 1
it('turns itself off when the directory is not writable, with the reason', () => {
  expect(resolveRunRecorder({ nodeEnv: 'development', ...base }, () => ({ ok: false, reason: 'EACCES' })))
    .toEqual({ enabled: false, reason: 'not-writable', detail: 'EACCES' });
});
it('createRunRecorder gives the no-op recorder when disabled', () => {
  expect(createRunRecorder({ enabled: false, reason: 'test' }, () => {})).toBe(noopRunRecorder);
});
it('registerEnvSecrets labels each secret by its variable name', () => {
  const r = new SecretRegistry();
  const hermesValue = ['hermes', 'value', 'for', 'test'].join('-');
  registerEnvSecrets({ ...env, hermes: { ...env.hermes, apiKey: hermesValue } } as typeof env, r);
  expect(r.scrub(`x ${hermesValue} y`)).toBe('x [ENV:HERMES_API_KEY] y');
});

// container.test.ts — add
it('exposes the injected run recorder on deps and defaults to the no-op', () => {
  const recorder: IRunRecorder = { enabled: true, record: jest.fn(), discard: jest.fn() };
  expect(buildContainer({ ...overrides, runRecorder: recorder }).deps.runRecorder).toBe(recorder);
  expect(buildContainer(overrides).deps.runRecorder).toBe(noopRunRecorder);
});

// AesGcmCredentialVault test file — add
it('registers decrypted tokens so they cannot be recorded', () => {
  const tokens = vault.decrypt(vault.encrypt({ accessToken: 'access-token-abcdef', refreshToken: 'refresh-token-abcdef', expiresAt }));
  expect(secretRegistry.scrub(`a ${tokens.accessToken} b ${tokens.refreshToken}`)).toBe('a [SECRET:olx-token] b [SECRET:olx-token]');
});
```

- [ ] **Step 2: Run and confirm failure** — `npx jest src/backend/config --forceExit`
- [ ] **Step 3: Implement `config/runRecorder.ts` and the `env.ts` field.** Default `probe` is `FileRunRecorder.probe`; `dir` is resolved against `process.cwd()`.
- [ ] **Step 4: Wire `container.ts` and `AppDeps`,** and add the two registration points in the vault and the OAuth client.
- [ ] **Step 5: Wire `main.ts`.** Before `resolveContainer()`: `registerEnvSecrets(env)`, `const state = resolveRunRecorder(env)`, build the recorder with `onFault` logging one `warn`, call `start({ nodeEnv: env.nodeEnv })` when enabled, pass it to `buildContainer({ logger, runRecorder })`. Log exactly one line: `logger.info({ runRecorder: state }, state.enabled ? 'Run recorder on' : 'Run recorder off')`. Add `mixin: () => { const run = currentRun(); return run ? { runId: run.runId } : {}; }` to the `pino` options.
- [ ] **Step 6: Run** `npx jest src/backend/config src/backend/infrastructure/security --forceExit` and `npm run type-check` — expected: PASS, no type errors.
- [ ] **Step 7: Commit** — `feat(runs): wire the run recorder into configuration and startup`

---

### Task 5: HTTP seam

**Files:**
- Create: `src/backend/presentation/http/middleware/RunContextMiddleware.ts`
- Modify: `src/backend/presentation/http/app.ts` (mount right after `express.urlencoded`, line 184; pass the recorder to `createErrorHandler`)
- Modify: `src/backend/presentation/http/middleware/ErrorHandlingMiddleware.ts`
- Test: `src/backend/presentation/http/__tests__/RunContextMiddleware.test.ts`; extend `ErrorHandlingMiddleware.test.ts`

**Interfaces:**
- Consumes: `runInContext`, `currentRun`, `newRunId`, `describeError`, `IRunRecorder`.
- Produces:

```ts
export function createRunContextMiddleware(recorder: IRunRecorder): RequestHandler;
export function createErrorHandler(logger?: ErrorLogger, recorder?: IRunRecorder): ErrorRequestHandler;
```

Behaviour of the middleware, for paths under `/api` only:

- A request is lazy when its method is `GET`, `HEAD` or `OPTIONS`.
- Opens a context `{ runId: newRunId(), kind: 'http', lazy }` around `next()` and sets `X-Run-Id` on the response, whether or not the recorder is enabled.
- Records `run.start` with `method` and the path without its query string, with `{ lazy }`.
- On `finish`: records `http.end` with `route` (`req.baseUrl + req.route.path` when a route matched, else the path without query), `status` and `durationMs`, with `{ lazy: lazy && status < 500 }`; then, for a lazy request with status below 500, calls `discard`. (A lazy run that already wrote something, for example because it queued a job, is kept by the recorder.)
- On `close` without a preceding `finish`: records `http.end` with `aborted: true` and status `499`.
- Never records a request body, headers or the query string.

Behaviour added to the error handler: before sending the response, when a run is active, record `http.error` with `status`, `expected` (`err instanceof DomainError && status < 500`), and `describeError(err)`, with `{ lazy: run.lazy === true && status < 500 }` so a refused `GET` does not materialize its run. Existing logging and the response body are unchanged.

- [ ] **Step 1: Write the failing tests** (use `supertest` over a minimal `express()` app with the middleware, one route per case, and a recording fake `{ enabled: true, record: jest.fn(), discard: jest.fn() }`)

```ts
it('sets X-Run-Id and records run.start and http.end with the route pattern for a POST', async () => {
  const res = await request(app).post('/api/listings/l_1/publish?token=abc').send({ password: 'p' });
  const runId = res.headers['x-run-id'];
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  expect(recorder.record.mock.calls.map(([id, e, o]) => [id, e.type, o?.lazy ?? false])).toEqual([
    [runId, 'run.start', false], [runId, 'http.end', false]]);
  const end = recorder.record.mock.calls[1][1];
  expect(end).toMatchObject({ route: '/api/listings/:id/publish', status: 202 });
  expect(JSON.stringify(recorder.record.mock.calls)).not.toMatch(/abc|password/);
});
it('makes the run id visible to the handler through currentRun()', async () => { /* handler returns currentRun()?.runId; equals the header */ });
it('discards a successful GET and a GET answered with 404', async () => {
  /* the app under test mounts createErrorHandler(undefined, recorder) and a 404 fallthrough like app.ts */
  await request(app).get('/api/products'); await request(app).get('/api/missing');
  expect(recorder.discard).toHaveBeenCalledTimes(2);
  expect(recorder.record.mock.calls.every(([, , o]) => o?.lazy)).toBe(true);
});
it('keeps a GET answered with 500', async () => { /* record called with http.end status 500, discard not called */ });
it('does not open a run outside /api', async () => { /* GET /health: no X-Run-Id header, recorder untouched */ });
it('still sets X-Run-Id when the recorder is the no-op', async () => { /* header present */ });
// Review Focus 4
it('records an aborted request as http.end with aborted and status 499', async () => {
  /* a route that never responds; destroy the client socket; await the recorder call */
  expect(end).toMatchObject({ type: 'http.end', aborted: true, status: 499 });
});
it('a throwing recorder does not change the response', async () => {
  recorder.record.mockImplementation(() => { throw new Error('disk full'); });
  expect((await request(app).post('/api/ok')).status).toBe(200);
});

// ErrorHandlingMiddleware.test.ts — add
it('records an expected DomainError 4xx with its code and details', async () => {
  /* route calls next(new GuardrailViolationError('blocked', { categoryDecision: { allowed: false } })) */
  expect(event).toMatchObject({ type: 'http.error', status: 422, expected: true,
    error: { code: 'GUARDRAIL_VIOLATION', details: { categoryDecision: { allowed: false } } } });
});
it('records an unexpected error as not expected', async () => {
  expect(event).toMatchObject({ type: 'http.error', status: 500, expected: false, error: { name: 'TypeError' } });
});
```

Use the status the existing `statusForError` returns for `GUARDRAIL_VIOLATION`; read it from `ResponseFormatter.ts` and put that number in the assertion.

- [ ] **Step 2: Run and confirm failure** — `npx jest src/backend/presentation/http/__tests__ --forceExit`
- [ ] **Step 3: Implement the middleware and the error handler change;** wrap every recorder call in the middleware and the handler in `try/catch` that ignores the fault.
- [ ] **Step 4: Mount in `app.ts`** with `deps.runRecorder ?? noopRunRecorder`.
- [ ] **Step 5: Run** the directory's tests and `npx jest src/backend/__tests__/e2e --forceExit` — expected: PASS (the e2e suites prove the middleware did not disturb existing routes).
- [ ] **Step 6: Commit** — `feat(runs): record HTTP requests and expected refusals`

---

### Task 6: Queue hop

**Files:**
- Create: `src/backend/config/di/recordedQueue.ts`
- Modify: `src/backend/config/di/container.ts` (`BullManagedQueue`: constructor takes the recorder; `enqueue`, `enqueueAll`, `registerHandler`; the default `createQueue`)
- Test: `src/backend/config/di/__tests__/recordedQueue.test.ts`

**Interfaces:**
- Consumes: `currentRun`, `runInContext`, `newRunId`, `describeError`, `IRunRecorder`.
- Produces:

```ts
export const RUN_KEY = '__run';
export function stampRun<T>(data: T, queue: string, jobId: string | undefined, recorder: IRunRecorder): T;
export interface JobLike<T> { data: T; id?: string | number; attemptsMade: number; opts: { attempts?: number } }
export function recordedProcessor<T>(
  queue: string, recorder: IRunRecorder, handler: (data: T) => Promise<unknown>,
): (job: JobLike<T>) => Promise<unknown>;
```

`stampRun`: returns `data` untouched unless the recorder is enabled, a run is active and `data` is a plain object. Otherwise returns a shallow copy with `__run: { runId }`, and records `queue.enqueued` (with the original data) and, when the data has string fields `operationId`, `listingId` or `marketplaceKey`, one `link` event.

`recordedProcessor`: takes `__run` off a plain-object payload and always hands the handler data without it. With the recorder disabled it only does that. Enabled: the run id is the stamped one, or a new one of kind `job` (then it records `run.start` with `kind: 'job'` and `queue` first). `attempt = attemptsMade + 1`, `maxAttempts = opts.attempts ?? 1`. It runs the handler inside `runInContext({ runId, kind: 'job', attempt })`, records `queue.attempt.start` before and `queue.attempt.end` after, and rethrows the handler's error unchanged.

`BullManagedQueue.scheduleRepeat` is not changed.

- [ ] **Step 1: Write the failing tests**

```ts
const fake = () => ({ enabled: true, record: jest.fn(), discard: jest.fn() });
it('adds nothing when the recorder is off', () => {
  const data = { listingId: 'l1' };
  expect(runInContext({ runId: 'r1', kind: 'http' }, () => stampRun(data, 'publish-listing', 'j1', noopRunRecorder))).toBe(data);
});
it('adds nothing when no run is active', () => {
  const data = { listingId: 'l1' };
  expect(stampRun(data, 'q', 'j1', fake())).toBe(data);
});
it('stamps the run id on a copy and records the enqueue and the links', () => {
  const rec = fake(); const data = { operationId: 'op1', listingId: 'l1', marketplaceKey: 'olx' };
  const out = runInContext({ runId: 'r1', kind: 'http' }, () => stampRun(data, 'publish-listing', 'publish:op1', rec));
  expect(out).toEqual({ ...data, __run: { runId: 'r1' } });
  expect(data).not.toHaveProperty('__run');
  expect(rec.record.mock.calls.map(([id, e]) => [id, e.type])).toEqual([['r1', 'queue.enqueued'], ['r1', 'link']]);
  expect(rec.record.mock.calls[0][1].data).toEqual(data);
});
// Review Focus 2
it.each([['a string'], [['an', 'array']], [null], [42]])('passes non-object data %p through untouched', async (data) => {
  const rec = fake();
  expect(runInContext({ runId: 'r1', kind: 'http' }, () => stampRun(data, 'q', 'j', rec))).toBe(data);
  const handler = jest.fn().mockResolvedValue('done');
  await recordedProcessor('q', rec, handler)({ data, attemptsMade: 0, opts: { attempts: 3 } });
  expect(handler).toHaveBeenCalledWith(data);
});
it('hands the handler data without __run and runs it inside the stamped run', async () => {
  const rec = fake(); let seen: unknown;
  const handler = jest.fn(async () => { seen = currentRun(); return 'ok'; });
  await recordedProcessor('publish-listing', rec, handler)(
    { data: { listingId: 'l1', __run: { runId: 'r1' } }, id: 'publish:op1', attemptsMade: 1, opts: { attempts: 3 } });
  expect(handler).toHaveBeenCalledWith({ listingId: 'l1' });
  expect(seen).toEqual({ runId: 'r1', kind: 'job', attempt: 2 });
  expect(rec.record.mock.calls.map(([, e]) => e.type)).toEqual(['queue.attempt.start', 'queue.attempt.end']);
  expect(rec.record.mock.calls[1][1]).toMatchObject({ attempt: 2, maxAttempts: 3, ok: true });
});
it('strips __run even when the recorder is off', async () => {
  const handler = jest.fn().mockResolvedValue(undefined);
  await recordedProcessor('q', noopRunRecorder, handler)({ data: { a: 1, __run: { runId: 'r1' } }, attemptsMade: 0, opts: {} });
  expect(handler).toHaveBeenCalledWith({ a: 1 });
});
it('starts a fresh job run for a legacy or repeat job', async () => {
  const rec = fake();
  await recordedProcessor('sync-marketplace', rec, async () => undefined)({ data: { a: 1 }, attemptsMade: 0, opts: { attempts: 3 } });
  expect(rec.record.mock.calls[0][1]).toEqual({ type: 'run.start', kind: 'job', queue: 'sync-marketplace' });
});
it('records the failure and rethrows the same error', async () => {
  const rec = fake(); const boom = new InvalidStateError('ambiguous');
  await expect(recordedProcessor('q', rec, async () => { throw boom; })(
    { data: { __run: { runId: 'r1' } }, attemptsMade: 2, opts: { attempts: 3 } })).rejects.toBe(boom);
  expect(rec.record.mock.calls.at(-1)![1]).toMatchObject({ type: 'queue.attempt.end', ok: false, attempt: 3, maxAttempts: 3,
    error: { name: 'InvalidStateError' } });
});
it('a throwing recorder does not fail the job', async () => {
  const rec = fake(); rec.record.mockImplementation(() => { throw new Error('disk'); });
  await expect(recordedProcessor('q', rec, async () => 'ok')({ data: {}, attemptsMade: 0, opts: {} })).resolves.toBe('ok');
});
```

- [ ] **Step 2: Run and confirm failure** — `npx jest src/backend/config/di/__tests__/recordedQueue.test.ts --forceExit`
- [ ] **Step 3: Implement `recordedQueue.ts`.**
- [ ] **Step 4: Use it in `BullManagedQueue`:** `enqueue` and each item of `enqueueAll` pass through `stampRun(data, this.name, options?.jobId, this.recorder)`; `registerHandler` becomes `this.queue.processAsync(recordedProcessor(this.name, this.recorder, handler))`. The default `createQueue` passes `overrides.runRecorder ?? noopRunRecorder`.
- [ ] **Step 5: Run** `npx jest src/backend/config/di src/backend/infrastructure/jobQueue --forceExit` and `npm run type-check` — expected: PASS.
- [ ] **Step 6: Commit** — `feat(runs): carry the run id across the job queue`

---

### Task 7: Read side and the `runs` command

**Files:**
- Create: `src/backend/infrastructure/runRecorder/runStore.ts`
- Create: `scripts/runs.ts`
- Modify: `package.json` (add `"runs": "node --import tsx scripts/runs.ts"`, the pattern `experiment:assistance` uses)
- Test: `src/backend/infrastructure/runRecorder/__tests__/runStore.test.ts`

**Interfaces:**
- Produces:

```ts
export type RunOutcome = 'ok' | 'blocked' | 'failed' | 'open' | 'stale';
export const STALE_AFTER_MS = 600_000;
export interface RunSummary {
  runId: string; outcome: RunOutcome; startedAt: string; kind: RunKind;
  title: string;                      // "POST /api/listings/:id/publish" or "job publish-listing"
  links: { operationId?: string; listingId?: string; marketplaceKey?: string };
}
export interface StoredEvent { ts: string; seq: number; runId: string; type: string; [key: string]: unknown }
export function readRun(dir: string, runId: string): StoredEvent[];           // skips a malformed trailing line
export function summarize(events: StoredEvent[], now: Date): RunSummary;
export function listRuns(dir: string, options: { failed?: boolean; sinceMs?: number; now: Date }): RunSummary[];  // newest first
export function resolveRun(dir: string, ref: string, now: Date): string | undefined;  // 'last', a runId, a runId prefix, or an operationId
export function formatRun(events: StoredEvent[], now: Date, options: { full?: boolean }): string;
export function doctor(dir: string, health?: { uptimeSeconds: number }): { ok: boolean; lines: string[] };
export function followIndex(dir: string, onLine: (line: string) => void, options: { failed?: boolean; signal: AbortSignal }): Promise<void>;
```

Outcome rules (`summarize`): a final failed `queue.attempt.end` or an `http.end` with status 500 or more, or an `http.error` with `expected: false`, gives `failed`; an `http.error` with `expected: true` and no job gives `blocked`; a successful `queue.attempt.end`, or a successful `http.end` with no `queue.enqueued`, gives `ok`; anything else is `open`, or `stale` when the last event is older than `STALE_AFTER_MS`. `failed` in a filter means `failed` or `blocked`.

`formatRun` prints a header line `<TAG> <runId> <title> [op=<operationId>]` (tag by outcome: `RUN-OK`, `RUN-BLOCKED`, `RUN-FAIL`, `RUN-OPEN`, `RUN-STALE`), then one line per event in the columns of the example in spec section 5.4 (`http`, `queue`, `error`, `at`), error details as indented JSON, and for a `failed` or `blocked` run nothing else. `--full` prints the stored events verbatim instead.

`doctor` lines: whether the directory exists and is writable; the marker's `startedAt`, `pid` and `nodeEnv`, or "no marker: the app has not started with the recorder on"; when `health` is given, whether the marker belongs to the running app (`|now - uptime - startedAt| < 60 s`); the number of runs; and when the directory is not writable the fix `sudo chown -R 1001:1001 .local/runs` (Linux Compose) on its own line.

`scripts/runs.ts`: parses `doctor | list | show <ref> | tail`, flags `--failed`, `--since <N>(m|h)`, `--full`, `--json`; resolves the directory from `RUN_RECORDER_DIR` or `<repository root>/.local/runs`; `doctor` fetches `http://127.0.0.1:${APP_PORT ?? 3000}/health` with a two-second timeout and tolerates failure; `--json` prints `RunSummary[]` for `list` and `{ summary, events }` for `show`; exit code 1 for an unknown command, an unresolved run, or a failing `doctor`.

- [ ] **Step 1: Write the failing tests** (build run directories with a real `FileRunRecorder` in a temp directory)

```ts
it('derives blocked for an expected 4xx without a job', () => { expect(summarize(events, now).outcome).toBe('blocked'); });
it('derives failed only after the last attempt, open before it', () => {
  expect(summarize(afterAttempt(2), now).outcome).toBe('open');
  expect(summarize(afterAttempt(3), now).outcome).toBe('failed');
});
it('derives ok for a completed job and for a request with no job', () => { /* both */ });
it('marks an unfinished run stale after ten minutes', () => {
  expect(summarize(openEvents, new Date(startedAt.getTime() + STALE_AFTER_MS + 1)).outcome).toBe('stale');
});
it('lists newest first and filters failed to failed plus blocked', () => {
  expect(listRuns(dir, { failed: true, now }).map((r) => r.outcome)).toEqual(['failed', 'blocked']);
});
it('resolves last, a prefix and an operation id', () => {
  expect(resolveRun(dir, 'last', now)).toBe(newestId);
  expect(resolveRun(dir, newestId.slice(0, 8), now)).toBe(newestId);
  expect(resolveRun(dir, 'op1', now)).toBe(publishRunId);
  expect(resolveRun(dir, 'nope', now)).toBeUndefined();
});
it('skips a half-written last line', () => {
  fs.appendFileSync(path.join(dir, runId, 'events.jsonl'), '{"ts":"2026');
  expect(readRun(dir, runId)).toHaveLength(2);
});
it('formats a failed publish run with the refusal on one line', () => {
  const text = formatRun(failedPublishEvents, now, {});
  expect(text.split('\n')[0]).toMatch(/^RUN-FAIL [0-9a-f-]+ POST \/api\/listings\/:id\/publish op=op1$/);
  expect(text).toContain('queue   publish:op1 attempt 3/3 failed');
  expect(text).toContain('InvalidStateError');
});
it('doctor explains a missing marker and an unwritable directory', () => {
  expect(doctor(path.join(dir, 'absent')).ok).toBe(false);
  expect(doctor(dir).lines.join('\n')).toContain('no marker');
});
it('doctor confirms the marker belongs to the running app', () => {
  rec.start({ nodeEnv: 'development' });
  expect(doctor(dir, { uptimeSeconds: 1 }).ok).toBe(true);
});
it('followIndex delivers appended lines and honours --failed', async () => {
  /* start following, append RUN-OK and RUN-FAIL lines through the recorder, abort; with failed:true only RUN-FAIL arrives */
});
```

- [ ] **Step 2: Run and confirm failure** — `npx jest src/backend/infrastructure/runRecorder/__tests__/runStore.test.ts --forceExit`
- [ ] **Step 3: Implement `runStore.ts`.** `followIndex` polls the file size every 300 ms and reads the new bytes.
- [ ] **Step 4: Implement `scripts/runs.ts` and add the `package.json` script.**
- [ ] **Step 5: Run the tests**, then check the command by hand: `RUN_RECORDER_DIR=$(mktemp -d) npm run runs -- doctor; echo "exit=$?"` — expected: the "no marker" line and `exit=1`; `npm run runs -- nonsense; echo "exit=$?"` — expected: usage text and `exit=1`.
- [ ] **Step 6: Commit** — `feat(runs): add the runs command`

---

### Task 8: Compose, documentation, full check

**Files:**
- Modify: `docker-compose.yml` (`app` service: `environment` and `volumes`)
- Modify: `.env.example`
- Modify: `docs/development.md` (new section after "Checks and scripts")
- Test: the existing `verify:compose-*` scripts

- [ ] **Step 1: Compose.** In the `app` service add `RUN_RECORDER: ${RUN_RECORDER:-}` and `RUN_RECORDER_DIR: /app/.local/runs` to `environment`, and `- ./.local/runs:/app/.local/runs` to `volumes`. Update the comment above `volumes` so it no longer says only uploads are persisted. Do not touch `upload-storage-init`.
- [ ] **Step 2: `.env.example`.** Add a commented block: `# RUN_RECORDER=off` with one line saying the recorder is on in development, writes to `.local/runs/` and is always off in production.
- [ ] **Step 3: Run** `npm run verify:compose-uploads && npm run verify:compose-db` — expected: both pass unchanged.
- [ ] **Step 4: Documentation.** Add "Reading a local run" to `docs/development.md`: what a run is; the four commands with one line each; the four index tags and what each means; `X-Run-Id` in the browser network tab; that the recorder is off in production and in tests; the Linux ownership note and `runs doctor`; that request bodies, headers and query strings are never recorded.
- [ ] **Step 5: Live check on the Compose stack (done by the controller, not the task implementer: the worktree has no `.env`).** `docker compose up -d --build`, then `npm run runs -- doctor` (expected: `ok`, marker belongs to the running app), then one refused call: `curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'content-type: application/json' -d '{"email":"nobody@example.test","password":"wrong-password-1"}' -D - | grep -i x-run-id`, then `npm run runs -- show last` (expected: a `RUN-BLOCKED` run for `POST /api/auth/login`), then `grep -rc "wrong-password-1" .local/runs` (expected: every count is 0). Record the outputs in the pull request description.
- [ ] **Step 6: Full check.** `npm run lint && npm run type-check && npm run test:ci && npm run build && npm run verify:spec` — expected: all pass. Scan the changed files for `TODO`, `.skip`, `.only` and stubbed branches: `git diff origin/main --name-only | xargs grep -n -E "TODO|\.skip\(|\.only\(|not implemented"` — expected: no output.
- [ ] **Step 7: Commit** — `feat(runs): mount the run records in Compose and document the commands`
