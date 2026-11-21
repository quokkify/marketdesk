import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RunKind } from '../ports/IRunRecorder';

export interface RunContext {
  runId: string;
  kind: RunKind;
  attempt?: number;
  /** The run is a safe-method request that is kept only if it ends with a 5xx. */
  lazy?: boolean;
}

const storage = new AsyncLocalStorage<RunContext>();

export function runInContext<T>(context: RunContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRun(): RunContext | undefined {
  return storage.getStore();
}

export function newRunId(): string {
  return randomUUID();
}
