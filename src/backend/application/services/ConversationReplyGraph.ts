import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { Product } from '../../domain/entities/Product';
import type { BuyerIntent, ConversationMessage, ConversationThread, ScreeningReason } from '../../domain/conversations/types';
import { normalizedTextHash, screenBuyerMessage, type ScreeningLimits } from '../../domain/conversations/screening';
import { fillPrice, validateDraft, type DraftRule } from '../../domain/conversations/draftValidation';
import type { IReplyDraftAI, ReplyContext, ReplyDraftResult } from '../../domain/ports/IReplyDraftAI';
import type { IConversationRepository } from '../../domain/repositories/interfaces/IConversationRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import { NotFoundError } from '../../domain/shared/DomainError';
import type { IdGenerator } from '../ports/IdGenerator';
import { withAiUsageScope } from '../ai/aiUsageScope';

export const CONVERSATION_REPLY_GRAPH_VERSION = 'conversation-reply@1';

const FLOOD_WINDOW_MS = 60 * 60 * 1000;
const REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type ReplyRunOutcome =
  | { kind: 'suspicious'; reasons: ScreeningReason[] }
  | { kind: 'drafted'; draftId: string }
  | { kind: 'no_safe_draft'; rule: DraftRule }
  | { kind: 'skipped'; reason: 'sold' | 'daily_cap' | 'not_latest' };

export interface ReplyTransition {
  node: 'screen' | 'classify' | 'draft' | 'validate';
  phase: 'started' | 'completed' | 'failed';
}

export interface ConversationReplyGraphDeps {
  conversations: IConversationRepository;
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  ai: IReplyDraftAI;
  limits: ScreeningLimits & { dailyRunCap: number; historyMessages: number };
  ids: IdGenerator;
  now: () => Date;
  observe?: (transition: ReplyTransition) => void;
}

const ReplyState = Annotation.Root({
  workspaceId: Annotation<string>(),
  threadId: Annotation<string>(),
  messageId: Annotation<string>(),
  intent: Annotation<BuyerIntent | undefined>(),
  outcome: Annotation<ReplyRunOutcome | undefined>(),
});

type GraphState = typeof ReplyState.State;

// Buyer and model text stay in this per-run context, outside graph state.
interface RunContext {
  thread: ConversationThread;
  product: Product;
  message: ConversationMessage & { text: string };
  history: ReplyContext['messages'];
  draft?: ReplyDraftResult;
}

// Durable multi-step negotiation: see #482 and its triggers.
export class ConversationReplyGraph {
  constructor(private readonly deps: ConversationReplyGraphDeps) {}

  async run(input: { workspaceId: string; threadId: string; messageId: string }): Promise<ReplyRunOutcome> {
    const { conversations, products, limits, now } = this.deps;
    const thread = await conversations.findThreadForWorkspace(input.threadId, input.workspaceId);
    if (!thread) throw new NotFoundError(`Conversation thread not found: ${input.threadId}`);
    if (thread.status === 'suspicious') return { kind: 'suspicious', reasons: thread.suspiciousReasons };
    const recent = await conversations.recentMessages(thread.id, limits.historyMessages);
    // Newest message of any direction: a later seller message means the buyer was already answered.
    const latest = recent[0];
    if (latest?.direction !== 'buyer' || latest.id !== input.messageId) {
      return { kind: 'skipped', reason: 'not_latest' };
    }
    if (latest.text === null) throw new Error(`Buyer message text is no longer stored: ${input.messageId}`);
    const product = await products.findByIdForWorkspace(thread.productId, input.workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${thread.productId}`);
    if (product.isSold()) return { kind: 'skipped', reason: 'sold' };
    const current = now();
    const dayStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
    if (await conversations.countReplyRunsToday(input.workspaceId, dayStart) >= limits.dailyRunCap) {
      return { kind: 'skipped', reason: 'daily_cap' };
    }

    const ctx: RunContext = {
      thread, product, message: { ...latest, text: latest.text },
      history: [...recent].reverse().flatMap((m) => (m.text === null ? [] : [{ direction: m.direction, text: m.text }])),
    };
    const { value } = await withAiUsageScope(
      { workspaceId: input.workspaceId, feature: 'reply', productId: product.id },
      () => this.compile(ctx).invoke({ ...input }),
    );
    if (!value.outcome) throw new Error('Conversation reply graph ended without an outcome');
    return value.outcome;
  }

  // Compiled per run so nodes close over the run context and graph state keeps ids only.
  private compile(ctx: RunContext) {
    const { conversations, ai, limits, now, observe } = this.deps;
    const traced = (
      node: ReplyTransition['node'],
      run: (state: GraphState) => Promise<Partial<GraphState>>,
    ) => async (state: GraphState): Promise<Partial<GraphState>> => {
      observe?.({ node, phase: 'started' });
      try {
        const update = await run(state);
        observe?.({ node, phase: 'completed' });
        return update;
      } catch (error) {
        observe?.({ node, phase: 'failed' });
        throw error;
      }
    };
    const replyContext = (): ReplyContext => ({
      threadId: ctx.thread.id,
      product: {
        id: ctx.product.id, title: ctx.product.name, description: ctx.product.description,
        condition: ctx.product.condition, price: ctx.product.sellingPrice.amount,
        currency: ctx.product.sellingPrice.currency,
      },
      messages: ctx.history,
    });

    return new StateGraph(ReplyState)
      .addNode('screen', traced('screen', async (state) => {
        const at = now().getTime();
        const [workspaceRepeatCount, threadMessagesLastHour] = await Promise.all([
          conversations.countTextHashInWorkspace(
            state.workspaceId, normalizedTextHash(ctx.message.text), new Date(at - REPEAT_WINDOW_MS),
          ),
          conversations.countBuyerMessagesSince(state.threadId, new Date(at - FLOOD_WINDOW_MS)),
        ]);
        const { reasons } = screenBuyerMessage(
          { text: ctx.message.text, workspaceRepeatCount, threadMessagesLastHour }, limits,
        );
        if (reasons.length === 0) return {};
        await conversations.upsertThread({
          workspaceId: ctx.thread.workspaceId, listingId: ctx.thread.listingId,
          productId: ctx.thread.productId, externalThreadId: ctx.thread.externalThreadId,
          status: 'suspicious', suspiciousReasons: reasons,
        });
        return { outcome: { kind: 'suspicious', reasons } };
      }))
      .addNode('classify', traced('classify', async () => {
        const { intent } = await ai.classify(replyContext());
        return { intent };
      }))
      .addNode('draft', traced('draft', async (state) => {
        if (!state.intent) throw new Error('Draft node reached without an intent');
        await conversations.supersedePendingDrafts(state.threadId);
        ctx.draft = await ai.draft(replyContext(), state.intent);
        return {};
      }))
      .addNode('validate', traced('validate', async (state) => {
        const draft = ctx.draft;
        if (!draft) throw new Error('Validate node reached without a draft');
        const floor = ctx.product.priceFloor().amount;
        const selling = ctx.product.sellingPrice.amount;
        const currency = ctx.product.sellingPrice.currency;
        const proposed = draft.counterOffer && draft.proposedPrice !== null ? draft.proposedPrice : selling;
        const filled = fillPrice(draft.reply, proposed, floor, selling);
        const check = validateDraft(filled.text, { floor, currency, filledPrice: filled.price });
        const base = {
          threadId: state.threadId, answersMessageId: state.messageId, intent: state.intent, source: draft.source,
        };
        if (!check.ok) {
          await conversations.insertDraft({ ...base, status: 'failed', failureReason: check.rule, proposedText: null });
          return { outcome: { kind: 'no_safe_draft', rule: check.rule } };
        }
        const stored = await conversations.insertDraft({
          ...base, status: 'pending', proposedText: filled.text, filledPrice: filled.price,
        });
        return { outcome: { kind: 'drafted', draftId: stored.id } };
      }))
      .addEdge(START, 'screen')
      .addConditionalEdges('screen', (state: GraphState) => (state.outcome ? 'end' : 'classify'), {
        end: END, classify: 'classify',
      })
      .addEdge('classify', 'draft')
      .addEdge('draft', 'validate')
      .addEdge('validate', END)
      .compile();
  }
}
