// Application-level port for the publish run recorder. Every API request and queue
// job runs under one run id; events recorded against it must already be sanitized.

export type RunKind = 'http' | 'job';

export interface ErrorInfo {
  name: string;
  message: string;
  /** DomainError code or MarketplaceError code. */
  code?: string;
  /** DomainError.details. */
  details?: Record<string, unknown>;
  pg?: { code: string; constraint: string | null; table: string | null };
  /** First application stack frame, "path:line". */
  at?: string;
}

export type RunEvent =
  | { type: 'run.start'; kind: RunKind; method?: string; path?: string; queue?: string }
  | {
      type: 'http.end';
      method: string;
      route: string;
      status: number;
      durationMs: number;
      aborted?: boolean;
    }
  | { type: 'http.error'; status: number; expected: boolean; error: ErrorInfo }
  | { type: 'link'; operationId?: string; listingId?: string; marketplaceKey?: string }
  | { type: 'queue.enqueued'; queue: string; jobId?: string; data: unknown }
  | {
      type: 'queue.attempt.start';
      queue: string;
      jobId?: string;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: 'queue.attempt.end';
      queue: string;
      jobId?: string;
      attempt: number;
      maxAttempts: number;
      ok: boolean;
      durationMs: number;
      error?: ErrorInfo;
    };

export interface RecordOptions {
  lazy?: boolean;
}

export interface IRunRecorder {
  readonly enabled: boolean;
  record(runId: string, event: RunEvent, options?: RecordOptions): void;
  /** Drop lazily held events of a run. */
  discard(runId: string): void;
}

export const noopRunRecorder: IRunRecorder = {
  enabled: false,
  record: () => undefined,
  discard: () => undefined,
};
