// Carries a run id across the job queue: stamps it on the job data at enqueue and
// re-opens the run in the worker. A recorder fault never reaches the job.

import type { IRunRecorder } from '../../application/ports/IRunRecorder';
import { describeError } from '../../application/runs/describeError';
import { ignoringFault } from '../../application/runs/ignoringFault';
import { currentRun, newRunId, runInContext } from '../../application/runs/runContext';

export const RUN_KEY = '__run';

const LINK_FIELDS = ['operationId', 'listingId', 'marketplaceKey'] as const;

export interface JobLike<T> {
  data: T;
  id?: string | number;
  attemptsMade: number;
  opts: { attempts?: number };
}

const SAFE_ID_CHARS = /[^A-Za-z0-9._-]/g;
const MAX_DERIVED_ID_LENGTH = 120;
const LONG_TOKEN = /[A-Za-z0-9_-]{40,}/;

// The recorder refuses ids it would redact as a long token, so a derived id never holds one.
function derivedJobRunId(queue: string, jobId: string): string | undefined {
  const clean = (part: string) => part.replace(SAFE_ID_CHARS, '-');
  const joined = `job-${clean(queue)}-${clean(jobId)}`.slice(0, MAX_DERIVED_ID_LENGTH);
  if (!LONG_TOKEN.test(joined)) return joined;
  const dotted = `job-${clean(queue)}.${clean(jobId)}`.slice(0, MAX_DERIVED_ID_LENGTH);
  return LONG_TOKEN.test(dotted) ? undefined : dotted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stampedRunId(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const { runId } = value;
  return typeof runId === 'string' && runId !== '' ? runId : undefined;
}

export function stampRun<T>(
  data: T,
  queue: string,
  jobId: string | undefined,
  recorder: IRunRecorder
): T {
  const run = currentRun();
  if (!recorder.enabled || !run || !isPlainObject(data)) return data;

  ignoringFault(() =>
    recorder.record(run.runId, { type: 'queue.enqueued', queue, jobId, data }, { lazy: false })
  );
  const link: Record<string, string> = {};
  for (const field of LINK_FIELDS) {
    const value = data[field];
    if (typeof value === 'string') link[field] = value;
  }
  if (Object.keys(link).length > 0) {
    ignoringFault(() => recorder.record(run.runId, { type: 'link', ...link }, { lazy: false }));
  }
  return { ...data, [RUN_KEY]: { runId: run.runId } } as T;
}

export function recordedProcessor<T>(
  queue: string,
  recorder: IRunRecorder,
  handler: (data: T) => Promise<unknown>
): (job: JobLike<T>) => Promise<unknown> {
  return async (job) => {
    let data = job.data;
    let stamp: unknown;
    if (isPlainObject(data) && RUN_KEY in data) {
      const { [RUN_KEY]: stampValue, ...rest } = data;
      stamp = stampValue;
      data = rest as T;
    }
    if (!recorder.enabled) return handler(data);

    const jobId = job.id === undefined ? undefined : String(job.id);
    let runId = stampedRunId(stamp);
    if (!runId) {
      const derived = jobId === undefined ? undefined : derivedJobRunId(queue, jobId);
      const fresh = derived ?? newRunId();
      runId = fresh;
      if (!derived || job.attemptsMade === 0) {
        ignoringFault(() => recorder.record(fresh, { type: 'run.start', kind: 'job', queue }));
      }
    }
    const id = runId;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const startedAt = Date.now();

    return runInContext({ runId: id, kind: 'job', attempt }, async () => {
      ignoringFault(() =>
        recorder.record(id, { type: 'queue.attempt.start', queue, jobId, attempt, maxAttempts })
      );
      const durationMs = () => Math.round(Date.now() - startedAt);
      try {
        const result = await handler(data);
        ignoringFault(() =>
          recorder.record(id, {
            type: 'queue.attempt.end',
            queue,
            jobId,
            attempt,
            maxAttempts,
            ok: true,
            durationMs: durationMs(),
          })
        );
        return result;
      } catch (error) {
        ignoringFault(() =>
          recorder.record(id, {
            type: 'queue.attempt.end',
            queue,
            jobId,
            attempt,
            maxAttempts,
            ok: false,
            durationMs: durationMs(),
            error: describeError(error),
          })
        );
        throw error;
      }
    });
  };
}
