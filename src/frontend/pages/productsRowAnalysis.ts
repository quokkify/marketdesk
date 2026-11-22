// Row-level Hermes analysis on the Products page: per-row state, its label, and the
// one-at-a-time runner behind "Analyze selected".
import type { ProductVerdictView } from '@shared/types';
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
  if (prev?.status === 'done' && prev.count === pending) return prev;
  if (pending > 0) return { status: 'done', count: pending };
  if (prev?.status === 'done' && prev.count > 0) return { status: 'reviewed' };
  return prev;
}

// The server's pending count survives reloads; a running, failed or just-reviewed row in this
// session is more recent and wins.
export function analysisStateFor(
  session: RowAnalysisState | undefined,
  pending: number | undefined
): RowAnalysisState | undefined {
  if (session?.status === 'running' || session?.status === 'error') return session;
  if (pending !== undefined && pending > 0) return { status: 'done', count: pending };
  return session;
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

export const VERDICT_RUN_POLL_MS = 3000;
const VERDICT_RUN_MAX_POLLS = 200;

export interface AwaitVerdictRunOptions {
  intervalMs?: number;
  /** Checked before each read; false stops waiting (the page was left). */
  shouldContinue?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

// A run ends in the background. Reads the product's verdict until no run is active, then says
// whether the last run failed. `stopped` means the caller left before the run ended.
export async function awaitVerdictRun(
  readView: () => Promise<ProductVerdictView>,
  options: AwaitVerdictRunOptions = {}
): Promise<'completed' | 'failed' | 'stopped'> {
  const { intervalMs = VERDICT_RUN_POLL_MS, shouldContinue, sleep = defaultSleep } = options;
  for (let poll = 0; poll < VERDICT_RUN_MAX_POLLS; poll += 1) {
    if (shouldContinue && !shouldContinue()) return 'stopped';
    const view = await readView();
    if (!view.active) return view.lastFailed ? 'failed' : 'completed';
    await sleep(intervalMs);
  }
  throw new Error('The analysis is taking too long. Check the product again later.');
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
