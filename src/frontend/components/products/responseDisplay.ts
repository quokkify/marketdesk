// Pure helpers behind the listing response stage shown in the catalogue row and on the product page.
import type { ListingResponseRun, ListingResponseSignal, ListingResponseView, ResponseAction } from '@shared/types';
import { formatRelative } from '../../utils/formatters.js';

export const ASK_WHY_LABEL = 'Why no response?';
export const ASK_WHY_RUNNING_LABEL = 'Checking…';
export const OUT_OF_DATE_LABEL = 'out of date';
export const REFRESH_ADVERT_HINT = 'Refresh the advert on OLX';

const HOURS_PER_DAY = 24;

function dayLabel(hoursLive: number | null): string {
  return hoursLive === null ? '' : ` · day ${Math.max(1, Math.ceil(hoursLive / HOURS_PER_DAY))}`;
}

// The stage as one short line; empty for a listing that already gets responses.
export function stageLabel(signal: ListingResponseSignal): string {
  switch (signal.stage) {
    case 'too_early':
      return signal.viewsNeeded === null
        ? `Too early${dayLabel(signal.hoursLive)}`
        : `Too early · ${signal.views ?? 0} of ${signal.viewsNeeded} views`;
    case 'not_seen':
      return `Not seen${dayLabel(signal.hoursLive)}`;
    case 'seen_not_contacted':
      return `Seen, no contact · ${signal.views ?? 0} views`;
    case 'no_data':
      return 'No fresh statistics';
    case 'responding':
      return '';
  }
}

export function canAskWhy(signal: ListingResponseSignal | null, active: boolean): boolean {
  return !active && (signal?.stage === 'not_seen' || signal?.stage === 'seen_not_contacted');
}

export function responseLines(run: ListingResponseRun | null, limit: number): string[] {
  return run ? run.findings.map((finding) => finding.message).slice(0, limit) : [];
}

export function checkedLabel(run: ListingResponseRun | null, now: Date | number = Date.now()): string | null {
  if (!run?.completedAt) return null;
  const checked = `checked ${formatRelative(run.completedAt, now)}`;
  return run.findings.length === 0 ? `${checked} · nothing found` : checked;
}

export type ResponseActionKind = 'analyze' | 'review_price' | 'edit_title' | 'open_proposal' | 'hint';

export const RESPONSE_ACTION_LABELS: Record<ResponseActionKind, string> = {
  analyze: 'Analyze',
  review_price: 'Review price',
  edit_title: 'Edit title',
  open_proposal: 'Open suggestion',
  hint: REFRESH_ADVERT_HINT,
};

// `retry` is the Why no response? button itself and `null` has no control.
export function responseActionKind(action: ResponseAction): ResponseActionKind | null {
  switch (action) {
    case 'run_analyze':
      return 'analyze';
    case 'review_price':
      return 'review_price';
    case 'edit_title':
      return 'edit_title';
    case 'open_proposal':
      return 'open_proposal';
    case 'refresh_advert':
      return 'hint';
    default:
      return null;
  }
}

// What a catalogue row knows once the response view of its product was read.
export interface RowResponseState {
  active: boolean;
  outOfDate: boolean;
  latest: ListingResponseRun | null;
}

export type RowResponseMap = Record<string, RowResponseState>;

export function askChecking(map: RowResponseMap, productId: string, latest: ListingResponseRun | null): RowResponseMap {
  return { ...map, [productId]: { active: true, outOfDate: false, latest } };
}

export function askProgress(map: RowResponseMap, productId: string, view: ListingResponseView): RowResponseMap {
  return { ...map, [productId]: { active: view.active !== null, outOfDate: view.outOfDate, latest: view.latest } };
}

// A failed request leaves the row as the list item shows it.
export function askFailed(map: RowResponseMap, productId: string): RowResponseMap {
  const { [productId]: _dropped, ...rest } = map;
  return rest;
}

// A finished entry holds only until the list item carries the entry's run or a newer one; from
// then on the list item's out-of-date mark is current and the entry's is frozen.
export function currentRowResponse(
  entry: RowResponseState | undefined,
  listRun: ListingResponseRun | null | undefined
): RowResponseState | undefined {
  if (!entry || entry.active) return entry;
  const entryAt = Date.parse(entry.latest?.completedAt ?? '');
  const listAt = Date.parse(listRun?.completedAt ?? '');
  return listAt >= entryAt || (Number.isNaN(entryAt) && !Number.isNaN(listAt)) ? undefined : entry;
}

export type ResponseControlTarget = { kind: 'analyze' } | { kind: 'tab'; tab: 'checks' | 'suggestions' } | { kind: 'edit' };

export function responseControlTarget(action: Exclude<ResponseActionKind, 'hint'>): ResponseControlTarget {
  switch (action) {
    case 'analyze':
      return { kind: 'analyze' };
    case 'review_price':
      return { kind: 'tab', tab: 'checks' };
    case 'edit_title':
      return { kind: 'edit' };
    case 'open_proposal':
      return { kind: 'tab', tab: 'suggestions' };
  }
}
