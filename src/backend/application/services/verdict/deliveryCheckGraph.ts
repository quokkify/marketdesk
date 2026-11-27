// The delivery check of the sale verdict. load: the run's OLX snapshot. categoryGate: a category out
// of sync with OLX or a category mismatch the owner has not kept stops the check. page: the delivery
// mode buyers see on the public advert page (null when the page cannot be read). propose (only when
// delivery is off in a category that offers it): a pending suggested_delivery proposal is linked as it
// is; a drifted advert gets no proposal; otherwise Hermes (when configured) picks a parcel size, and
// every package of that size becomes one pending proposal.
// result: the check. Nothing is written to OLX here.
// State holds only the delivery mode and event ids, never seller or Hermes text.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { HermesEventType, ParcelSize, VerdictCheck } from '../../../../shared/types';
import { HermesEvent } from '../../../domain/entities/HermesEvent';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import {
  ADVERT_DRIFTED,
  CATEGORY_OUT_OF_SYNC,
  blockedCheck,
  categoryFirstCheck,
  deliveryCheck,
  packagesForSize,
} from '../../../domain/services/advertCompletenessRules';
import type { IdFactory } from '../../../domain/services/proposalSupport';
import type { AITextCompletionClient } from '../../../infrastructure/external/HermesAI';
import { buildParcelSizePrompt, parseParcelSize } from '../../../infrastructure/external/advertFieldPrompts';
import { researchItemFromProduct } from '../../../infrastructure/external/priceResearchPrompts';
import { withAiOperation } from '../../ai/aiUsageScope';
import type { IOlxAdvertPage } from '../../ports/IOlxSearch';
import { categoryBlocks, requireOlxSnapshot, type OlxAdvertSnapshot } from './olxAdvertSnapshot';
import type { CheckContext, CheckGraph } from './SaleVerdictGraph';

const PROPOSAL_TYPE: HermesEventType = 'suggested_delivery';
const DELIVERY_ATTRIBUTE = 'delivery';

const DeliveryState = Annotation.Root({
  eventIds: Annotation<string[]>(),
  check: Annotation<VerdictCheck | null>(),
});

type DeliveryGraphState = typeof DeliveryState.State;

export interface DeliveryCheckDeps {
  page: IOlxAdvertPage;
  events: IEventRepository;
  hermes: AITextCompletionClient | null;
  idFactory: IdFactory;
  logger?: { warn(context: Record<string, unknown>, message: string): void };
}

export function buildDeliveryCheck(deps: DeliveryCheckDeps): CheckGraph {
  return async (ctx: CheckContext) => {
    const { workspace, product } = ctx;
    let snapshot: OlxAdvertSnapshot;

    const deliveryAttribute = () => snapshot.categoryAttributes.find((attribute) => attribute.code === DELIVERY_ATTRIBUTE);

    const page = async (): Promise<Partial<DeliveryGraphState>> => {
      const mode = snapshot.externalUrl ? await deps.page.deliveryMode(snapshot.externalUrl, ctx.signal) : null;
      return {
        check: deliveryCheck({
          mode,
          packageIds: snapshot.deliveryPackageIds,
          categoryOffersDelivery: deliveryAttribute() !== undefined,
          proposalOpen: false,
          now: ctx.now(),
          eventIds: [],
        }),
      };
    };

    const askSize = async (): Promise<ParcelSize | null> => {
      const client = deps.hermes;
      if (!client || !ctx.listing) return null;
      try {
        const { system, prompt } = buildParcelSizePrompt(researchItemFromProduct(product, ctx.listing));
        const raw = await withAiOperation('verdict.delivery', () => client.complete({ system, prompt, signal: ctx.signal }));
        return parseParcelSize(raw);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        deps.logger?.warn(
          { productId: product.id, errorName: error instanceof Error ? error.name : 'unknown' },
          'Hermes parcel size failed in the delivery check',
        );
        return null;
      }
    };

    const propose = async (): Promise<Partial<DeliveryGraphState>> => {
      // An open proposal waits for the owner: no new Hermes call and no replacement.
      const pending = await deps.events.findPendingByProduct(workspace.id, product.id, [PROPOSAL_TYPE]);
      if (pending.length > 0) return { eventIds: pending.map((event) => event.id) };
      if (snapshot.drifted) return { check: blockedCheck('delivery', ADVERT_DRIFTED, ctx.now()) };
      const attribute = deliveryAttribute();
      const size = await askSize();
      if (!attribute || !size || !ctx.listing) return {};
      const packageIds = packagesForSize(attribute, size);
      if (packageIds.length === 0) return {};
      const created = HermesEvent.create({
        id: deps.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        type: PROPOSAL_TYPE,
        severity: 'info',
        title: `Turn on Przesyłka OLX for parcel size ${size}`,
        proposedChange: { kind: 'delivery', listingId: ctx.listing.id, size, packageIds },
        status: 'pending_review',
        autonomyDecision: 'pending_review',
        source: 'hermes',
      });
      if (created.isErr()) throw created.error;
      await deps.events.save(created.value);
      return { eventIds: [created.value.id] };
    };

    const result = (state: DeliveryGraphState): Partial<DeliveryGraphState> => {
      if (!state.check) throw new Error('The delivery check has no verdict');
      return { check: { ...state.check, refs: { ...state.check.refs, eventIds: state.eventIds } } };
    };

    const graph = new StateGraph(DeliveryState)
      .addNode('load', async () => {
        snapshot = await requireOlxSnapshot(ctx);
        return {};
      })
      .addNode('categoryGate', async () => {
        if (snapshot.outOfSync) return { check: blockedCheck('delivery', CATEGORY_OUT_OF_SYNC, ctx.now()) };
        return (await categoryBlocks(deps.events, ctx, snapshot)) ? { check: categoryFirstCheck('delivery', ctx.now()) } : {};
      })
      .addNode('page', page)
      .addNode('propose', propose)
      .addNode('result', result)
      .addEdge(START, 'load')
      .addEdge('load', 'categoryGate')
      .addConditionalEdges('categoryGate', (state: DeliveryGraphState) => (state.check ? END : 'page'), ['page', END])
      .addConditionalEdges(
        'page',
        (state: DeliveryGraphState) => (state.check?.reasons[0]?.code === 'delivery_off' ? 'propose' : 'result'),
        ['propose', 'result'],
      )
      .addEdge('propose', 'result')
      .addEdge('result', END)
      .compile();
    const { check } = await graph.invoke({ eventIds: [], check: null });
    if (!check) throw new Error('The delivery check produced no result');
    return check;
  };
}
