// The sale verdict: is a product ready to sell. load (product, its primary listing, marketplace,
// workspace) → route fans out to the checks in the run's scope, which run in parallel as
// self-contained subgraphs → combine folds the fresh checks over the latest stored verdict, so a
// check outside the scope keeps its stored result and checkedAt → save completes the run.
// The category, attributes and delivery checks need a live OLX advert: without one they leave the
// scope and their stored results are dropped. They share one OLX snapshot per run.
// A check that throws becomes check_failed and does not fail the verdict. Every AI call inside is
// attributed to the 'verdict' feature. State holds only check results; the observer sees node
// lifecycle only.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { SaleVerdict, VerdictCheck, VerdictCheckName } from '../../../../shared/types';
import type { Product } from '../../../domain/entities/Product';
import type { Listing } from '../../../domain/entities/Listing';
import type { Marketplace } from '../../../domain/entities/Marketplace';
import type { IMarketplaceAdapter } from '../../../domain/services/MarketplaceAdapter';
import type { Workspace } from '../../../domain/entities/Workspace';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IWorkspaceRepository } from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import type {
  CompletedVerdictFields,
  ISaleVerdictRepository,
} from '../../../domain/repositories/interfaces/ISaleVerdictRepository';
import { NotFoundError } from '../../../domain/shared/DomainError';
import {
  checkFailed,
  combineVerdict,
  LIVE_OLX_CHECKS,
  liveOlxScope,
} from '../../../domain/services/saleVerdictRules';
import { withAiUsageScope } from '../../ai/aiUsageScope';
import { offersAdvertFields, olxAdvertSnapshotLoader, type OlxAdvertSnapshot } from './olxAdvertSnapshot';

export const SALE_VERDICT_GRAPH_VERSION = 'sale-verdict@1';
const AI_FEATURE = 'verdict';
const CHECK_NAMES: VerdictCheckName[] = ['info', 'price', 'photos', 'category', 'attributes', 'delivery'];

export interface CheckOptions {
  // Research even when the schedule says it is not due.
  forceResearch: boolean;
  // The info check without its Hermes call.
  infoCodeOnly: boolean;
  // The queued research run this verdict run executes instead of recording a new one.
  researchRunId?: string;
}

export interface CheckContext {
  workspace: Workspace;
  product: Product;
  listing: Listing | null;
  marketplace: Marketplace | null;
  now: () => Date;
  options: CheckOptions;
  // The verdict run; absent for the synchronous Recheck's info check.
  runId?: string;
  // The verdict run's budget.
  signal: AbortSignal;
  // The run's OLX snapshot, read once; null without a live OLX advert.
  olx: (() => Promise<OlxAdvertSnapshot>) | null;
}

export type CheckGraph = (ctx: CheckContext) => Promise<VerdictCheck>;

export interface VerdictTransition {
  node: 'load' | 'route' | VerdictCheckName | 'combine' | 'save';
  phase: 'started' | 'completed' | 'failed';
}

// Structural, so the container can pass its logger.
export interface SaleVerdictGraphLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface SaleVerdictGraphDeps {
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByProduct'>;
  marketplaces: Pick<IMarketplaceRepository, 'findByIdForWorkspace'>;
  workspaces: Pick<IWorkspaceRepository, 'findById'>;
  verdicts: ISaleVerdictRepository;
  checks: Record<VerdictCheckName, CheckGraph>;
  // The authenticated adapter for an existing advert; without it the OLX checks never run.
  adapters?: { resolve(marketplace: Marketplace): Promise<IMarketplaceAdapter> };
  now: () => Date;
  observe?: (transition: VerdictTransition) => void;
  logger?: SaleVerdictGraphLogger;
}

export interface SaleVerdictRunInput {
  workspaceId: string;
  productId: string;
  runId: string;
  scope: VerdictCheckName[];
  options?: Partial<CheckOptions>;
  signal: AbortSignal;
}

const VerdictState = Annotation.Root({
  // Fresh results of the checks that ran; parallel checks append their own.
  fresh: Annotation<VerdictCheck[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  combined: Annotation<CompletedVerdictFields | null>(),
  verdict: Annotation<SaleVerdict | null>(),
});

type VerdictGraphState = typeof VerdictState.State;

export class SaleVerdictGraph {
  constructor(private readonly deps: SaleVerdictGraphDeps) {}

  // A missing product or workspace, or a run no longer active, is thrown: the caller fails the run.
  async run(input: SaleVerdictRunInput): Promise<SaleVerdict> {
    const { workspaceId, productId, runId } = input;
    const ctx = await this.step('load', () => this.load(input));
    const scope = liveOlxScope(
      CHECK_NAMES.filter((name) => input.scope.includes(name)),
      ctx.olx !== null,
    );
    await this.deps.verdicts.setListing(runId, ctx.listing?.id ?? null);

    const { value: state } = await withAiUsageScope({ workspaceId, feature: AI_FEATURE, productId }, () =>
      this.build(ctx, scope, runId).invoke({ fresh: [], combined: null, verdict: null }),
    );
    if (!state.verdict) throw new Error('The sale verdict run produced no verdict');
    return state.verdict;
  }

  private async load(input: SaleVerdictRunInput): Promise<CheckContext> {
    const product = await this.deps.products.findByIdForWorkspace(input.productId, input.workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${input.productId}`);
    const workspace = await this.deps.workspaces.findById(input.workspaceId);
    if (!workspace) throw new NotFoundError(`Workspace not found: ${input.workspaceId}`);
    const listing = (await this.deps.listings.findByProduct(product.id))[0] ?? null;
    const marketplace = listing
      ? await this.deps.marketplaces.findByIdForWorkspace(listing.marketplaceId, input.workspaceId)
      : null;
    return {
      workspace,
      product,
      listing,
      marketplace,
      now: this.deps.now,
      options: { forceResearch: false, infoCodeOnly: false, ...input.options },
      runId: input.runId,
      signal: input.signal,
      olx: await this.olxSnapshot(product, listing, marketplace),
    };
  }

  // A failed adapter lookup still means a live advert: the loader then rejects, and each OLX
  // check is recorded as check_failed instead of silently leaving the verdict.
  private async olxSnapshot(
    product: Product,
    listing: Listing | null,
    marketplace: Marketplace | null,
  ): Promise<CheckContext['olx']> {
    const externalListingId = listing?.marketplaceListingId;
    if (!this.deps.adapters || !listing || !marketplace || !listing.isLive() || !externalListingId) return null;
    let adapter: IMarketplaceAdapter;
    try {
      adapter = await this.deps.adapters.resolve(marketplace);
    } catch (error) {
      const failed = Promise.reject(error);
      failed.catch(() => undefined);
      return () => failed;
    }
    if (!offersAdvertFields(adapter)) return null;
    return olxAdvertSnapshotLoader(adapter, listing, externalListingId, product.name);
  }

  private build(ctx: CheckContext, scope: VerdictCheckName[], runId: string) {
    const checkNode = (name: VerdictCheckName) => async (): Promise<Partial<VerdictGraphState>> => {
      this.observe(name, 'started');
      try {
        const check = await this.deps.checks[name](ctx);
        this.observe(name, 'completed');
        return { fresh: [check] };
      } catch (error) {
        this.observe(name, 'failed');
        this.deps.logger?.warn({ productId: ctx.product.id, runId, check: name, err: error }, 'Sale verdict check failed');
        return { fresh: [checkFailed(name, ctx.now())] };
      }
    };

    let graph = new StateGraph(VerdictState)
      .addNode('info', checkNode('info'))
      .addNode('price', checkNode('price'))
      .addNode('photos', checkNode('photos'))
      .addNode('category', checkNode('category'))
      .addNode('attributes', checkNode('attributes'))
      .addNode('delivery', checkNode('delivery'))
      .addNode('combine', (state: VerdictGraphState) => this.step('combine', () => this.combine(ctx, state)))
      .addNode('save', (state: VerdictGraphState) => this.step('save', () => this.save(ctx, runId, scope, state)))
      .addConditionalEdges(
        START,
        () => {
          this.observe('route', 'started');
          this.observe('route', 'completed');
          return scope.length > 0 ? scope : ['combine'];
        },
        [...CHECK_NAMES, 'combine'],
      );
    for (const name of CHECK_NAMES) graph = graph.addEdge(name, 'combine');
    return graph.addEdge('combine', 'save').addEdge('save', END).compile();
  }

  private async combine(ctx: CheckContext, state: VerdictGraphState): Promise<Partial<VerdictGraphState>> {
    const previous = (await this.deps.verdicts.findLatestCompleted(ctx.workspace.id, ctx.product.id))?.checks ?? {};
    const { checks, overall } = combineVerdict(state.fresh, previous, ctx.olx === null ? LIVE_OLX_CHECKS : []);
    return { combined: { checks, overall, completedAt: this.deps.now().toISOString() } };
  }

  // The run is completed before the stored row is read, so a failed read never fails the run: the
  // verdict is then built from what was saved.
  private async save(ctx: CheckContext, runId: string, scope: VerdictCheckName[], state: VerdictGraphState): Promise<Partial<VerdictGraphState>> {
    const { combined } = state;
    if (!combined) throw new Error('The sale verdict has nothing to save');
    if (!(await this.deps.verdicts.complete(runId, combined))) {
      throw new Error('The sale verdict run is no longer active');
    }
    let stored: SaleVerdict | null = null;
    try {
      stored = await this.deps.verdicts.findById(ctx.workspace.id, runId);
    } catch (error) {
      this.deps.logger?.warn({ productId: ctx.product.id, runId, err: error }, 'Reading back the saved sale verdict failed');
    }
    return {
      verdict: stored ?? {
        id: runId,
        productId: ctx.product.id,
        listingId: ctx.listing?.id ?? null,
        graphVersion: SALE_VERDICT_GRAPH_VERSION,
        scope,
        status: 'completed',
        overall: combined.overall,
        checks: combined.checks,
        researchRunId: null,
        errorCode: null,
        createdAt: combined.completedAt,
        completedAt: combined.completedAt,
      },
    };
  }

  private async step<T>(node: VerdictTransition['node'], work: () => Promise<T>): Promise<T> {
    this.observe(node, 'started');
    try {
      const value = await work();
      this.observe(node, 'completed');
      return value;
    } catch (error) {
      this.observe(node, 'failed');
      throw error;
    }
  }

  private observe(node: VerdictTransition['node'], phase: VerdictTransition['phase']): void {
    this.deps.observe?.({ node, phase });
  }
}
