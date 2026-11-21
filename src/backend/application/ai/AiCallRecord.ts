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

// Fire-and-forget: implementations never throw, so recording cannot fail an AI call.
export interface AiUsageSink {
  record(r: AiCallRecord): void;
}

export interface AiUsageLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const AI_CALL_MESSAGE = 'AI call';
const UNATTRIBUTED_MESSAGE = 'unattributed AI call';

// One line per call. A call outside any usage scope is still logged, as a warning that names it.
export function loggingAiUsageSink(logger: AiUsageLogger): AiUsageSink {
  return {
    record(r) {
      const line = { ai: r };
      if (!r.workspaceId) logger.warn(line, UNATTRIBUTED_MESSAGE);
      else if (r.outcome !== 'ok') logger.warn(line, AI_CALL_MESSAGE);
      else logger.info(line, AI_CALL_MESSAGE);
    },
  };
}
