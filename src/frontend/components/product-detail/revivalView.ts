// Pure rules of the revival dialog: what blocks the apply button, whether the price row needs the
// below-cost confirmation, and the words for a refused OLX step.
import type { ProductCondition, RevivalAiStep, RevivalProposal } from '@shared/types';
import type { ReviveListingResult } from '../../state/api/listingsApi.js';

export const DESCRIPTION_MIN_LENGTH = 20;
export const DESCRIPTION_MAX_LENGTH = 2000;

export interface RevivalForm {
  condition: ProductCondition;
  // Raw text of the cost price field; empty keeps the known cost price.
  costPrice: string;
  useTitle: boolean;
  useDescription: boolean;
  usePrice: boolean;
  allowBelowCost: boolean;
}

export interface RevivalView {
  canApply: boolean;
  reasons: string[];
  priceRow: { show: boolean; checkedByDefault: boolean; needsBelowCostConfirmation: boolean };
}

export const CONDITION_REASON = "Choose the product's condition";
export const COST_PRICE_REASON = 'Enter the cost price as a positive number';
export const BELOW_COST_REASON = 'Confirm selling below cost, or untick the price change';
export const DESCRIPTION_REASON = `The description must be ${DESCRIPTION_MIN_LENGTH} to ${DESCRIPTION_MAX_LENGTH} characters`;

/** The entered cost price; null when empty, NaN when it is not a positive number. */
export function parseCostPrice(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

export function revivalView(proposal: RevivalProposal, form: RevivalForm): RevivalView {
  const reasons: string[] = [];
  if (form.condition === 'unknown') reasons.push(CONDITION_REASON);

  const enteredCost = parseCostPrice(form.costPrice);
  if (Number.isNaN(enteredCost)) reasons.push(COST_PRICE_REASON);

  if (form.useDescription && proposal.description) {
    const length = proposal.description.proposed.length;
    if (length < DESCRIPTION_MIN_LENGTH || length > DESCRIPTION_MAX_LENGTH) reasons.push(DESCRIPTION_REASON);
  }

  const costPrice = enteredCost ?? proposal.priceGuard.costPrice;
  const proposedPrice = proposal.price;
  const effectivePrice = proposedPrice ? (form.usePrice ? proposedPrice.proposed : proposedPrice.current) : null;
  const needsBelowCostConfirmation =
    // The guard judged the proposed price, so it only counts while that price is ticked.
    (proposal.priceGuard.status === 'below_cost' && form.usePrice && proposedPrice !== undefined) ||
    (costPrice !== null && !Number.isNaN(costPrice) && effectivePrice !== null && costPrice > effectivePrice);
  if (needsBelowCostConfirmation && !form.allowBelowCost) reasons.push(BELOW_COST_REASON);

  return {
    canApply: reasons.length === 0,
    reasons,
    priceRow: {
      show: proposedPrice !== undefined,
      checkedByDefault: proposedPrice !== undefined && proposal.priceGuard.status !== 'below_cost',
      needsBelowCostConfirmation,
    },
  };
}

const AI_STEP_LABEL: Record<RevivalAiStep, string> = { copy: 'copy', price: 'price' };

/** Empty when every Hermes step worked. Names only the failed parts. */
export function aiIssuesNote(issues: readonly RevivalAiStep[]): string {
  if (issues.length === 0) return '';
  const parts = issues.map((issue) => AI_STEP_LABEL[issue]).join(' / ');
  return `Hermes could not suggest: ${parts} — reviving keeps the current values`;
}

/** What a refused OLX step means for the advert; empty after a finished revival. */
export function revivalFailureMessage(result: Pick<ReviveListingResult, 'outcome' | 'step' | 'reason'>): string {
  if (result.step === 'done') return '';
  const reason = (result.reason ?? 'no reason given').replace(/\.+$/, '');
  if (result.step === 'activate') {
    return `OLX refused to bring the advert back: ${reason}. Your changes are saved; retry when ready.`;
  }
  return result.outcome === 'update_refused'
    ? `OLX refused the update, so the advert was not reactivated: ${reason}. Your changes are saved; retry when ready.`
    : `The advert is back on OLX with its old text; OLX refused the update: ${reason}. Your changes are saved; retry when ready.`;
}

/** The API's refusal text (400/409/422), or a generic line when the request never got an answer. */
export function requestErrorMessage(err: unknown): string {
  const e = err as { data?: { error?: { message?: string } }; message?: string } | null | undefined;
  return e?.data?.error?.message ?? e?.message ?? 'Request failed';
}
