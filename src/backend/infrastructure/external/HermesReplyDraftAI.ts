// Hermes-backed buyer-reply drafting. The thread goes in as a <buyer_thread> data block, the
// answer is parsed against strict schemas, and no prompt or model text ever reaches an error.

import type { BuyerIntent } from '../../domain/conversations/types';
import type { IReplyDraftAI, ReplyClassification, ReplyContext, ReplyDraftResult } from '../../domain/ports/IReplyDraftAI';
import {
  buyerReplyProfile,
  replyClassifyOutputSchema,
  replyDraftOutputSchema,
  REPLY_INTENTS,
} from '../../domain/agents/buyerReplyProfile';
import { withAiOperation } from '../../application/ai/aiUsageScope';
import type { AITextCompletionClient } from './HermesAI';
import { BUYER_THREAD_RULE, buyerThreadBlock } from './buyerThread';
import { parseJsonObject } from './jsonText';

const MAX_TOKENS = 1024;

export class HermesReplyDraftAI implements IReplyDraftAI {
  constructor(private readonly client: AITextCompletionClient) {}

  async classify(ctx: ReplyContext): Promise<ReplyClassification> {
    const raw = await withAiOperation('replyClassify', () => this.client.complete({
      system: `${buyerReplyProfile.instruction()}\n${BUYER_THREAD_RULE}\nTask: classify the buyer's last message intent.`,
      prompt: buyerThreadBlock(ctx),
      maxTokens: MAX_TOKENS,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          intent: { type: 'string', enum: [...REPLY_INTENTS] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['intent', 'confidence'],
      },
      sessionKey: sessionKey(ctx),
    }));
    const parsed = replyClassifyOutputSchema.safeParse(parseJsonObject(raw));
    if (parsed.success) return { ...parsed.data, source: 'hermes' };
    throw new Error('Hermes buyer-reply classification failed strict schema validation');
  }

  async draft(
    ctx: ReplyContext,
    intent: BuyerIntent,
  ): Promise<ReplyDraftResult> {
    const raw = await withAiOperation('replyDraft', () => this.client.complete({
      system: `${buyerReplyProfile.instruction()}\n${BUYER_THREAD_RULE}\nTask: draft the seller's reply. The buyer's intent is: ${intent}.`,
      prompt: buyerThreadBlock(ctx),
      maxTokens: MAX_TOKENS,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reply: { type: 'string', minLength: 1, maxLength: 1000 },
          counterOffer: { type: 'boolean' },
          proposedPrice: { type: ['number', 'null'], exclusiveMinimum: 0 },
        },
        required: ['reply', 'counterOffer', 'proposedPrice'],
      },
      sessionKey: sessionKey(ctx),
    }));
    const parsed = replyDraftOutputSchema.safeParse(parseJsonObject(raw));
    if (parsed.success) return { ...parsed.data, source: 'hermes' };
    throw new Error('Hermes buyer-reply draft failed strict schema validation');
  }
}

function sessionKey(ctx: ReplyContext): string {
  return `marketdesk:buyer-reply:${ctx.threadId}`;
}
