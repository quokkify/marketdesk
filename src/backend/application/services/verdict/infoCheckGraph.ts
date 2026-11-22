// The info check of the sale verdict. codeChecks: with a listing, the Recheck checks
// (ProductRecheckService, reused); without one, condition, title length and description. seo (only
// when the workspace enables listing SEO and the run is not code-only): the listing SEO proposals,
// whose failure marks the check needs_human and keeps the code-check reasons. result: the check.
// State holds only app-authored check items and event ids, never seller or Hermes text.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { ProductRecheckItem, VerdictCheck } from '../../../../shared/types';
import type { Product } from '../../../domain/entities/Product';
import { infoCheckFromRecheck } from '../../../domain/services/saleVerdictRules';
import { fitsOlxTitle, missingFacts, OLX_TITLE_MAX_LENGTH } from '../../../domain/services/revivalRules';
import type { ProductRecheckService } from '../ProductRecheckService';
import type { ListingSeoProposals } from './ListingSeoProposals';
import type { CheckContext, CheckGraph } from './SaleVerdictGraph';

const SEO_FAILED = { code: 'check_failed', message: 'Listing suggestions could not be prepared, please review the listing manually' };

const InfoState = Annotation.Root({
  items: Annotation<ProductRecheckItem[]>(),
  seoFailed: Annotation<boolean>(),
  eventIds: Annotation<string[]>(),
  check: Annotation<VerdictCheck | null>(),
});

type InfoGraphState = typeof InfoState.State;

export interface InfoCheckDeps {
  recheck: Pick<ProductRecheckService, 'recheck'>;
  seo: Pick<ListingSeoProposals, 'propose'>;
  logger?: { warn(context: Record<string, unknown>, message: string): void };
}

// The checks a product without a listing can still pass or fail.
function unlistedItems(product: Product): ProductRecheckItem[] {
  const items: ProductRecheckItem[] = missingFacts(product)
    .filter((fact) => fact.required)
    .map((fact) => ({
      key: 'required_fields',
      status: 'fix',
      message: fact.note,
      ...(fact.field === 'condition' ? { editField: fact.field } : {}),
    }));
  if (!fitsOlxTitle(product.name)) {
    items.push({
      key: 'title',
      status: 'fix',
      message: `Shorten the title to ${OLX_TITLE_MAX_LENGTH} characters for OLX`,
      editField: 'name',
    });
  }
  if (product.description.trim().length === 0) {
    items.push({ key: 'description', status: 'fix', message: 'Add a description', editField: 'description' });
  }
  return items;
}

export function buildInfoCheck(deps: InfoCheckDeps): CheckGraph {
  return async (ctx: CheckContext) => {
    const graph = new StateGraph(InfoState)
      .addNode('codeChecks', async () => {
        if (!ctx.listing) return { items: unlistedItems(ctx.product) };
        const result = await deps.recheck.recheck({
          productId: ctx.product.id,
          listingId: ctx.listing.id,
          workspaceId: ctx.workspace.id,
        });
        return { items: result.items };
      })
      .addNode('seo', async () => {
        try {
          const events = await deps.seo.propose(ctx.workspace, ctx.product, ctx.listing);
          return { eventIds: events.map((event) => event.id) };
        } catch (error) {
          deps.logger?.warn({ productId: ctx.product.id, err: error }, 'Listing SEO proposals failed in the info check');
          return { seoFailed: true };
        }
      })
      .addNode('result', (state: InfoGraphState) => {
        const fromCode = infoCheckFromRecheck(state.items, ctx.now());
        const check: VerdictCheck = state.seoFailed
          ? { ...fromCode, status: 'needs_human', reasons: [...fromCode.reasons, { ...SEO_FAILED }] }
          : fromCode;
        return { check: { ...check, refs: { eventIds: state.eventIds } } };
      })
      .addEdge(START, 'codeChecks')
      .addConditionalEdges(
        'codeChecks',
        () => (ctx.workspace.listingSeoEnabled && !ctx.options.infoCodeOnly ? 'seo' : 'result'),
        ['seo', 'result'],
      )
      .addEdge('seo', 'result')
      .addEdge('result', END)
      .compile();
    const { check } = await graph.invoke({ items: [], seoFailed: false, eventIds: [], check: null });
    if (!check) throw new Error('The info check produced no result');
    return check;
  };
}
