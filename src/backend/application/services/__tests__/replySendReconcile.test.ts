import type { MarketplaceMessage } from '../../../domain/services/MarketplaceAdapter';
import { decideReconcile } from '../ReplySendService';

const STARTED = new Date('2026-11-21T12:00:00Z');

function seller(text: string, secondsFromStart: number, id = 'm1'): MarketplaceMessage {
  return {
    externalMessageId: id, direction: 'seller', text, sentAt: new Date(STARTED.getTime() + secondsFromStart * 1000),
  };
}

describe('decideReconcile', () => {
  it('reconcileFindsOwnMessage: a seller message with the same normalised text sent after the attempt is ours', () => {
    expect(decideReconcile({ text: 'Tak,  jest dostępny!', startedAt: STARTED }, [
      { externalMessageId: 'b1', direction: 'buyer', text: 'tak, jest dostępny!', sentAt: STARTED },
      seller('TAK, jest dostępny! ', 2),
    ])).toBe('sent');
  });

  it('accepts a seller message up to five seconds before the attempt started (clock skew)', () => {
    expect(decideReconcile({ text: 'Yes', startedAt: STARTED }, [seller('Yes', -5)])).toBe('sent');
  });

  it('reconcileIgnoresOlderIdenticalText: the same text sent earlier is not this attempt', () => {
    expect(decideReconcile({ text: 'Yes, still available', startedAt: STARTED }, [
      seller('Yes, still available', -6),
    ])).toBe('not_sent');
  });

  it('ignores buyer messages and different seller text', () => {
    expect(decideReconcile({ text: 'Yes', startedAt: STARTED }, [
      { externalMessageId: 'b1', direction: 'buyer', text: 'Yes', sentAt: STARTED },
      seller('No', 1),
    ])).toBe('not_sent');
  });
});
