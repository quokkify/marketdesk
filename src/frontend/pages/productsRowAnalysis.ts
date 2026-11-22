// Row-level Hermes analysis on the Products page: per-row state, its label, and the
// one-at-a-time runner behind "Analyze selected".
import { productHermesDisabledReason } from './ListingDetailsPage.js';

export type RowAnalysisState =
  | { status: 'running' }
  | { status: 'done'; count: number }
  | { status: 'reviewed' }
  | { status: 'error'; message: string };

const RATE_LIMITED = 429;

export function rowAnalysisLabel(state: RowAnalysisState | undefined): string | null {
  if (!state || state.status === 'running') return null;
  if (state.status === 'reviewed') return 'All reviewed';
  if (state.status === 'error') return state.message;
  return state.count > 0 ? `${state.count} to review` : 'No new suggestions';
}

export function stateAfterPendingChange(
  prev: RowAnalysisState | undefined,
  pending: number
): RowAnalysisState | undefined {
  if (prev?.status === 'running') return prev;
  if (pending > 0) return { status: 'done', count: pending };
  if (prev?.status === 'done' && prev.count > 0) return { status: 'reviewed' };
  return prev;
}

export function canStartRowAnalysis(
  state: RowAnalysisState | undefined,
  disabledReason: string | null
): boolean {
  return disabledReason === null && state?.status !== 'running';
}

export function rowAnalyzeDisabledReason(input: {
  settingsLoaded: boolean;
  listingSeoEnabled: boolean;
}): string | null {
  // Every row has a product, so only the workspace-level reasons can apply here.
  return productHermesDisabledReason({ ...input, productId: 'row' });
}

export function analysisErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

function isRateLimited(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && (err as { status?: unknown }).status === RATE_LIMITED
  );
}

export interface SequentialRunOptions {
  /** Ids to leave alone, e.g. rows whose analysis is already running. */
  skip?: (id: string) => boolean;
  /** Checked before each product; false stops the run (the page was left). */
  shouldContinue?: () => boolean;
}

export async function runSequentially(
  ids: readonly string[],
  run: (id: string) => Promise<number>,
  onState: (id: string, state: RowAnalysisState) => void,
  options: SequentialRunOptions = {}
): Promise<{ analyzed: number; notRun: string[] }> {
  let analyzed = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    if (options.shouldContinue && !options.shouldContinue()) {
      return { analyzed, notRun: ids.slice(index) };
    }
    if (options.skip?.(id)) continue;
    onState(id, { status: 'running' });
    try {
      const count = await run(id);
      onState(id, { status: 'done', count });
      analyzed += 1;
    } catch (err) {
      onState(id, { status: 'error', message: analysisErrorMessage(err) });
      if (isRateLimited(err)) return { analyzed, notRun: ids.slice(index) };
    }
  }
  return { analyzed, notRun: [] };
}
