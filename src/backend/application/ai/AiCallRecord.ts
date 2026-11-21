import type { AiCostStatus } from '../../../shared/types';

// One AI call: who it was for, what it cost in tokens and how it ended. Never prompt or response text.
export interface AiCallRecord {
  workspaceId?: string;
  analysisId?: string;
  feature?: string;
  productId?: string;
  operation: string;
  provider: 'hermes' | 'offline';
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  outcome: 'ok' | 'unavailable' | 'rejected' | 'invalid_output';
  httpStatus: number | null;
  runId?: string;
  costStatus: AiCostStatus;
  createdAt: Date;
}

// Fire-and-forget: recordAiCall catches anything a sink throws, so recording cannot fail an AI call.
export interface AiUsageSink {
  record(r: AiCallRecord): void;
  // Told when a record could not be made or delivered.
  reportFailure?(error: unknown): void;
}

export interface AiUsageLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const AI_CALL_MESSAGE = 'AI call';
const RECORDING_FAILED_MESSAGE = 'AI usage could not be recorded';

// One line per call. A call outside any usage scope is still logged, as a warning marked unattributed.
export function loggingAiUsageSink(logger: AiUsageLogger): AiUsageSink {
  return {
    record(r) {
      if (!r.workspaceId) logger.warn({ ai: r, unattributed: true }, AI_CALL_MESSAGE);
      else if (r.outcome !== 'ok') logger.warn({ ai: r }, AI_CALL_MESSAGE);
      else logger.info({ ai: r }, AI_CALL_MESSAGE);
    },
    reportFailure(error) {
      logger.warn(
        { error: { message: error instanceof Error ? error.message : String(error) } },
        RECORDING_FAILED_MESSAGE,
      );
    },
  };
}

// Every sink gets every record; one that throws is reported and does not stop the others.
export function fanOutAiUsageSink(sinks: AiUsageSink[]): AiUsageSink {
  return {
    record(r) {
      for (const sink of sinks) {
        try {
          sink.record(r);
        } catch (error) {
          sinks.forEach((other) => {
            try {
              other.reportFailure?.(error);
            } catch {
              // Reporting failed as well; the remaining sinks still get the record.
            }
          });
        }
      }
    },
    reportFailure(error) {
      for (const sink of sinks) {
        try {
          sink.reportFailure?.(error);
        } catch {
          // One sink failing to report must not hide the failure from the others.
        }
      }
    },
  };
}

export interface AiUsageStore {
  insert(r: AiCallRecord & { workspaceId: string }): Promise<void>;
}

// Stores attributed calls without waiting for the database: a failed write is reported, never thrown.
// Unattributed calls have no workspace to belong to and are left to the logging sink.
export function storingAiUsageSink(store: AiUsageStore, onFailure: (error: unknown) => void): AiUsageSink {
  return {
    record(r) {
      const { workspaceId } = r;
      if (!workspaceId) return;
      store.insert({ ...r, workspaceId }).catch(onFailure);
    },
  };
}
