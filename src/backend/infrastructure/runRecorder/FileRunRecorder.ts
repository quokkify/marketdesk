import fs from 'fs';
import path from 'path';
import type { IRunRecorder, RecordOptions, RunEvent } from '../../application/ports/IRunRecorder';
import { formatIndexLine, indexTagFor, type RunFacts } from './indexLine';
import { SecretRegistry, secretRegistry } from './SecretRegistry';
import { sanitize, serializeLine, type Sanitized } from './sanitize';

export const MAX_RUNS = 200;
const MAX_TRACKED_RUNS = 500;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface FileRunRecorderOptions {
  dir: string;
  registry?: SecretRegistry;
  now?: () => Date;
  onFault?: (error: unknown) => void;
}

interface RunState {
  facts: RunFacts;
  isHttp: boolean;
  httpEnded: boolean;
  jobEnded: boolean;
}

interface HeldEvent {
  event: RunEvent;
  at: Date;
}

function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_TRACKED_RUNS) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export class FileRunRecorder implements IRunRecorder {
  readonly enabled = true;
  private readonly dir: string;
  private readonly registry: SecretRegistry;
  private readonly now: () => Date;
  private readonly onFault?: (error: unknown) => void;
  private faulted = false;
  private readonly held = new Map<string, HeldEvent[]>();
  private readonly seqs = new Map<string, number>();
  private readonly states = new Map<string, RunState>();

  constructor(options: FileRunRecorderOptions) {
    this.dir = options.dir;
    this.registry = options.registry ?? secretRegistry;
    this.now = options.now ?? (() => new Date());
    this.onFault = options.onFault;
  }

  static probe(dir: string): { ok: true } | { ok: false; reason: string } {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `.probe-${process.pid}`);
      fs.writeFileSync(file, 'ok');
      fs.rmSync(file, { force: true });
      return { ok: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      return {
        ok: false,
        reason: code ?? (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  start(meta: { nodeEnv: string }): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const marker = sanitize(
        { pid: process.pid, startedAt: this.now().toISOString(), nodeEnv: meta.nodeEnv },
        this.registry
      );
      fs.writeFileSync(path.join(this.dir, 'recorder.json'), JSON.stringify(marker));
      this.rotate();
    } catch (error) {
      this.fault(error);
    }
  }

  record(runId: string, event: RunEvent, options?: RecordOptions): void {
    try {
      const at = this.now();
      if (options?.lazy && !this.seqs.has(runId)) {
        const queue = this.held.get(runId) ?? [];
        queue.push({ event, at });
        setBounded(this.held, runId, queue);
        return;
      }
      const queue = this.held.get(runId);
      while (queue?.length) {
        this.write(runId, queue[0].event, queue[0].at);
        queue.shift();
      }
      this.held.delete(runId);
      this.write(runId, event, at);
    } catch (error) {
      this.fault(error);
    }
  }

  discard(runId: string): void {
    try {
      this.held.delete(runId);
    } catch (error) {
      this.fault(error);
    }
  }

  private write(runId: string, event: RunEvent, at: Date): void {
    if (!SAFE_RUN_ID.test(runId) || sanitize(runId, this.registry) !== runId) {
      throw new Error('unsafe run id');
    }
    const runDir = path.join(this.dir, runId);
    const seq = (this.seqs.get(runId) ?? 0) + 1;
    if (seq === 1) fs.mkdirSync(runDir, { recursive: true });
    const line = serializeLine({
      ts: at.toISOString(),
      seq,
      runId,
      ...sanitize(event, this.registry, { errorInfoKeys: ['error'] }),
    } as unknown as Sanitized<unknown>);
    fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${line}\n`);
    setBounded(this.seqs, runId, seq);
    this.index(runId, event, at);
  }

  private index(runId: string, event: RunEvent, at: Date): void {
    const state = this.states.get(runId) ?? {
      facts: { queued: false, expectedError: false },
      isHttp: false,
      httpEnded: false,
      jobEnded: false,
    };
    const { facts } = state;
    if (event.type === 'run.start') {
      facts.method = event.method;
      state.isHttp = event.kind === 'http';
    }
    if (event.type === 'queue.enqueued') facts.queued = true;
    if (event.type === 'http.error') {
      facts.errored = true;
      facts.expectedError = event.expected;
    }
    if (event.type === 'http.end') state.httpEnded = true;
    const terminalAttempt =
      event.type === 'queue.attempt.end' && (event.ok || event.attempt >= event.maxAttempts);
    if (terminalAttempt) state.jobEnded = true;
    setBounded(this.states, runId, state);

    const tag = indexTagFor(event, facts);
    const finished =
      state.isHttp || state.httpEnded
        ? state.httpEnded && (!facts.queued || state.jobEnded)
        : state.jobEnded;
    if (finished) this.states.delete(runId);
    if (!tag) return;

    const summary =
      event.type === 'http.end'
        ? `${event.method} ${event.route} ${event.status}`
        : event.type === 'queue.attempt.end'
          ? `${event.queue} ${event.jobId ?? '-'} attempt ${event.attempt}/${event.maxAttempts} ${event.error?.name ?? 'ok'}`
          : '';
    const entry = sanitize(formatIndexLine(tag, runId, at, summary), this.registry).replace(
      /\s+/g,
      ' '
    );
    fs.appendFileSync(path.join(this.dir, 'index.log'), `${entry}\n`);
  }

  private rotate(): void {
    const runs = fs
      .readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name))
      .filter((entry) => {
        try {
          return fs.lstatSync(path.join(this.dir, entry.name, 'events.jsonl')).isFile();
        } catch {
          return false;
        }
      })
      .map((entry) => ({
        name: entry.name,
        mtime: fs.statSync(path.join(this.dir, entry.name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
    for (const stale of runs.slice(MAX_RUNS)) {
      fs.rmSync(path.join(this.dir, stale.name), { recursive: true, force: true });
    }
  }

  private fault(error: unknown): void {
    if (this.faulted) return;
    this.faulted = true;
    try {
      this.onFault?.(error);
    } catch {
      // a failing fault handler must not break the caller
    }
  }
}
