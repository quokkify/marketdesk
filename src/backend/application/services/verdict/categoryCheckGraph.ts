// The category check of the sale verdict. load: the run's OLX snapshot. judge: the listing's
// category against OLX's suggestions for the title. propose (only on a mismatch): the existing
// olx_category_mismatch recommendation, targeting the top suggestion when the taxonomy verifies it.
// result: the check. Nothing is moved: the owner approves every category recreation.
// State holds only the verdict and event ids, never seller text.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { MarketplaceCategoryMetadata, VerdictCheck } from '../../../../shared/types';
import { categoryCheck } from '../../../domain/services/advertCompletenessRules';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import type { CategoryMismatchProposals } from '../CategoryMismatchProposals';
import { requireOlxSnapshot, type OlxAdvertSnapshot } from './olxAdvertSnapshot';
import type { CheckContext, CheckGraph } from './SaleVerdictGraph';

const CategoryState = Annotation.Root({
  mismatch: Annotation<boolean>(),
  eventIds: Annotation<string[]>(),
  check: Annotation<VerdictCheck | null>(),
});

type CategoryGraphState = typeof CategoryState.State;

export interface CategoryTaxonomy {
  verify(providerCategoryId: string): Promise<MarketplaceCategoryMetadata>;
}

export interface CategoryCheckDeps {
  proposals: Pick<CategoryMismatchProposals, 'raise'>;
  events: Pick<IEventRepository, 'findPendingByProduct'>;
  // The verified OLX taxonomy of the listing's marketplace.
  taxonomy: (marketplaceId: string) => Promise<CategoryTaxonomy>;
}

export function buildCategoryCheck(deps: CategoryCheckDeps): CheckGraph {
  return async (ctx: CheckContext) => {
    let snapshot: OlxAdvertSnapshot;

    const propose = async (): Promise<Partial<CategoryGraphState>> => {
      const { listing } = ctx;
      if (!listing) throw new Error('The category check needs a listing');
      const taxonomy = await deps.taxonomy(listing.marketplaceId);
      const topSuggestion = snapshot.suggestionIds[0];
      const proposedCategory = topSuggestion ? await taxonomy.verify(topSuggestion).catch(() => null) : null;
      const currentCategory = listing.marketplaceCategory ?? (await taxonomy.verify(snapshot.listingCategoryId));
      const event = await deps.proposals.raise({
        workspaceId: ctx.workspace.id,
        product: ctx.product,
        listing,
        currentCategory,
        proposedCategory,
      });
      if (event) return { eventIds: [event.id] };
      // The same recommendation is already open: link it.
      const pending = await deps.events.findPendingByProduct(ctx.workspace.id, ctx.product.id, ['olx_category_mismatch']);
      return { eventIds: pending.map((open) => open.id) };
    };

    const graph = new StateGraph(CategoryState)
      .addNode('load', async () => {
        snapshot = await requireOlxSnapshot(ctx);
        return {};
      })
      .addNode('judge', () => ({ mismatch: snapshot.categoryMismatch }))
      .addNode('propose', propose)
      .addNode('result', (state: CategoryGraphState) => ({
        check: categoryCheck({
          listingCategoryId: snapshot.listingCategoryId,
          suggestionIds: snapshot.suggestionIds,
          now: ctx.now(),
          eventIds: state.eventIds,
        }),
      }))
      .addEdge(START, 'load')
      .addEdge('load', 'judge')
      .addConditionalEdges('judge', (state: CategoryGraphState) => (state.mismatch ? 'propose' : 'result'), [
        'propose',
        'result',
      ])
      .addEdge('propose', 'result')
      .addEdge('result', END)
      .compile();
    const { check } = await graph.invoke({ mismatch: false, eventIds: [], check: null });
    if (!check) throw new Error('The category check produced no result');
    return check;
  };
}
