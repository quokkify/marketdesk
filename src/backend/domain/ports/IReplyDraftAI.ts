import type { BuyerIntent } from '../conversations/types';

// Deliberately has no floor price: the AI never sees the seller's limit.
export interface ReplyContext {
  product: { id: string; title: string; description: string; condition: string; price: number; currency: string };
  messages: Array<{ direction: 'buyer' | 'seller'; text: string }>;
}

export interface IReplyDraftAI {
  classify(ctx: ReplyContext): Promise<{ intent: BuyerIntent; confidence: 'high' | 'medium' | 'low' }>;
  draft(
    ctx: ReplyContext,
    intent: BuyerIntent,
  ): Promise<{ reply: string; counterOffer: boolean; proposedPrice: number | null }>;
  source(): 'hermes' | 'offline';
}
