// One list, newest first, of everything Hermes did for a product: market searches, analyses and suggestions.
import type {
  HermesEvent,
  HermesEventStatus,
  NodeStatus,
  ResearchNode,
  ResearchRun,
  SaleVerdict,
  VerdictCheckName,
  VerdictCheckStatus,
} from '@shared/types';
import { checkLabel, overallColor, overallLabel } from '../../products/verdictDisplay.js';
import { errorReason, verdictErrorReason } from '../priceResearchModel.js';

export type StepStatus = 'ok' | 'bad' | 'attention' | 'running' | 'none';
export interface HistoryStep {
  label: string;
  status: StepStatus;
  detail: string;
}
type Tone = 'success' | 'warning' | 'error' | 'info' | 'default';

export const HISTORY_TITLES = {
  analysis: 'Analysis',
  priceSearch: 'Price search',
  suggestion: 'Suggestion',
} as const;

export interface HistoryEntry {
  id: string;
  at: string;
  title: (typeof HISTORY_TITLES)[keyof typeof HISTORY_TITLES];
  startedBy: 'you' | 'autopilot' | 'Hermes';
  durationMs: number | null;
  outcome: { label: string; tone: Tone };
  steps: HistoryStep[];
}

const NODE_LABELS: Array<[ResearchNode, string]> = [
  ['identify', 'Identify the model'],
  ['sameModelUsed', 'Same model used'],
  ['lastNewPrice', 'Last new price'],
  ['substitutesNew', 'New substitutes'],
  ['substitutesUsed', 'Used substitutes'],
];

const NODE_STEPS: Record<NodeStatus, { status: StepStatus; detail: string }> = {
  done: { status: 'ok', detail: 'Done' },
  failed: { status: 'bad', detail: 'Failed' },
  timeout: { status: 'bad', detail: 'Took too long' },
  running: { status: 'running', detail: 'Running' },
  pending: { status: 'none', detail: 'Not run' },
};
const NOT_RUN: { status: StepStatus; detail: string } = { status: 'none', detail: 'Not run' };
const CHECK_RUNNING: { status: StepStatus; detail: string } = { status: 'running', detail: 'Running' };

const CHECK_LABELS: Record<VerdictCheckName, string> = {
  price: 'Price check',
  info: 'Info check',
  photos: 'Photos check',
  category: 'Category check',
  attributes: 'Attributes check',
  delivery: 'Delivery check',
};
const CHECK_ORDER: VerdictCheckName[] = ['price', 'info', 'photos', 'category', 'attributes', 'delivery'];

const CHECK_STATUS: Record<Exclude<VerdictCheckStatus, 'pending'>, StepStatus> = {
  ready: 'ok',
  fix: 'bad',
  needs_human: 'bad',
};

const EVENT_OUTCOMES: Record<HermesEventStatus, { label: string; tone: Tone }> = {
  pending_decision: { label: 'Decision pending', tone: 'info' },
  pending_review: { label: 'Pending review', tone: 'warning' },
  applying: { label: 'Applying', tone: 'info' },
  applied: { label: 'Applied', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'default' },
  failed: { label: 'Action failed', tone: 'error' },
  reverting: { label: 'Reverting', tone: 'info' },
  reverted: { label: 'Reverted', tone: 'default' },
};

const RESEARCH_OUTCOMES = {
  ok: { label: 'Prices found', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
} as const;

const EVENT_STEP_STATUS: Partial<Record<HermesEventStatus, StepStatus>> = {
  applied: 'ok',
  failed: 'bad',
  pending_review: 'attention',
  pending_decision: 'attention',
};

const RUNNING: HistoryEntry['outcome'] = { label: 'Running', tone: 'info' };
const FAILED: HistoryEntry['outcome'] = { label: 'Failed', tone: 'error' };

interface HistoryQuery {
  currentData?: unknown;
  isError: boolean;
  error?: unknown;
}

// Loading until every list has data for the current product; the first failure wins over loading,
// so a failed list is an error with retry, never a shorter history.
export function historyQueryState(queries: HistoryQuery[]): { loading: boolean; error: unknown } {
  const failed = queries.find((query) => query.isError);
  if (failed) return { loading: false, error: failed.error };
  return { loading: queries.some((query) => query.currentData === undefined), error: undefined };
}

// The entry opened by default: the newest run, since that is the log the seller just started; a
// suggestion is created a moment after its analysis and would otherwise take the spot.
export function defaultExpandedId(entries: HistoryEntry[]): string | null {
  const run = entries.find((entry) => entry.title !== HISTORY_TITLES.suggestion);
  return (run ?? entries[0])?.id ?? null;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(ms > 0 ? 1 : 0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function duration(from: string, to: string | null): number | null {
  if (!to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isNaN(ms) ? null : Math.max(0, ms);
}

function verdictOver(verdict: SaleVerdict): boolean {
  return verdict.status === 'completed' || verdict.status === 'failed';
}

// Once its run is over, a step that never finished did not run: it is never left "running".
function researchSteps(run: ResearchRun, over: boolean): HistoryStep[] {
  const ended = over || run.status === 'finished';
  const steps: HistoryStep[] = NODE_LABELS.map(([node, label]) => {
    const status = run.nodes[node] ?? 'pending';
    return { label, ...(ended && (status === 'running' || status === 'pending') ? NOT_RUN : NODE_STEPS[status]) };
  });
  if (run.status === 'finished' && run.outcome === 'failed') {
    steps.push({ label: 'Result', status: 'bad', detail: `Price search failed: ${errorReason(run.errorCode)}.` });
  }
  return steps;
}

// Only the checks in the run's scope.
function verdictSteps(verdict: SaleVerdict): HistoryStep[] {
  const over = verdictOver(verdict);
  const steps: HistoryStep[] = CHECK_ORDER.filter((name) => verdict.scope.includes(name)).map((name) => {
    const check = verdict.checks[name];
    if (!check || check.status === 'pending') return { label: CHECK_LABELS[name], ...(over ? NOT_RUN : CHECK_RUNNING) };
    return {
      label: CHECK_LABELS[name],
      status: CHECK_STATUS[check.status],
      detail: check.reasons[0]?.message ?? checkLabel(check),
    };
  });
  if (verdict.status === 'failed') {
    steps.push({ label: 'Result', status: 'bad', detail: `Analysis failed: ${verdictErrorReason(verdict.errorCode)}.` });
  }
  return steps;
}

// A price-only run linked to a forced search is what Search again starts.
function verdictTitle(verdict: SaleVerdict, linked: ResearchRun | undefined): HistoryEntry['title'] {
  const priceOnly = verdict.scope.length === 1 && verdict.scope[0] === 'price';
  return priceOnly && linked?.trigger === 'manual' ? HISTORY_TITLES.priceSearch : HISTORY_TITLES.analysis;
}

function verdictOutcome(verdict: SaleVerdict): HistoryEntry['outcome'] {
  if (verdict.status === 'failed') return FAILED;
  if (verdict.status !== 'completed') return RUNNING;
  const label = overallLabel(verdict.overall);
  return label ? { label, tone: overallColor(verdict.overall) } : { label: 'Done', tone: 'default' };
}

function researchOutcome(run: ResearchRun): HistoryEntry['outcome'] {
  if (run.status !== 'finished') return run.status === 'queued' ? { label: 'Queued', tone: 'info' } : RUNNING;
  return RESEARCH_OUTCOMES[run.outcome ?? 'failed'];
}

function runStartedBy(run: ResearchRun | undefined): HistoryEntry['startedBy'] {
  return run?.trigger === 'autopilot' ? 'autopilot' : 'you';
}

export function buildHistory(input: {
  researchRuns: ResearchRun[];
  verdicts: SaleVerdict[];
  events: HermesEvent[];
  currency: string;
}): HistoryEntry[] {
  const runsById = new Map(input.researchRuns.map((run) => [run.id, run]));
  const claimed = new Set<string>();
  const entries: HistoryEntry[] = [];

  for (const verdict of input.verdicts) {
    const linked = verdict.researchRunId ? runsById.get(verdict.researchRunId) : undefined;
    if (linked) claimed.add(linked.id);
    entries.push({
      id: `verdict:${verdict.id}`,
      at: verdict.createdAt,
      title: verdictTitle(verdict, linked),
      startedBy: runStartedBy(linked),
      durationMs: duration(verdict.createdAt, verdict.completedAt),
      outcome: verdictOutcome(verdict),
      steps: [...(linked ? researchSteps(linked, verdictOver(verdict)) : []), ...verdictSteps(verdict)],
    });
  }

  for (const run of input.researchRuns) {
    if (claimed.has(run.id)) continue;
    const at = run.startedAt ?? run.queuedAt;
    entries.push({
      id: `research:${run.id}`,
      at,
      title: HISTORY_TITLES.priceSearch,
      startedBy: runStartedBy(run),
      durationMs: duration(at, run.finishedAt),
      outcome: researchOutcome(run),
      steps: researchSteps(run, false),
    });
  }

  for (const event of input.events) {
    entries.push({
      id: `event:${event.id}`,
      at: event.createdAt,
      title: HISTORY_TITLES.suggestion,
      startedBy: 'Hermes',
      durationMs: null,
      outcome: EVENT_OUTCOMES[event.status],
      steps: [
        {
          label: event.title,
          status: EVENT_STEP_STATUS[event.status] ?? 'none',
          detail: event.status === 'pending_review' ? 'Waiting for your review' : '',
        },
      ],
    });
  }

  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
