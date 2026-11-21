import type { ConversationScreeningReason, ConversationThreadView } from '@shared/types';
import {
  awaitingReplyLabel,
  describeActionError,
  draftRuleMessage,
  isSendDisabled,
  reasonLabel,
  threadPanel,
} from './conversationsState';

const ALL_REASONS: ConversationScreeningReason[] = [
  'foreign_link',
  'payment_data_request',
  'messenger_move',
  'fake_payment_confirmation',
  'prompt_injection',
  'repeated_text',
  'message_flood',
];

function thread(overrides: Partial<ConversationThreadView> = {}): ConversationThreadView {
  return {
    id: 't1',
    status: 'open',
    suspiciousReasons: [],
    messages: [{ id: 'm1', direction: 'buyer', text: 'Hi', sentAt: '2026-11-21T10:00:00Z' }],
    draft: null,
    ...overrides,
  };
}

const draft = (status: NonNullable<ConversationThreadView['draft']>['status']) => ({
  id: 'd1',
  status,
  intent: 'availability' as const,
  text: 'Yes, still available.',
  filledPrice: null,
  failureReason: null,
  offline: false,
});

describe('reasonLabel', () => {
  it('reasonLabelForEveryScreeningReason', () => {
    const labels = ALL_REASONS.map(reasonLabel);
    expect(labels).toEqual([
      'Link outside OLX',
      'Asks for card or BLIK data',
      'Moves to a messenger',
      'Claims a payment already made',
      'Tries to instruct the assistant',
      'Repeated message',
      'Message flood',
    ]);
  });
});

describe('isSendDisabled', () => {
  it('sendDisabledWhileSending', () => {
    expect(isSendDisabled(true)).toBe(true);
    expect(isSendDisabled(false)).toBe(false);
  });
});

describe('draftRuleMessage', () => {
  it('names the rule that blocked the reply', () => {
    expect(draftRuleMessage('below_floor')).toBe(
      "This reply can't be sent: it offers less than your lowest price"
    );
    expect(draftRuleMessage('unfilled_placeholder')).toBe("This reply can't be sent: the price is missing");
    expect(draftRuleMessage('off_platform_payment')).toBe(
      "This reply can't be sent: it asks for payment outside OLX"
    );
  });

  it('falls back to a plain sentence for an unknown rule', () => {
    expect(draftRuleMessage('something_new')).toBe("This reply can't be sent.");
  });
});

describe('describeActionError', () => {
  const envelope = (code: string, details?: unknown) => ({ status: 409, data: { error: { code, details } } });

  it('maps a draft rule rejection to its sentence', () => {
    expect(describeActionError(envelope('draft_rule', { rule: 'link' }))).toEqual({
      message: "This reply can't be sent: it contains a link",
      refetch: false,
    });
  });

  it('refetches after superseded and unclear_send', () => {
    expect(describeActionError(envelope('superseded'))).toEqual({
      message: 'The buyer wrote again — a new draft is coming.',
      refetch: true,
    });
    expect(describeActionError(envelope('unclear_send'))).toEqual({
      message:
        "We couldn't confirm the reply reached OLX. Check the conversation on OLX before replying again.",
      refetch: true,
    });
  });

  it('maps already_sending and daily_cap', () => {
    expect(describeActionError(envelope('already_sending')).message).toBe('Already sending…');
    expect(describeActionError(envelope('daily_cap')).message).toBe(
      "Today's AI limit is reached. Try again tomorrow or reply on OLX."
    );
  });

  it('leaves every other error to the generic toast', () => {
    expect(describeActionError(envelope('not_pending'))).toEqual({ message: null, refetch: false });
    expect(describeActionError(new Error('boom'))).toEqual({ message: null, refetch: false });
    expect(describeActionError(undefined)).toEqual({ message: null, refetch: false });
  });
});

describe('threadPanel', () => {
  it('shows the warning and no draft for a suspicious thread', () => {
    expect(
      threadPanel(thread({ status: 'suspicious', suspiciousReasons: ['foreign_link'], draft: draft('pending') }))
    ).toEqual({ kind: 'suspicious', reasons: ['Link outside OLX'] });
  });

  it('offers the editable box for a pending or sending draft', () => {
    expect(threadPanel(thread({ draft: draft('pending') })).kind).toBe('draft');
    expect(threadPanel(thread({ draft: draft('sending') })).kind).toBe('draft');
  });

  it('reports a sent draft', () => {
    expect(threadPanel(thread({ draft: draft('sent') })).kind).toBe('sent');
  });

  it('explains a failed draft with the rule label and offers regenerate', () => {
    expect(
      threadPanel(thread({ draft: { ...draft('failed'), text: null, failureReason: 'link' } }))
    ).toEqual({ kind: 'failed', message: "Couldn't write a safe reply (it contains a link)." });
  });

  it('names no AI source for a failed draft', () => {
    expect(threadPanel(thread({ draft: { ...draft('failed'), text: null, offline: true } }))).toEqual({
      kind: 'failed',
      message: "Couldn't write a safe reply.",
    });
  });

  it('unclearSendIsNotAWritingFailure', () => {
    expect(
      threadPanel(thread({ draft: { ...draft('failed'), failureReason: 'unclear_send' } }))
    ).toEqual({
      kind: 'unclear_send',
      message: "We couldn't confirm the reply reached OLX. Check the conversation on OLX before replying again.",
    });
  });

  it('says no draft yet when the buyer wrote last and nothing is active', () => {
    expect(threadPanel(thread()).kind).toBe('no_draft');
    expect(threadPanel(thread({ draft: draft('dismissed') })).kind).toBe('no_draft');
  });

  it('shows nothing extra when the seller wrote last', () => {
    expect(
      threadPanel(
        thread({
          messages: [{ id: 'm2', direction: 'seller', text: 'Yes', sentAt: '2026-11-21T10:05:00Z' }],
        })
      ).kind
    ).toBe('none');
  });
});

describe('awaitingReplyLabel', () => {
  it('names the count only when something awaits', () => {
    expect(awaitingReplyLabel(0)).toBeNull();
    expect(awaitingReplyLabel(undefined)).toBeNull();
    expect(awaitingReplyLabel(3)).toBe('3 awaiting reply');
  });
});
