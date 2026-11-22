import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import type {
  ProductAIDraft, ProductAIDraftRequest, RevivalAiStep, RevivalProposal,
} from '../../../shared/types';
import { OFFLINE_AI_NOTICE, type IAIProvider } from '../../domain/ports/IAIProvider';
import { listingSeoOutputSchema, type ListingSeoOutput } from '../../domain/agents/MarketDeskAgentCatalog';
import type { Product } from '../../domain/entities/Product';
import type { Listing } from '../../domain/entities/Listing';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IPriceResearchRepository } from '../../domain/repositories/interfaces/IPriceResearchRepository';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';
import { fitsOlxTitle, missingFacts, priceGuard, REVIVAL_REFUSAL_MESSAGE } from '../../domain/services/revivalRules';
import type { ProductAIDraftService, ProductDraftLogger } from './ProductAIDraftService';
import { withAiUsageScope } from '../ai/aiUsageScope';

export const PRODUCT_ASSISTANCE_GRAPH_VERSION = 'product-assistance@1';

interface StoredPrice {
  suggestedPrice: number;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

// Names the failure without Hermes text: a schema failure gives only the paths it failed at.
function describeFailure(error: unknown): { name: string; message: string } {
  if (error instanceof z.ZodError) {
    return { name: 'ZodError', message: `Invalid output at ${error.issues.map((i) => i.path.join('.') || '(root)').join(', ')}` };
  }
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Unknown', message: 'Non-error value thrown' };
}

type AssistanceInput =
  | { kind: 'draft'; workspaceId: string; request: ProductAIDraftRequest }
  | { kind: 'revive'; workspaceId: string; listingId: string };

type AssistanceResult = ProductAIDraft | RevivalProposal;

const AssistanceState = Annotation.Root({
  input: Annotation<AssistanceInput>(),
  result: Annotation<AssistanceResult | undefined>(),
});

type GraphState = typeof AssistanceState.State;

export interface AssistanceTransition {
  node: 'route' | 'draft' | 'revive';
  phase: 'started' | 'completed' | 'failed';
}

// Hermes credentials stay in the injected provider adapter. Graph state contains
// only tenant-scoped IDs and review-only results, never API keys or tokens.
export class ProductAssistanceGraph {
  private readonly graph;

  constructor(
    private readonly drafts: Pick<ProductAIDraftService, 'generateDraft'>,
    private readonly products: Pick<IProductRepository, 'findByIdForWorkspace'>,
    private readonly listings: Pick<IListingRepository, 'findByIdForWorkspace'>,
    private readonly marketplaces: Pick<IMarketplaceRepository, 'findByIdForWorkspace'>,
    private readonly research: Pick<IPriceResearchRepository, 'findByProduct'>,
    private readonly ai: Pick<IAIProvider, 'analyzeListingSeo'>,
    observe?: (transition: AssistanceTransition) => void,
    // logger: the container's, for the Hermes steps a revival proposal survives without.
    private readonly options: { logger?: ProductDraftLogger } = {},
  ) {
    // The observer receives node lifecycle only, never graph state or error text.
    const traced = (
      node: AssistanceTransition['node'],
      run: (state: GraphState) => Promise<Partial<GraphState>> | Partial<GraphState>,
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
    this.graph = new StateGraph(AssistanceState)
      .addNode('route', traced('route', () => ({})))
      .addNode('draft', traced('draft', async (state: GraphState) => {
        if (state.input.kind !== 'draft') throw new Error('Invalid draft route');
        const result = await this.drafts.generateDraft({
          ...state.input.request, workspaceId: state.input.workspaceId,
        });
        if (result.isErr()) throw result.error;
        return { result: result.value };
      }))
      .addNode('revive', traced('revive', async (state: GraphState) => {
        if (state.input.kind !== 'revive') throw new Error('Invalid revival route');
        const { workspaceId, listingId } = state.input;
        const listing = await this.listings.findByIdForWorkspace(listingId, workspaceId);
        if (!listing) throw new NotFoundError(`Listing not found: ${listingId}`);
        const marketplace = await this.marketplaces.findByIdForWorkspace(listing.marketplaceId, workspaceId);
        if (!marketplace) throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
        if (listing.status !== 'expired' || !listing.marketplaceListingId || marketplace.key !== 'olx') {
          throw new InvalidStateError(REVIVAL_REFUSAL_MESSAGE);
        }
        const product = await this.products.findByIdForWorkspace(listing.productId, workspaceId);
        if (!product) throw new NotFoundError(`Product not found: ${listing.productId}`);
        // Each Hermes call may fail on its own (unreachable, refused, invalid output); the proposal
        // then lacks that part, names it in aiIssues so it does not read as "Hermes proposes no
        // change", and still gives the missing facts and the price guard.
        const aiIssues: RevivalAiStep[] = [];
        const attempt = async <T>(step: RevivalAiStep, run: () => Promise<T>): Promise<T | null> => {
          try {
            return await run();
          } catch (error) {
            aiIssues.push(step);
            this.options.logger?.warn(
              { step, listingId: listing.id, error: describeFailure(error) },
              'Revival proposal step failed',
            );
            return null;
          }
        };
        const { value: seo, usage } = await withAiUsageScope(
          { workspaceId, feature: 'revive', productId: product.id },
          () => attempt('copy', () => this.listingSeo(product, { listing, marketplace })),
        );
        // The price is the stored research estimate; no research run is requested for a proposal.
        const price = await attempt('price', () => this.storedPrice(product));
        if (!price && !aiIssues.includes('price')) aiIssues.push('price');
        // Offline heuristics are no proposal to bring an advert back with: only Hermes output is offered.
        const hermesSeo = seo && !seo.disclaimer.includes(OFFLINE_AI_NOTICE) ? seo : null;
        const hermesPrice = price && !price.reasoning.includes(OFFLINE_AI_NOTICE) ? price : null;
        const proposeCopy = (field: 'title' | 'description', current: string) => {
          const recommendation = hermesSeo?.recommendations.find((r) => r.field === field);
          return recommendation
            ? { current, proposed: recommendation.proposedValue, rationale: recommendation.rationale }
            : undefined;
        };
        // An over-long title is dropped without an aiIssue: Hermes answered, the title is just unusable.
        const proposedTitle = proposeCopy('title', product.name);
        const title = proposedTitle && fitsOlxTitle(proposedTitle.proposed) ? proposedTitle : undefined;
        const description = proposeCopy('description', product.description);
        const costPrice = product.costPrice?.amount ?? null;
        const result: RevivalProposal = {
          listingId: listing.id,
          productId: product.id,
          productUpdatedAt: product.updatedAt.toISOString(),
          listingUpdatedAt: listing.updatedAt.toISOString(),
          missingFacts: missingFacts(product),
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
          ...(hermesPrice ? { price: {
            current: listing.price.amount, proposed: hermesPrice.suggestedPrice,
            currency: listing.price.currency, rationale: hermesPrice.reasoning,
          } } : {}),
          currentPrice: listing.price.amount,
          productSellingPrice: product.sellingPrice.amount,
          priceGuard: priceGuard(hermesPrice?.suggestedPrice ?? null, costPrice),
          aiIssues,
          aiUsage: usage,
        };
        return { result };
      }))
      .addEdge(START, 'route')
      .addConditionalEdges('route', (state: GraphState) => state.input.kind, {
        draft: 'draft', revive: 'revive',
      })
      .addEdge('draft', END)
      .addEdge('revive', END)
      .compile();
  }

  private async listingSeo(
    product: Product,
    published: { listing: Listing; marketplace: Marketplace } | null,
  ): Promise<ListingSeoOutput> {
    return listingSeoOutputSchema.parse(await this.ai.analyzeListingSeo({
      product: {
        id: product.id, name: product.name, description: product.description,
        category: product.category, condition: product.condition,
        tags: [...product.tags], imageCount: product.imageCount,
      },
      listing: published ? {
        id: published.listing.id, title: product.name, description: product.description,
        marketplace: published.marketplace.key,
      } : null,
    }, 'balanced'));
  }

  private async storedPrice(product: Product): Promise<StoredPrice | null> {
    const stored = (await this.research.findByProduct(product.workspaceId, product.id))?.lastEstimate;
    // An estimate the price check hides (low confidence, within the threshold) is no proposal either.
    if (!stored || stored.hiddenReason !== null) return null;
    const { startPrice, reasoning, confidence } = stored.estimate;
    return { suggestedPrice: startPrice, reasoning, confidence };
  }

  async generateDraft(workspaceId: string, request: ProductAIDraftRequest): Promise<ProductAIDraft> {
    const state = await this.graph.invoke({ input: { kind: 'draft', workspaceId, request } });
    return state.result as ProductAIDraft;
  }

  async proposeRevival(input: { workspaceId: string; listingId: string }): Promise<RevivalProposal> {
    const state = await this.graph.invoke({ input: { kind: 'revive', ...input } });
    return state.result as RevivalProposal;
  }
}
