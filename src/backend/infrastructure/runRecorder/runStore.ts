import fs from 'fs';
import path from 'path';
import type { RunKind } from '../../application/ports/IRunRecorder';

export type RunOutcome = 'ok' | 'blocked' | 'failed' | 'open' | 'stale';

export const STALE_AFTER_MS = 600_000;
export const FOLLOW_POLL_MS = 300;
const MARKER_TOLERANCE_MS = 60_000;
const LABEL_WIDTH = 8;
const MIN_PREFIX_LENGTH = 4;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface RunSummary {
  runId: string;
  outcome: RunOutcome;
  startedAt: string;
  kind: RunKind;
  title: string;
  links: { operationId?: string; listingId?: string; marketplaceKey?: string };
}

export interface StoredEvent {
  ts: string;
  seq: number;
  runId: string;
  type: string;
  [key: string]: unknown;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseLines(text: string): StoredEvent[] {
  const events: StoredEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed) && typeof parsed.type === 'string') {
        events.push(parsed as StoredEvent);
      }
    } catch {
      // a half-written line while the app is writing
    }
  }
  return events;
}

export function readRun(dir: string, runId: string): StoredEvent[] {
  if (!SAFE_RUN_ID.test(runId)) return [];
  try {
    return parseLines(fs.readFileSync(path.join(dir, runId, 'events.jsonl'), 'utf8'));
  } catch {
    return [];
  }
}

export function summarize(events: StoredEvent[], now: Date): RunSummary {
  const start = events.find((e) => e.type === 'run.start');
  const httpEnd = events.find((e) => e.type === 'http.end');
  const kind: RunKind =
    start?.kind === 'job' ||
    (!start && !httpEnd && events.some((e) => e.type.startsWith('queue.attempt')))
      ? 'job'
      : 'http';

  const links: RunSummary['links'] = {};
  for (const e of events) {
    if (e.type !== 'link') continue;
    for (const key of ['operationId', 'listingId', 'marketplaceKey'] as const) {
      const value = str(e[key]);
      if (value) links[key] = value;
    }
  }

  let title: string;
  if (kind === 'job') {
    const queue =
      str(start?.queue) ?? str(events.find((e) => e.type.startsWith('queue.attempt'))?.queue);
    title = `job ${queue ?? '-'}`;
  } else {
    const method = str(httpEnd?.method) ?? str(start?.method) ?? '-';
    const route = str(httpEnd?.route) ?? str(start?.path) ?? '-';
    title = `${method} ${route}`;
  }

  const queued = events.some((e) => e.type === 'queue.enqueued');
  const hasJob = queued || kind === 'job';
  const attemptEnds = events.filter((e) => e.type === 'queue.attempt.end');
  const finalFailed = attemptEnds.some(
    (e) => e.ok !== true && Number(e.attempt) >= (Number(e.maxAttempts) || 1)
  );
  const httpErrors = events.filter((e) => e.type === 'http.error');
  const status = typeof httpEnd?.status === 'number' ? httpEnd.status : undefined;

  let outcome: RunOutcome;
  if (
    finalFailed ||
    (status !== undefined && status >= 500) ||
    httpErrors.some((e) => e.expected === false)
  ) {
    outcome = 'failed';
  } else if (
    !hasJob &&
    (httpErrors.length > 0 || (status !== undefined && status >= 400 && httpEnd?.aborted !== true))
  ) {
    outcome = 'blocked';
  } else if (attemptEnds.some((e) => e.ok === true)) {
    outcome = 'ok';
  } else if (
    httpEnd &&
    status !== undefined &&
    status < 400 &&
    httpEnd.aborted !== true &&
    !queued
  ) {
    outcome = 'ok';
  } else {
    outcome = 'open';
  }

  const lastTs = Date.parse(events[events.length - 1]?.ts ?? '');
  if (outcome === 'open' && Number.isFinite(lastTs) && now.getTime() - lastTs > STALE_AFTER_MS) {
    outcome = 'stale';
  }

  return {
    runId: events[0]?.runId ?? '',
    outcome,
    startedAt: events[0]?.ts ?? '',
    kind,
    title,
    links,
  };
}

function runIds(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name))
    .filter((entry) => {
      try {
        return fs.lstatSync(path.join(dir, entry.name, 'events.jsonl')).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name);
}

function allSummaries(dir: string, now: Date): RunSummary[] {
  const summaries: RunSummary[] = [];
  for (const id of runIds(dir)) {
    const events = readRun(dir, id);
    if (events.length === 0) continue;
    summaries.push({ ...summarize(events, now), runId: id });
  }
  return summaries.sort((a, b) =>
    a.startedAt === b.startedAt ? (a.runId < b.runId ? 1 : -1) : a.startedAt < b.startedAt ? 1 : -1
  );
}

export function listRuns(
  dir: string,
  options: { failed?: boolean; sinceMs?: number; now: Date }
): RunSummary[] {
  const since = options.sinceMs === undefined ? undefined : options.now.getTime() - options.sinceMs;
  return allSummaries(dir, options.now).filter((run) => {
    if (options.failed && run.outcome !== 'failed' && run.outcome !== 'blocked') return false;
    return since === undefined || Date.parse(run.startedAt) >= since;
  });
}

export function resolveRun(dir: string, ref: string, now: Date): string | undefined {
  const runs = allSummaries(dir, now);
  if (ref === 'last') return runs[0]?.runId;
  const exact = runs.find((run) => run.runId === ref);
  if (exact) return exact.runId;
  const prefixable = ref.length >= MIN_PREFIX_LENGTH;
  const prefixed = prefixable ? runs.filter((run) => run.runId.startsWith(ref)) : [];
  if (prefixed.length === 1) return prefixed[0].runId;
  if (prefixed.length > 1) return undefined;
  const byOperation = runs.find((run) => run.links.operationId === ref);
  if (byOperation) return byOperation.runId;
  if (!prefixable) return undefined;
  const matches = runs.filter((run) => run.links.operationId?.startsWith(ref));
  const distinct = new Set(matches.map((run) => run.links.operationId));
  return distinct.size === 1 ? matches[0].runId : undefined;
}

const TAGS: Record<RunOutcome, string> = {
  ok: 'RUN-OK',
  blocked: 'RUN-BLOCKED',
  failed: 'RUN-FAIL',
  open: 'RUN-OPEN',
  stale: 'RUN-STALE',
};

const row = (label: string, text: string): string => `${label.padEnd(LABEL_WIDTH)}${text}`;

function errorLines(error: unknown): string[] {
  if (!isRecord(error)) return [];
  const code = str(error.code);
  const lines = [
    row(
      'error',
      `${str(error.name) ?? 'Error'}${code ? ` ${code}` : ''} "${str(error.message) ?? ''}"`
    ),
  ];
  const indent = ' '.repeat(LABEL_WIDTH);
  if (error.details !== undefined) lines.push(`${indent}details ${JSON.stringify(error.details)}`);
  if (error.pg !== undefined) lines.push(`${indent}pg ${JSON.stringify(error.pg)}`);
  const at = str(error.at);
  if (at) lines.push(row('at', at));
  return lines;
}

function jobRef(e: StoredEvent): string {
  const jobId = str(e.jobId);
  return `${str(e.queue) ?? '-'}${jobId ? `:${jobId}` : ''}`;
}

function eventLines(e: StoredEvent): string[] {
  switch (e.type) {
    case 'http.end':
      return [
        row(
          'http',
          `${String(e.method)} ${String(e.route)} ${String(e.status)} ${String(e.durationMs)}ms${e.aborted === true ? ' aborted' : ''}`
        ),
      ];
    case 'http.error':
      return errorLines(e.error);
    case 'link': {
      const parts = (['operationId', 'listingId', 'marketplaceKey'] as const)
        .filter((key) => str(e[key]))
        .map((key) => `${key}=${String(e[key])}`);
      return [row('link', parts.join(' '))];
    }
    case 'queue.enqueued':
      return [row('queue', `${jobRef(e)} enqueued`)];
    case 'queue.attempt.start':
      return [
        row('queue', `${jobRef(e)} attempt ${String(e.attempt)}/${String(e.maxAttempts)} started`),
      ];
    case 'queue.attempt.end':
      return [
        row(
          'queue',
          `${jobRef(e)} attempt ${String(e.attempt)}/${String(e.maxAttempts)} ${e.ok === true ? 'ok' : 'failed'} ${String(e.durationMs)}ms`
        ),
        ...errorLines(e.error),
      ];
    default:
      return [];
  }
}

export function formatRun(events: StoredEvent[], now: Date, options: { full?: boolean }): string {
  const summary = summarize(events, now);
  const op = summary.links.operationId ? ` op=${summary.links.operationId}` : '';
  const header = `${TAGS[summary.outcome]} ${summary.runId} ${summary.title}${op}`;
  const body = options.full
    ? events.map((e) => JSON.stringify(e))
    : events.flatMap((e) => eventLines(e));
  return [header, ...body].join('\n');
}

function readMarker(
  dir: string
): { pid?: number; startedAt?: string; nodeEnv?: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'recorder.json'), 'utf8'));
    return isRecord(parsed)
      ? (parsed as { pid?: number; startedAt?: string; nodeEnv?: string })
      : undefined;
  } catch {
    return undefined;
  }
}

export function doctor(
  dir: string,
  health?: { uptimeSeconds: number }
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  if (!fs.existsSync(dir)) {
    return {
      ok: false,
      lines: [
        `directory ${dir}: missing`,
        'start the app in development (NODE_ENV=development, RUN_RECORDER not off) to create it',
      ],
    };
  }
  let writable = true;
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  lines.push(`directory ${dir}: exists, ${writable ? 'writable' : 'not writable'}`);
  if (!writable) {
    ok = false;
    lines.push('sudo chown -R 1001:1001 .local/runs');
  }

  const marker = readMarker(dir);
  if (!marker) {
    ok = false;
    lines.push('no marker: the app has not started with the recorder on');
  } else {
    lines.push(
      `marker: startedAt=${marker.startedAt ?? '-'} pid=${marker.pid ?? '-'} nodeEnv=${marker.nodeEnv ?? '-'}`
    );
    if (!health) {
      ok = false;
      lines.push(
        'the running app could not be reached, so the marker could not be checked against it'
      );
    } else {
      const startedMs = Date.parse(marker.startedAt ?? '');
      const expected = Date.now() - health.uptimeSeconds * 1000;
      if (Number.isFinite(startedMs) && Math.abs(expected - startedMs) < MARKER_TOLERANCE_MS) {
        lines.push('marker belongs to the running app');
      } else {
        ok = false;
        lines.push(
          'the running app did not write this marker (recorder off, or a different directory)'
        );
      }
    }
  }
  lines.push(`runs: ${runIds(dir).length}`);
  return { ok, lines };
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function followIndex(
  dir: string,
  onLine: (line: string) => void,
  options: { failed?: boolean; signal: AbortSignal }
): Promise<void> {
  const file = path.join(dir, 'index.log');
  let position = fileSize(file);
  let pending = '';
  return new Promise<void>((resolve) => {
    const poll = (): void => {
      const size = fileSize(file);
      if (size < position) {
        position = 0;
        pending = '';
      }
      if (size > position) {
        let fd: number | undefined;
        try {
          fd = fs.openSync(file, 'r');
          const buffer = Buffer.alloc(size - position);
          const read = fs.readSync(fd, buffer, 0, buffer.length, position);
          position += read;
          pending += buffer.subarray(0, read).toString('utf8');
        } catch {
          // the file vanished between stat and read; retry on the next tick
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
        }
        const parts = pending.split('\n');
        pending = parts.pop() ?? '';
        for (const line of parts) {
          if (!line) continue;
          if (options.failed && !line.startsWith('RUN-FAIL') && !line.startsWith('RUN-BLOCKED')) {
            continue;
          }
          onLine(line);
        }
      }
    };
    const timer = setInterval(poll, FOLLOW_POLL_MS);
    const finish = (): void => {
      clearInterval(timer);
      poll();
      resolve();
    };
    if (options.signal.aborted) finish();
    else options.signal.addEventListener('abort', finish, { once: true });
  });
}
