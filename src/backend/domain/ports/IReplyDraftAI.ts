import type { BuyerIntent } from '../conversations/types';

// Deliberately has no floor price: the AI never sees the seller's limit.
export interface ReplyContext {
  threadId: string;
  product: { id: string; title: string; description: string; condition: string; price: number; currency: string };
  messages: Array<{ direction: 'buyer' | 'seller'; text: string }>;
}

export type ReplySource = 'hermes' | 'offline';

export interface ReplyClassification {
  intent: BuyerIntent;
  confidence: 'high' | 'medium' | 'low';
  source: ReplySource;
}

export interface ReplyDraftResult {
  reply: string;
  counterOffer: boolean;
  proposedPrice: number | null;
  source: ReplySource;
}

export interface IReplyDraftAI {
  classify(ctx: ReplyContext): Promise<ReplyClassification>;
  draft(ctx: ReplyContext, intent: BuyerIntent): Promise<ReplyDraftResult>;
}
