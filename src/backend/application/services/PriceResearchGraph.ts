// Researches the price anchor ladder of a product as a LangGraph graph of narrow calls to the
// web-enabled Hermes research profile: identify the model and its class (one retry), then one call
// per tier in parallel, then code checks (row filter, class, price sanity) and one locked save.
// The research profile is checked before every call and must enable exactly the web toolset.
// Only sanitized item fields reach a prompt (researchItemFromProduct); seller free text never does.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { AnchorTier, PriceComparable, PriceResearch } from '../../../shared/types';
import type { Product } from '../../domain/entities/Product';
import type { Listing } from '../../domain/entities/Listing';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IPriceResearchRepository } from '../../domain/repositories/interfaces/IPriceResearchRepository';
import type { AITextCompletionClient } from '../../infrastructure/external/HermesAI';
import type { HermesReachability } from '../../infrastructure/external/HermesHealthProbe';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../domain/shared/DomainError';
import { filterAnchorRows, isResearchToolsetSafe } from '../../infrastructure/external/anchorLadderPrompt';
import {
  buildIdentifyPrompt,
  buildTierPrompt,
  parseClassAttributes,
  parseIdentification,
  parseTierAnchors,
  researchItemFromProduct,
  type Identification,
  type ResearchItem,
  type ResearchNode,
} from '../../infrastructure/external/priceResearchPrompts';
import { mergeLadder } from '../../domain/services/anchorLadder';
import { applyClassFilter } from '../../domain/services/classMatch';
import { applyPriceSanity } from '../../domain/services/priceSanity';
import { withAiOperation, withAiUsageScope } from '../ai/aiUsageScope';
import type { ResearchCallLimiter } from './researchCallLimiter';

export const SEARCH_NOT_CONFIGURED = 'Market search is not configured';
export const SEARCH_NEEDS_PLN = 'OLX search needs a PLN listing';
export const SEARCH_UNUSABLE = 'Hermes returned no usable results';

const SEARCH_CURRENCY = 'PLN';
const AI_FEATURE = 'research';
const IDENTIFY_ATTEMPTS = 2;
const RUN_BUDGET_ENDED = 'The research run budget ended';

type TierNode = Exclude<ResearchNode, 'identify'>;

const TIER_OF: Record<TierNode, AnchorTier> = {
  sameModelUsed: 'same_model_used',
  lastNewPrice: 'last_new_price',
  substitutesNew: 'substitute_new',
  substitutesUsed: 'substitute_used',
};
const TIER_NODES = Object.keys(TIER_OF) as TierNode[];
const ALL_NODES: ResearchNode[] = ['identify', ...TIER_NODES];
const SUBSTITUTE_TIERS: ReadonlySet<AnchorTier> = new Set(['substitute_new', 'substitute_used']);

export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'timeout';
export type RunOutcome = 'ok' | 'partial' | 'failed';
export type ResearchErrorCode =
  | 'research_unreachable'
  | 'unsafe_toolset'
  | 'hermes_unavailable'
  | 'unusable_answer'
  | 'timeout'
  | 'all_tiers_failed'
  | 'no_substitutes';

export interface GraphResult {
  outcome: RunOutcome;
  nodes: Record<ResearchNode, NodeStatus>;
  failedTiers: AnchorTier[];
  errorCode: ResearchErrorCode | null;
  research: PriceResearch | null;
  rowsChanged: boolean;
}

export interface ComparableResearchProfile {
  client: AITextCompletionClient;
  // A fresh answer for every call: the guard must not act on a cached toolset list.
  checkProfile(): Promise<Pick<HermesReachability, 'reachable' | 'enabledToolsets'>>;
}

// Structural, so the container can pass its logger.
export interface ResearchGraphLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface PriceResearchGraphDeps {
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByProduct'>;
  research: Pick<IPriceResearchRepository, 'saveLadderLocked'>;
  profile: ComparableResearchProfile | null;
  limiter: ResearchCallLimiter;
  now: () => Date;
  logger?: ResearchGraphLogger;
}

export interface ResearchRunInput {
  workspaceId: string;
  productId: string;
  // The run budget: aborting it aborts the calls in flight and ends the nodes not finished.
  signal: AbortSignal;
  onNode: (node: ResearchNode, status: NodeStatus) => Promise<void>;
}

// A node's failure, named by a code; the message never carries Hermes text.
class NodeFailure extends Error {
  constructor(readonly code: ResearchErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'NodeFailure';
  }
}

function asFailure(error: unknown): NodeFailure {
  return error instanceof NodeFailure ? error : new NodeFailure('unusable_answer', 'The research answer was unusable', error);
}

// Settles with work, or rejects as soon as the run budget ends, even if work ignores the signal.
function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new NodeFailure('timeout', RUN_BUDGET_ENDED));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new NodeFailure('timeout', RUN_BUDGET_ENDED));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

interface RunContext {
  workspaceId: string;
  product: Product;
  listing: Listing;
  item: ResearchItem;
  identifyPrompt: { system: string; prompt: string };
  profile: ComparableResearchProfile;
  signal: AbortSignal;
  onNode: ResearchRunInput['onNode'];
  nodes: Record<ResearchNode, NodeStatus>;
}

const ResearchState = Annotation.Root({
  ident: Annotation<Identification | null>(),
  errorCode: Annotation<ResearchErrorCode | null>(),
  // Raw anchors per tier node that answered; parallel nodes merge their own key in.
  found: Annotation<Partial<Record<TierNode, unknown[]>>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  rows: Annotation<PriceComparable[]>(),
  outcome: Annotation<RunOutcome>(),
  research: Annotation<PriceResearch | null>(),
  rowsChanged: Annotation<boolean>(),
});

type ResearchGraphState = typeof ResearchState.State;

export class PriceResearchGraph {
  constructor(private readonly deps: PriceResearchGraphDeps) {}

  // Not found, not configured, not PLN and a name with nothing left to search are thrown before any call.
  async run(input: ResearchRunInput): Promise<GraphResult> {
    const { workspaceId, productId } = input;
    const product = await this.deps.products.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    const profile = this.deps.profile;
    if (!profile) throw new ServiceUnavailableError(SEARCH_NOT_CONFIGURED);
    const listing = (await this.deps.listings.findByProduct(product.id))[0];
    if (!listing || listing.price.currency !== SEARCH_CURRENCY) throw new ValidationError(SEARCH_NEEDS_PLN);
    const item = researchItemFromProduct(product, listing);

    const ctx: RunContext = {
      workspaceId,
      product,
      listing,
      item,
      identifyPrompt: buildIdentifyPrompt(item),
      profile,
      signal: input.signal,
      onNode: input.onNode,
      nodes: Object.fromEntries(ALL_NODES.map((node) => [node, 'pending'])) as Record<ResearchNode, NodeStatus>,
    };
    const state = await this.build(ctx).invoke({
      ident: null, errorCode: null, rows: [], outcome: 'failed', research: null, rowsChanged: false,
    });

    if (ctx.signal.aborted) {
      for (const node of ALL_NODES) {
        if (ctx.nodes[node] === 'pending' || ctx.nodes[node] === 'running') await this.mark(ctx, node, 'timeout');
      }
    }
    return {
      outcome: state.outcome,
      nodes: { ...ctx.nodes },
      failedTiers: TIER_NODES
        .filter((node) => ctx.nodes[node] === 'failed' || ctx.nodes[node] === 'timeout')
        .map((node) => TIER_OF[node]),
      errorCode: state.outcome === 'failed' ? state.errorCode : null,
      research: state.research,
      rowsChanged: state.rowsChanged,
    };
  }

  private build(ctx: RunContext) {
    const tierNode = (node: TierNode) => async (state: ResearchGraphState): Promise<Partial<ResearchGraphState>> => {
      await this.mark(ctx, node, 'running');
      let anchors: unknown[] | null = null;
      let failure: NodeFailure | null = null;
      try {
        const ident = state.ident;
        if (!ident) throw new NodeFailure('unusable_answer', 'No identification to search with');
        anchors = parseTierAnchors(await this.call(ctx, node, buildTierPrompt(node, ctx.item, ident)));
        if (!anchors) throw new NodeFailure('unusable_answer', 'The tier answer holds no anchors');
      } catch (error) {
        failure = asFailure(error);
        this.logFailure(ctx, node, failure);
      }
      if (anchors) {
        await this.mark(ctx, node, 'done');
        return { found: { [node]: anchors } };
      }
      await this.mark(ctx, node, failure?.code === 'timeout' ? 'timeout' : 'failed');
      return {};
    };

    return new StateGraph(ResearchState)
      .addNode('identify', async () => this.identify(ctx))
      .addNode('sameModelUsed', tierNode('sameModelUsed'))
      .addNode('lastNewPrice', tierNode('lastNewPrice'))
      .addNode('substitutesNew', tierNode('substitutesNew'))
      .addNode('substitutesUsed', tierNode('substitutesUsed'))
      .addNode('filter', (state: ResearchGraphState) => this.filter(ctx, state))
      .addNode('save', (state: ResearchGraphState) => this.save(ctx, state))
      .addEdge(START, 'identify')
      .addConditionalEdges('identify', (state: ResearchGraphState) => (state.ident ? TIER_NODES : END), [
        ...TIER_NODES,
        END,
      ])
      .addEdge(TIER_NODES, 'filter')
      .addConditionalEdges('filter', (state: ResearchGraphState) => (state.outcome === 'failed' ? END : 'save'), [
        'save',
        END,
      ])
      .addEdge('save', END)
      .compile();
  }

  private async identify(ctx: RunContext): Promise<Partial<ResearchGraphState>> {
    await this.mark(ctx, 'identify', 'running');
    let ident: Identification | null = null;
    let failure = new NodeFailure('unusable_answer', 'Identify was not attempted');
    for (let attempt = 1; attempt <= IDENTIFY_ATTEMPTS && !ident; attempt += 1) {
      try {
        ident = parseIdentification(await this.call(ctx, 'identify', ctx.identifyPrompt));
        if (!ident) throw new NodeFailure('unusable_answer', 'The identify answer holds no identification');
      } catch (error) {
        failure = asFailure(error);
        this.logFailure(ctx, 'identify', failure, attempt);
        if (failure.code === 'timeout') break;
      }
    }
    if (ident) {
      await this.mark(ctx, 'identify', 'done');
      return { ident };
    }
    await this.mark(ctx, 'identify', failure.code === 'timeout' ? 'timeout' : 'failed');
    return { ident: null, errorCode: failure.code };
  }

  // Code checks on the tiers that answered: row filter (dismissals come at save time, under the
  // lock), class, price sanity. Then the outcome: partial counts only with class-checked substitutes.
  private filter(ctx: RunContext, state: ResearchGraphState): Partial<ResearchGraphState> {
    const answered = TIER_NODES.filter((node) => state.found[node] !== undefined);
    if (answered.length === 0) {
      return { outcome: 'failed', errorCode: ctx.signal.aborted ? 'timeout' : 'all_tiers_failed', rows: [] };
    }
    const items = answered.flatMap((node) => (state.found[node] ?? []).map((item) => asTierItem(item, TIER_OF[node])));
    const filtered = filterAnchorRows(items, {
      currency: SEARCH_CURRENCY,
      ownUrl: ctx.listing.externalUrl,
      dismissed: new Set(),
      today: this.deps.now().toISOString().slice(0, 10),
    });
    const rows = applyPriceSanity(applyClassFilter(filtered, state.ident?.classAttributes ?? []), SEARCH_CURRENCY);
    if (answered.length === TIER_NODES.length) return { outcome: 'ok', rows };
    const substitutes = rows.some((row) => row.tier && SUBSTITUTE_TIERS.has(row.tier) && row.classChecked === true);
    return substitutes ? { outcome: 'partial', rows } : { outcome: 'failed', errorCode: 'no_substitutes', rows };
  }

  // Merges into the rows and dismissals read under the lock: edits made during the run survive, and
  // the stored rows of a tier that did not answer stay as they are.
  private async save(ctx: RunContext, state: ResearchGraphState): Promise<Partial<ResearchGraphState>> {
    const keepTiers = new Set(TIER_NODES.filter((node) => state.found[node] === undefined).map((node) => TIER_OF[node]));
    const specs = state.ident?.specs || null;
    let rowsChanged = false;
    const research = await this.deps.research.saveLadderLocked(ctx.workspaceId, ctx.product.id, (current) => {
      const existing = current?.comparables ?? [];
      const dismissed = new Set(current?.dismissedUrls ?? []);
      const found = state.rows.filter((row) => !row.url || !dismissed.has(row.url));
      const kept = existing.filter((row) => row.source === 'auto' && row.tier && keepTiers.has(row.tier));
      const comparables = mergeLadder(existing, [...kept, ...found]);
      rowsChanged = JSON.stringify(comparables) !== JSON.stringify(existing);
      if (!rowsChanged && specs === (current?.specs ?? null)) return null;
      return { comparables, specs };
    });
    return { research, rowsChanged };
  }

  private async call(ctx: RunContext, node: ResearchNode, request: { system: string; prompt: string }): Promise<string> {
    const { profile, signal } = ctx;
    return untilAborted(signal, this.deps.limiter.run(async () => {
      if (signal.aborted) throw new NodeFailure('timeout', RUN_BUDGET_ENDED);
      const reachability = await profile.checkProfile();
      if (!reachability.reachable) {
        throw new NodeFailure('research_unreachable', 'Market search is unavailable: the research profile is not reachable');
      }
      if (!isResearchToolsetSafe(reachability.enabledToolsets)) {
        const enabled = reachability.enabledToolsets.length ? reachability.enabledToolsets.join(', ') : 'none';
        throw new NodeFailure(
          'unsafe_toolset',
          `Market search is unavailable: the research profile must enable only the web toolset (enabled: ${enabled})`,
        );
      }
      try {
        const { value } = await withAiUsageScope(
          { workspaceId: ctx.workspaceId, feature: AI_FEATURE, productId: ctx.product.id },
          () => withAiOperation(`research.${node}`, () => profile.client.complete({ ...request, signal })),
        );
        return value;
      } catch (error) {
        if (signal.aborted) throw new NodeFailure('timeout', RUN_BUDGET_ENDED, error);
        if (error instanceof ServiceUnavailableError) {
          throw new NodeFailure('hermes_unavailable', 'The research profile did not answer', error);
        }
        throw new NodeFailure('unusable_answer', 'The research answer was unusable', error);
      }
    }));
  }

  private async mark(ctx: RunContext, node: ResearchNode, status: NodeStatus): Promise<void> {
    ctx.nodes[node] = status;
    await ctx.onNode(node, status);
  }

  private logFailure(ctx: RunContext, node: ResearchNode, failure: NodeFailure, attempt?: number): void {
    this.deps.logger?.warn(
      { productId: ctx.product.id, node, attempt, code: failure.code, err: failure.cause ?? failure },
      'Price research node failed',
    );
  }
}

// The node decides the tier; the attributes are parsed here, and a list with nothing usable counts as none.
function asTierItem(item: unknown, tier: AnchorTier): unknown {
  if (typeof item !== 'object' || item === null) return item;
  const { classAttributes } = item as Record<string, unknown>;
  return {
    ...item,
    tier,
    classAttributes: Array.isArray(classAttributes) ? parseClassAttributes(classAttributes) : undefined,
  };
}
