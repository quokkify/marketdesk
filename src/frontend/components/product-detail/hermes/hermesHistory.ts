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
import { errorReason } from '../priceResearchModel.js';

export type StepStatus = 'ok' | 'bad' | 'none';
export interface HistoryStep {
  label: string;
  status: StepStatus;
  detail: string;
}
type Tone = 'success' | 'warning' | 'error' | 'info' | 'default';
export interface HistoryEntry {
  id: string;
  at: string;
  title: 'Analysis' | 'Price search' | 'Suggestion';
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
  running: { status: 'none', detail: 'Running' },
  pending: { status: 'none', detail: 'Not run' },
};

const CHECK_LABELS: Record<VerdictCheckName, string> = {
  price: 'Price check',
  info: 'Info check',
  photos: 'Photos check',
};
const CHECK_ORDER: VerdictCheckName[] = ['price', 'info', 'photos'];

const CHECK_STATUS: Record<VerdictCheckStatus, StepStatus> = {
  ready: 'ok',
  fix: 'bad',
  needs_human: 'bad',
  pending: 'none',
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

const RUNNING: HistoryEntry['outcome'] = { label: 'Running', tone: 'info' };
const FAILED: HistoryEntry['outcome'] = { label: 'Failed', tone: 'error' };

function duration(from: string, to: string | null): number | null {
  if (!to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isNaN(ms) ? null : Math.max(0, ms);
}

function sentence(prefix: string, code: string | null): string {
  return `${prefix}: ${errorReason(code)}.`;
}

function researchSteps(run: ResearchRun): HistoryStep[] {
  const steps = NODE_LABELS.map(([node, label]) => ({ label, ...NODE_STEPS[run.nodes[node] ?? 'pending'] }));
  if (run.status === 'finished' && run.outcome === 'failed') {
    steps.push({ label: 'Result', status: 'bad', detail: sentence('Price search failed', run.errorCode) });
  }
  return steps;
}

function verdictSteps(verdict: SaleVerdict): HistoryStep[] {
  const steps = CHECK_ORDER.map((name) => {
    const check = verdict.checks[name];
    if (!check) return { label: CHECK_LABELS[name], status: 'none' as const, detail: 'Not checked' };
    return {
      label: CHECK_LABELS[name],
      status: CHECK_STATUS[check.status],
      detail: check.reasons[0]?.message ?? checkLabel(check),
    };
  });
  if (verdict.status === 'failed') {
    steps.push({ label: 'Result', status: 'bad', detail: sentence('Analysis failed', verdict.errorCode) });
  }
  return steps;
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
      title: 'Analysis',
      startedBy: runStartedBy(linked),
      durationMs: duration(verdict.createdAt, verdict.completedAt),
      outcome: verdictOutcome(verdict),
      steps: [...(linked ? researchSteps(linked) : []), ...verdictSteps(verdict)],
    });
  }

  for (const run of input.researchRuns) {
    if (claimed.has(run.id)) continue;
    const at = run.startedAt ?? run.queuedAt;
    entries.push({
      id: `research:${run.id}`,
      at,
      title: 'Price search',
      startedBy: runStartedBy(run),
      durationMs: duration(at, run.finishedAt),
      outcome: researchOutcome(run),
      steps: researchSteps(run),
    });
  }

  for (const event of input.events) {
    entries.push({
      id: `event:${event.id}`,
      at: event.createdAt,
      title: 'Suggestion',
      startedBy: 'Hermes',
      durationMs: null,
      outcome: EVENT_OUTCOMES[event.status],
      steps: [
        {
          label: event.title,
          status: event.status === 'applied' ? 'ok' : event.status === 'failed' ? 'bad' : 'none',
          detail: event.detail ?? '',
        },
      ],
    });
  }

  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
