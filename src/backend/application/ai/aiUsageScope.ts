// Attribution of AI calls, modelled on runs/runContext.ts. withAiUsageScope marks one analysis
// (workspace, feature, product) and collects the records of every call made inside it, also from
// calls running in parallel; withAiOperation names the provider method a call belongs to.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { AiCostStatus, AiUsageSummary } from '../../../shared/types';
import { currentRun } from '../runs/runContext';
import type { AiCallRecord, AiUsageSink } from './AiCallRecord';

export interface AiUsageAttribution {
  workspaceId: string;
  feature: string;
  productId?: string;
}

interface AiUsageScope extends AiUsageAttribution {
  analysisId: string;
  // Shared by every nested context of the scope, so parallel calls land in one list.
  records: AiCallRecord[];
}

interface AiUsageContext {
  scope?: AiUsageScope;
  operation?: string;
}

const UNNAMED_OPERATION = 'complete';

const storage = new AsyncLocalStorage<AiUsageContext>();

export type AiCallMeasurement = Omit<
  AiCallRecord,
  'workspaceId' | 'analysisId' | 'feature' | 'productId' | 'operation' | 'runId' | 'createdAt'
>;

export async function withAiUsageScope<T>(
  attribution: AiUsageAttribution,
  fn: () => Promise<T>,
): Promise<{ value: T; usage: AiUsageSummary }> {
  const scope: AiUsageScope = { ...attribution, analysisId: randomUUID(), records: [] };
  const value = await storage.run({ scope }, fn);
  return { value, usage: summarizeAiUsage(scope.records) };
}

export function withAiOperation<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ...storage.getStore(), operation }, fn);
}

export function inAiUsageScope(): boolean {
  return storage.getStore()?.scope !== undefined;
}

// Completes a measured call with the current attribution, adds it to the open scope and hands it
// to the sink.
export function recordAiCall(sink: AiUsageSink | undefined, call: AiCallMeasurement): void {
  // Recording must never fail the AI call it describes: a throw here would turn a good answer
  // into a failed analysis, or replace a 503 with a generic error.
  try {
    const context = storage.getStore();
    const scope = context?.scope;
    const runId = currentRun()?.runId;
    const record: AiCallRecord = {
      ...(scope
        ? {
            workspaceId: scope.workspaceId,
            analysisId: scope.analysisId,
            feature: scope.feature,
            ...(scope.productId ? { productId: scope.productId } : {}),
          }
        : {}),
      operation: context?.operation ?? UNNAMED_OPERATION,
      ...call,
      ...(runId ? { runId } : {}),
      createdAt: new Date(),
    };
    scope?.records.push(record);
    sink?.record(record);
  } catch (error) {
    reportRecordingFailure(sink, error);
  }
}

// The sink's own logger names the failure; without one there is nowhere to report it, and the
// AI call must still go on.
function reportRecordingFailure(sink: AiUsageSink | undefined, error: unknown): void {
  try {
    sink?.reportFailure?.(error);
  } catch {
    // Reporting failed as well; nothing else can carry it without risking the AI call.
  }
}

function sumTokens(records: AiCallRecord[], key: 'promptTokens' | 'completionTokens' | 'totalTokens'): number | null {
  let sum = 0;
  for (const record of records) {
    const value = record[key];
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

export function summarizeAiUsage(records: AiCallRecord[]): AiUsageSummary {
  const hermes = records.filter((r) => r.provider === 'hermes');
  if (hermes.length === 0) {
    return {
      provider: records.length > 0 ? 'offline' : 'none',
      calls: records.length,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costStatus: 'not_applicable',
    };
  }
  const costStatus: AiCostStatus = hermes.every((r) => r.costStatus === 'included')
    ? 'included'
    : 'unknown';
  return {
    provider: 'hermes',
    calls: records.length,
    promptTokens: sumTokens(hermes, 'promptTokens'),
    completionTokens: sumTokens(hermes, 'completionTokens'),
    totalTokens: sumTokens(hermes, 'totalTokens'),
    costStatus,
  };
}
