import type { RunEvent } from '../../application/ports/IRunRecorder';

export type IndexTag = 'RUN-OK' | 'RUN-BLOCKED' | 'RUN-RETRY' | 'RUN-FAIL';

export interface RunFacts {
  method?: string;
  queued: boolean;
  expectedError: boolean;
  /** An http.error was recorded for the run. */
  errored?: boolean;
}

export function indexTagFor(event: RunEvent, facts: RunFacts): IndexTag | null {
  if (event.type === 'http.end') {
    if (event.aborted && !facts.errored) return null;
    if (event.status < 400) return facts.queued ? null : 'RUN-OK';
    if (event.status < 500 && !(facts.errored && !facts.expectedError)) return 'RUN-BLOCKED';
    return 'RUN-FAIL';
  }
  if (event.type === 'queue.attempt.end') {
    if (event.ok) return 'RUN-OK';
    return event.attempt < event.maxAttempts ? 'RUN-RETRY' : 'RUN-FAIL';
  }
  return null;
}

export function formatIndexLine(tag: IndexTag, runId: string, at: Date, summary: string): string {
  return `${tag} ${runId} ${at.toISOString()} ${summary}`;
}
