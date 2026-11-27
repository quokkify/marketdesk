// What the Hermes card on the product page shows, computed from API data so the component has no logic.
import type {
  HermesEvent,
  ListingResponseSignal,
  ListingResponseView,
  HermesStatusView,
  PriceResearchView,
  ProductVerdictView,
  ResearchNode,
  SaleVerdict,
  VerdictCheck,
  VerdictCheckName,
} from '@shared/types';
import { formatMoney, formatRelative } from '../../../utils/formatters.js';
import {
  LAST_RUN_FAILED_LABEL,
  VERDICT_CHECK_ORDER,
  leadingReason,
  newestCheckAt,
  overallColor,
  overallLabel,
} from '../../products/verdictDisplay.js';
import {
  canAskWhy,
  checkedLabel,
  responseActionKind,
  stageLabel,
} from '../../products/responseDisplay.js';
import type { ResponseActionKind } from '../../products/responseDisplay.js';
import { anchorsUpdatedAt, runProgressText, verdictErrorReason } from '../priceResearchModel.js';

export type HermesDrawerTab = 'prices' | 'checks' | 'suggestions' | 'history';
export type RowStatus = 'ok' | 'bad' | 'attention' | 'running' | 'idle';

export interface HermesCardRow {
  key: 'prices' | 'price' | 'info' | 'photos' | 'suggestions';
  tab: HermesDrawerTab;
  title: string;
  status: RowStatus;
  value: string;
  detail: string;
}

export type HermesPrimaryAction =
  | { kind: 'analyze'; label: 'Analyze product' | 'Analyze again' }
  | { kind: 'set_price'; label: string; eventId: string }
  | { kind: 'none' };

export interface HermesCardState {
  chip: { label: string; color: 'success' | 'warning' | 'error' | 'default' | 'primary'; outlined: boolean };
  lead: string;
  primary: HermesPrimaryAction;
  // Secondary button beside a set_price primary, or under a finished verdict with nothing to do.
  showAnalyzeAgain: boolean;
  rows: HermesCardRow[];
  footer: string;
}

export interface HermesCardInput {
  verdict: ProductVerdictView | null;
  research: PriceResearchView | null;
  stale: boolean;
  // Unresolved recommendations of this product.
  pendingEvents: HermesEvent[];
  suggestionTotal: number;
  currency: string;
  now: Date;
}

const NOT_ANALYSED_LABEL = 'Not analysed';
const NOT_ANALYSED_LEAD = 'Hermes has not looked at this product yet.';
const READY_LEAD = 'Nothing to fix. This product is ready to sell.';
const STALE_LEAD = 'The product changed since this check.';
const NO_REASON_LEAD = 'Hermes found something to look at.';
const NO_PRICES_DETAIL = 'No market prices yet';
const RESEARCH_NODES = 5;
const CHECK_COUNT = 3;
const RESEARCH_TOTAL = RESEARCH_NODES + CHECK_COUNT;
const NODE_OVER = new Set(['done', 'failed', 'timeout']);
// The order the verdict graph works through its checks.
const STEP_ORDER: readonly VerdictCheckName[] = ['price', 'info', 'photos', 'category', 'attributes', 'delivery'];
const STEP_NAMES: Record<VerdictCheckName, string> = {
  price: 'Price',
  info: 'Info',
  photos: 'Photos',
  category: 'Category',
  attributes: 'Attributes',
  delivery: 'Delivery',
};
const CHECK_ROWS = [
  { key: 'price', title: 'Price' },
  { key: 'info', title: 'Info' },
  { key: 'photos', title: 'Photos' },
] as const;
const CHECK_STATUS: Record<Exclude<VerdictCheck['status'], 'pending'>, RowStatus> = {
  ready: 'ok',
  fix: 'bad',
  needs_human: 'attention',
};

const ANALYZE_AGAIN: HermesPrimaryAction = { kind: 'analyze', label: 'Analyze again' };

function finishedChecks(verdict: SaleVerdict | null): number {
  return VERDICT_CHECK_ORDER.filter((name) => {
    const check = verdict?.checks[name];
    return check !== undefined && check.status !== 'pending';
  }).length;
}

// Once a linked run has finished the view no longer carries it, and all its nodes are over.
function finishedNodes(research: PriceResearchView | null): number {
  if (!research?.run) return RESEARCH_NODES;
  const nodes = research.run.nodes;
  return (Object.keys(nodes) as ResearchNode[]).filter((node) => NODE_OVER.has(nodes[node] ?? '')).length;
}

// A market search with no analysis running (autopilot, or a search queued on its own) counts its own
// steps: "Searching prices n/5".
function searchingState(input: HermesCardInput): Pick<HermesCardState, 'chip' | 'lead'> {
  const done = finishedNodes(input.research);
  return {
    chip: { label: `Searching prices ${Math.min(done + 1, RESEARCH_NODES)}/${RESEARCH_NODES}`, color: 'primary', outlined: false },
    lead: runProgressText(input.research?.run ?? null) ?? 'Searching prices…',
  };
}

function runningState(input: HermesCardInput, researchActive: boolean): Pick<HermesCardState, 'chip' | 'lead'> {
  const active = input.verdict?.active ?? null;
  const linked = researchActive || (active?.researchRunId ?? null) !== null;
  const total = linked ? RESEARCH_TOTAL : CHECK_COUNT;
  const done = finishedChecks(active) + (linked ? finishedNodes(input.research) : 0);
  const step = STEP_ORDER.find((name) => {
    const check = active?.checks[name];
    return !check || check.status === 'pending';
  });
  const lead = researchActive
    ? (runProgressText(input.research?.run ?? null) ?? 'Searching prices…')
    : step
      ? `${STEP_NAMES[step]} check…`
      : 'Finishing…';
  return {
    chip: { label: `Analyzing ${Math.min(done + 1, total)}/${total}`, color: 'primary', outlined: false },
    lead,
  };
}

function priceFixAction(latest: SaleVerdict, input: HermesCardInput): HermesPrimaryAction | null {
  const price = latest.checks.price;
  if (price?.status !== 'fix' || price.refs.proposedPrice == null) return null;
  const eventId = price.refs.eventIds.find((id) => input.pendingEvents.some((event) => event.id === id));
  if (!eventId) return null;
  return {
    kind: 'set_price',
    label: `Set price to ${formatMoney(price.refs.proposedPrice, input.currency)}`,
    eventId,
  };
}

function verdictState(latest: SaleVerdict, input: HermesCardInput): Pick<HermesCardState, 'chip' | 'lead' | 'primary' | 'showAnalyzeAgain'> {
  const chip = {
    label: overallLabel(latest.overall) ?? NOT_ANALYSED_LABEL,
    color: overallColor(latest.overall),
    outlined: input.stale,
  };
  if (input.stale) return { chip, lead: STALE_LEAD, primary: ANALYZE_AGAIN, showAnalyzeAgain: false };
  if (latest.overall === 'ready') {
    return { chip, lead: READY_LEAD, primary: { kind: 'none' }, showAnalyzeAgain: true };
  }
  const lead = leadingReason(latest) ?? NO_REASON_LEAD;
  const setPrice = latest.overall === 'fix' ? priceFixAction(latest, input) : null;
  if (setPrice) return { chip, lead, primary: setPrice, showAnalyzeAgain: true };
  return { chip, lead, primary: ANALYZE_AGAIN, showAnalyzeAgain: false };
}

function checkRow(
  name: (typeof CHECK_ROWS)[number],
  verdict: SaleVerdict | null,
  running: boolean,
  now: Date
): HermesCardRow {
  const check = verdict?.checks[name.key];
  if (!check || check.status === 'pending') {
    return {
      key: name.key,
      tab: 'checks',
      title: name.title,
      status: running ? 'running' : 'idle',
      value: '',
      detail: running ? 'Checking…' : 'Not checked yet',
    };
  }
  const { currentPrice, proposedPrice, currency, photoCount, researchUpdatedAt } = check.refs;
  let value = '';
  if (name.key === 'price' && currentPrice !== undefined) {
    value =
      proposedPrice != null
        ? `${formatMoney(currentPrice, currency)} → ${formatMoney(proposedPrice, currency)}`
        : formatMoney(currentPrice, currency);
  } else if (name.key === 'photos' && photoCount !== undefined) {
    value = String(photoCount);
  }
  const detail =
    name.key === 'price' && researchUpdatedAt
      ? `Uses the market prices from ${formatRelative(researchUpdatedAt, now)}`
      : (check.reasons[0]?.message ?? '');
  return { key: name.key, tab: 'checks', title: name.title, status: CHECK_STATUS[check.status], value, detail };
}

function pricesRow(input: HermesCardInput, researchActive: boolean): HermesCardRow {
  const { research, currency, now } = input;
  const stored = research?.lastEstimate ?? null;
  const base = { key: 'prices', tab: 'prices', title: 'Market prices' } as const;
  const value = stored ? `Start ${formatMoney(stored.estimate.startPrice, currency)}` : '';
  if (researchActive) {
    return { ...base, status: 'running', value, detail: runProgressText(research?.run ?? null) ?? '' };
  }
  if (!research || !stored) return { ...base, status: 'idle', value, detail: NO_PRICES_DETAIL };
  const searchedAt = anchorsUpdatedAt(research.lastRun, research.updatedAt === null ? null : { ...research, updatedAt: research.updatedAt });
  const parts = [
    `Floor ${formatMoney(stored.estimate.floorPrice, currency)}`,
    research.comparables.length > 0 ? `${research.comparables.length} prices` : null,
    searchedAt ? formatRelative(searchedAt, now) : null,
    `confidence: ${stored.estimate.confidence}`,
  ].filter((part): part is string => part !== null);
  return { ...base, status: 'ok', value, detail: parts.join(' · ') };
}

function suggestionsRow(input: HermesCardInput): HermesCardRow {
  const waiting = input.pendingEvents.length;
  return {
    key: 'suggestions',
    tab: 'suggestions',
    title: 'Suggestions',
    status: waiting > 0 ? 'attention' : 'idle',
    value: String(input.suggestionTotal),
    detail: waiting > 0 ? `${waiting} waiting for you` : 'None waiting',
  };
}

function footerText(input: HermesCardInput, running: boolean): string {
  if (running) return 'Running now';
  const latest = input.verdict?.latest ?? null;
  const at = (latest && (newestCheckAt(latest) ?? latest.completedAt)) ?? input.research?.lastRun?.finishedAt ?? null;
  return at ? `Last run ${formatRelative(at, input.now)}` : 'No runs yet';
}

const REVIEW_ONLY = 'Any recommendation will remain review-only.';

// Who answers the analysis: offline heuristics stand in while Hermes is unavailable. Neutral while
// the provider status is still unknown, and never credits Hermes while its API server is refused
// for having tools enabled.
export function hermesProviderNote(
  activeProvider: HermesStatusView['activeProvider'] | undefined,
  hermesToolsSafe: HermesStatusView['hermesToolsSafe'] | undefined,
  analyzing: boolean
): string {
  const provider = activeProvider === 'hermes' && hermesToolsSafe === false ? undefined : activeProvider;
  if (analyzing) {
    const subject =
      provider === 'hermes' ? 'Hermes is analyzing' : provider === 'offline' ? 'Offline heuristics are analyzing' : 'Analyzing';
    return `${subject} this product only. ${REVIEW_ONLY}`;
  }
  if (provider === 'hermes') return `Hermes analyzes this product only. ${REVIEW_ONLY}`;
  if (provider === 'offline') return `Offline heuristics analyze this product only while Hermes is unavailable. ${REVIEW_ONLY}`;
  return REVIEW_ONLY;
}

export function hermesCardState(input: HermesCardInput): HermesCardState {
  const latest = input.verdict?.latest ?? null;
  const researchActive = runProgressText(input.research?.run ?? null) !== null;
  const active = input.verdict?.active ?? null;
  const running = active !== null || researchActive;

  let head: Pick<HermesCardState, 'chip' | 'lead' | 'primary' | 'showAnalyzeAgain'>;
  if (running) {
    const progress = active ? runningState(input, researchActive) : searchingState(input);
    head = { ...progress, primary: { kind: 'none' }, showAnalyzeAgain: false };
  } else if (input.verdict?.lastFailed) {
    // The failed run's own code; a research run's failure never stands in for it.
    const reason = verdictErrorReason(input.verdict.lastFailedCode);
    head = {
      chip: { label: LAST_RUN_FAILED_LABEL, color: 'error', outlined: false },
      lead: `The last run failed: ${reason}.`,
      primary: ANALYZE_AGAIN,
      showAnalyzeAgain: false,
    };
  } else if (latest && latest.overall !== null) {
    head = verdictState(latest, input);
  } else {
    head = {
      chip: { label: NOT_ANALYSED_LABEL, color: 'default', outlined: false },
      lead: NOT_ANALYSED_LEAD,
      primary: { kind: 'analyze', label: 'Analyze product' },
      showAnalyzeAgain: false,
    };
  }

  // Only an analysis checks Price, Info and Photos; during a search alone they keep the last verdict.
  const shown = active ?? latest;
  return {
    ...head,
    rows: [
      pricesRow(input, researchActive),
      ...CHECK_ROWS.map((name) => checkRow(name, shown, active !== null, input.now)),
      suggestionsRow(input),
    ],
    footer: footerText(input, running),
  };
}

export interface ResponseCardFinding {
  message: string;
  control: ResponseActionKind | null;
}

export interface ResponseCardState {
  stage: string;
  canAsk: boolean;
  active: boolean;
  checked: string | null;
  outOfDate: boolean;
  lastFailed: boolean;
  findings: ResponseCardFinding[];
}

export interface ResponseCardInput {
  signal: ListingResponseSignal | null;
  view: ListingResponseView | null;
  now: Date;
}

// The listing response block of the card; null when there is nothing to say or ask.
export function responseCardState(input: ResponseCardInput): ResponseCardState | null {
  const { signal, view, now } = input;
  if (!signal) return null;
  const active = (view?.active ?? null) !== null;
  const latest = view?.latest ?? null;
  const stage = stageLabel(signal);
  if (!stage && !latest && !active) return null;
  return {
    stage,
    canAsk: canAskWhy(signal, active),
    active,
    checked: checkedLabel(latest, now),
    outOfDate: view?.outOfDate ?? false,
    lastFailed: view?.lastFailed ?? false,
    findings: (latest?.findings ?? []).map((finding) => ({
      message: finding.message,
      control: responseActionKind(finding.action),
    })),
  };
}
