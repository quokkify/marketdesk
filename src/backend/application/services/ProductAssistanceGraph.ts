import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import type { ProductAIDraft, ProductAIDraftRequest, ProductRecheckResult, ProductImprovementSuggestions } from '../../../shared/types';
import type { IAIProvider } from '../../domain/ports/IAIProvider';
import { listingSeoOutputSchema } from '../../domain/agents/MarketDeskAgentCatalog';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import { NotFoundError } from '../../domain/shared/DomainError';
import type { ProductAIDraftService } from './ProductAIDraftService';
import type { ProductRecheckService, RecheckProductInput } from './ProductRecheckService';

export const PRODUCT_ASSISTANCE_GRAPH_VERSION = 'product-assistance@1';

const priceSuggestionSchema = z.object({
  suggestedPrice: z.number().finite().positive(),
  reasoning: z.string().trim().min(1).max(500),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();

type AssistanceInput =
  | { kind: 'draft'; workspaceId: string; request: ProductAIDraftRequest }
  | { kind: 'publication'; request: RecheckProductInput }
  | { kind: 'improve'; workspaceId: string; productId: string; listingId?: string };

type AssistanceResult = ProductAIDraft | ProductRecheckResult | ProductImprovementSuggestions;

const AssistanceState = Annotation.Root({
  input: Annotation<AssistanceInput>(),
  result: Annotation<AssistanceResult | undefined>(),
});

type GraphState = typeof AssistanceState.State;

// Hermes credentials stay in the injected provider adapter. Graph state contains
// only tenant-scoped IDs and review-only results, never API keys or tokens.
export class ProductAssistanceGraph {
  private readonly graph;

  constructor(
    private readonly drafts: ProductAIDraftService,
    private readonly recheckService: ProductRecheckService,
    private readonly products: IProductRepository,
    private readonly listings: IListingRepository,
    private readonly marketplaces: IMarketplaceRepository,
    private readonly ai: IAIProvider,
  ) {
    this.graph = new StateGraph(AssistanceState)
      .addNode('route', () => ({}))
      .addNode('draft', async (state: GraphState) => {
        if (state.input.kind !== 'draft') throw new Error('Invalid draft route');
        const result = await this.drafts.generateDraft({
          ...state.input.request, workspaceId: state.input.workspaceId,
        });
        if (result.isErr()) throw result.error;
        return { result: result.value };
      })
      .addNode('publication', async (state: GraphState) => {
        if (state.input.kind !== 'publication') throw new Error('Invalid publication route');
        return { result: await this.recheckService.recheck(state.input.request) };
      })
      .addNode('improve', async (state: GraphState) => {
        if (state.input.kind !== 'improve') throw new Error('Invalid improvement route');
        const { workspaceId, productId, listingId } = state.input;
        const product = await this.products.findByIdForWorkspace(productId, workspaceId);
        if (!product) throw new NotFoundError(`Product not found: ${productId}`);
        const listing = listingId
          ? await this.listings.findByIdForWorkspace(listingId, workspaceId)
          : null;
        if (listingId && (!listing || listing.productId !== productId)) {
          throw new NotFoundError(`Listing not found for product: ${listingId}`);
        }
        const marketplace = listing
          ? await this.marketplaces.findByIdForWorkspace(listing.marketplaceId, workspaceId)
          : null;
        if (listing && !marketplace) {
          throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
        }
        const seo = listingSeoOutputSchema.parse(await this.ai.analyzeListingSeo({
          product: {
            id: product.id, name: product.name, description: product.description,
            category: product.category, condition: product.condition,
            tags: [...product.tags], imageCount: product.imageCount,
          },
          listing: listing ? {
            id: listing.id, title: product.name, description: product.description,
            marketplace: marketplace!.key,
          } : null,
        }, 'balanced'));
        const price = listing ? priceSuggestionSchema.parse(await this.ai.suggestPrice({
          listing, recentViews: listing.views ?? 0, conversionRate: 0,
        })) : undefined;
        return { result: {
          graphVersion: PRODUCT_ASSISTANCE_GRAPH_VERSION,
          productId, productUpdatedAt: product.updatedAt.toISOString(),
          ...(listing ? { listingUpdatedAt: listing.updatedAt.toISOString() } : {}),
          reviewOnly: true as const, copy: seo.recommendations,
          ...(price ? { price } : {}),
        } };
      })
      .addEdge(START, 'route')
      .addConditionalEdges('route', (state: GraphState) => state.input.kind, {
        draft: 'draft', publication: 'publication', improve: 'improve',
      })
      .addEdge('draft', END)
      .addEdge('publication', END)
      .addEdge('improve', END)
      .compile();
  }

  async generateDraft(workspaceId: string, request: ProductAIDraftRequest): Promise<ProductAIDraft> {
    const state = await this.graph.invoke({ input: { kind: 'draft', workspaceId, request } });
    return state.result as ProductAIDraft;
  }

  async publicationReview(request: RecheckProductInput): Promise<ProductRecheckResult> {
    const state = await this.graph.invoke({ input: { kind: 'publication', request } });
    return state.result as ProductRecheckResult;
  }

  async proposeImprovements(input: {
    workspaceId: string; productId: string; listingId?: string;
  }): Promise<ProductImprovementSuggestions> {
    const state = await this.graph.invoke({ input: { kind: 'improve', ...input } });
    return state.result as ProductImprovementSuggestions;
  }
}
