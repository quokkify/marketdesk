import type { BuyerIntent, ConversationScreeningReason, ConversationThreadView } from '@shared/types';

const SCREENING_REASON_LABELS: Record<ConversationScreeningReason, string> = {
  foreign_link: 'Link outside OLX',
  payment_data_request: 'Asks for card or BLIK data',
  messenger_move: 'Moves to a messenger',
  fake_payment_confirmation: 'Claims a payment already made',
  prompt_injection: 'Tries to instruct the assistant',
  repeated_text: 'Repeated message',
  message_flood: 'Message flood',
};

const DRAFT_RULE_LABELS: Record<string, string> = {
  below_floor: 'it offers less than your lowest price',
  link: 'it contains a link',
  contact: 'it contains contact details',
  iban: 'it contains bank or card details',
  off_platform_payment: 'it asks for payment outside OLX',
  too_long: 'it is too long',
  unfilled_placeholder: 'the price is missing',
  empty: 'it is empty',
};

export const INTENT_LABELS: Record<BuyerIntent, string> = {
  availability: 'Availability',
  haggle: 'Price question',
  logistics: 'Delivery',
  other: 'Other',
};

const UNCLEAR_SEND_MESSAGE =
  "We couldn't confirm the reply reached OLX. Check the conversation on OLX before replying again.";

export const reasonLabel = (reason: ConversationScreeningReason): string => SCREENING_REASON_LABELS[reason];

export const isSendDisabled = (sending: boolean): boolean => sending;

export function draftRuleMessage(rule: string | undefined): string {
  const label = rule === undefined ? undefined : DRAFT_RULE_LABELS[rule];
  return label ? `This reply can't be sent: ${label}` : "This reply can't be sent.";
}

export interface ActionErrorView {
  // null: nothing specific to say, so the caller shows the generic error toast.
  message: string | null;
  refetch: boolean;
}

export function describeActionError(error: unknown): ActionErrorView {
  const body = (error as { data?: { error?: { code?: unknown; details?: { rule?: unknown } } } } | undefined)?.data
    ?.error;
  switch (body?.code) {
    case 'draft_rule':
      return {
        message: draftRuleMessage(typeof body.details?.rule === 'string' ? body.details.rule : undefined),
        refetch: false,
      };
    case 'superseded':
      return { message: 'The buyer wrote again — a new draft is coming.', refetch: true };
    case 'already_sending':
      return { message: 'Already sending…', refetch: false };
    case 'unclear_send':
      return { message: UNCLEAR_SEND_MESSAGE, refetch: true };
    case 'daily_cap':
      return { message: "Today's AI limit is reached. Try again tomorrow or reply on OLX.", refetch: false };
    default:
      return { message: null, refetch: false };
  }
}

export type ThreadPanel =
  | { kind: 'suspicious'; reasons: string[] }
  | { kind: 'draft' }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string }
  | { kind: 'unclear_send'; message: string }
  | { kind: 'no_draft' }
  | { kind: 'none' };

export function threadPanel(thread: ConversationThreadView): ThreadPanel {
  if (thread.status === 'suspicious') {
    return { kind: 'suspicious', reasons: thread.suspiciousReasons.map(reasonLabel) };
  }
  const draft = thread.draft;
  if (draft?.status === 'pending' || draft?.status === 'sending') return { kind: 'draft' };
  if (draft?.status === 'sent') return { kind: 'sent' };
  if (draft?.status === 'failed' && draft.failureReason === 'unclear_send') {
    return { kind: 'unclear_send', message: UNCLEAR_SEND_MESSAGE };
  }
  if (draft?.status === 'failed') {
    const label = draft.failureReason === null ? undefined : DRAFT_RULE_LABELS[draft.failureReason];
    return {
      kind: 'failed',
      message: label ? `Couldn't write a safe reply (${label}).` : "Couldn't write a safe reply.",
    };
  }
  const newest = thread.messages[thread.messages.length - 1];
  return newest?.direction === 'buyer' ? { kind: 'no_draft' } : { kind: 'none' };
}

export function awaitingReplyLabel(count: number | undefined): string | null {
  return count !== undefined && count > 0 ? `${count} awaiting reply` : null;
}
