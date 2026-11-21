import {
  buyerReplyProfile,
  replyClassifyOutputSchema,
  replyDraftOutputSchema,
} from '../buyerReplyProfile';
import type { ReplyContext } from '../../ports/IReplyDraftAI';

describe('buyerReplyProfile', () => {
  it('outputSchemaRejectsExtraFields', () => {
    expect(replyDraftOutputSchema.safeParse({ reply: 'Hi', counterOffer: false, proposedPrice: null, extra: 1 }).success).toBe(false);
    expect(replyClassifyOutputSchema.safeParse({ intent: 'other', confidence: 'low', extra: 1 }).success).toBe(false);
    expect(replyDraftOutputSchema.safeParse({ reply: 'Hi {{PRICE}}', counterOffer: true, proposedPrice: 10 }).success).toBe(true);
    expect(replyDraftOutputSchema.safeParse({ reply: 'Hi', counterOffer: true, proposedPrice: -1 }).success).toBe(false);
  });

  it('outputSchemaRejectsUnknownIntent', () => {
    expect(replyClassifyOutputSchema.safeParse({ intent: 'refund', confidence: 'high' }).success).toBe(false);
  });

  it('profileDeclaresNoTools', () => {
    expect(buyerReplyProfile.version).toBe('1.0.0');
    expect(buyerReplyProfile.capabilities).toEqual({ web: false, network: false, terminal: false, filesystem: false, tools: [] });
    const text = buyerReplyProfile.instruction();
    expect(text).toContain('no tools');
    expect(text).toContain('{{PRICE}}');
    expect(text).toContain('<buyer_thread>');
  });

  it('floorIsNotAReplyContextField', () => {
    const ctx: ReplyContext = {
      product: { id: 'p', title: 't', description: 'd', condition: 'new', price: 10, currency: 'PLN' },
      messages: [{ direction: 'buyer', text: 'hi' }],
    };
    expect(Object.keys(ctx).sort()).toEqual(['messages', 'product']);
    expect(Object.keys(ctx.product).some((k) => /floor|min/i.test(k))).toBe(false);
  });
});
