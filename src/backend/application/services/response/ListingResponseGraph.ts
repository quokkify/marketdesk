// The listing response graph: why does a live listing get no reaction. load (product, its live OLX
// listing) → known (findings from the stored sale verdict) → route sends only a listing nobody sees
// (stage not_seen) on to queries (Hermes proposes buyer queries) → probe (pages through OLX search,
// one query and one page at a time, until the advert shows up) → locate → compare → rank → save.
// A failed probe is recorded, not fatal. State holds the signal, the parsed queries, the probe
// cards (ids and prices) and the findings; no raw Hermes answer, OLX text or URL is kept, and logs
// carry ids and error names only. The graph creates no HermesEvents and applies nothing.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type {
  ListingResponseRun,
  ListingResponseSignal,
  ResponseFinding,
  ResponseProbe,
} from '../../../../shared/types';
import type { Product } from '../../../domain/entities/Product';
import type { Listing } from '../../../domain/entities/Listing';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { ISaleVerdictRepository } from '../../../domain/repositories/interfaces/ISaleVerdictRepository';
import type {
  CompletedListingResponseFields,
  IListingResponseRunRepository,
} from '../../../domain/repositories/interfaces/IListingResponseRunRepository';
import type { IAnalyticsEventRepository } from '../../ports/IAnalyticsEventRepository';
import type { IOlxSearch } from '../../ports/IOlxSearch';
import type { AITextCompletionClient } from '../../../infrastructure/external/HermesAI';
import { InvalidStateError, NotFoundError } from '../../../domain/shared/DomainError';
import {
  knownFindings,
  locateOwn,
  probeFindings,
  rankFindings,
  subjectFingerprint,
} from '../../../domain/services/listingResponseRules';
import { buildQueriesPrompt, parseQueries } from '../../../infrastructure/external/listingResponsePrompts';
import { researchItemFromProduct } from '../../../infrastructure/external/priceResearchPrompts';
import { withAiOperation, withAiUsageScope } from '../../ai/aiUsageScope';
import {
  STATS_DAYS,
  listingResponseSignal,
  nonSyncViewEventIds,
  summarizeListingViews,
  toResponseListing,
} from '../productStats';

export const LISTING_RESPONSE_GRAPH_VERSION = 'listing-response@1';
const AI_FEATURE = 'response';
const DAY_MS = 24 * 3600 * 1000;
const OLX_MARKETPLACE_KEY = 'olx';

export interface ResponseTransition {
  node: 'load' | 'known' | 'route' | 'queries' | 'probe' | 'locate' | 'compare' | 'rank' | 'save';
  phase: 'started' | 'completed' | 'failed';
}

// Structural, so the container can pass its logger.
export interface ListingResponseGraphLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface ListingResponseGraphDeps {
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByProduct'>;
  marketplaces: Pick<IMarketplaceRepository, 'findByIdForWorkspace'>;
  analytics: Pick<IAnalyticsEventRepository, 'findByRange'>;
  verdicts: Pick<ISaleVerdictRepository, 'findLatestCompleted'>;
  runs: Pick<IListingResponseRunRepository, 'complete' | 'findById'>;
  // The no-tools marketplace profile; null when Hermes is not configured.
  queryClient: AITextCompletionClient | null;
  search: IOlxSearch;
  maxPages: number;
  now: () => Date;
  observe?: (transition: ResponseTransition) => void;
  logger?: ListingResponseGraphLogger;
}

export interface ListingResponseRunInput {
  workspaceId: string;
  productId: string;
  runId: string;
  signal: AbortSignal;
}

interface Subject {
  product: Product;
  listing: Listing;
  ownId: string;
}

type StoredProbe = ListingResponseRun['probes'][number];

const ResponseState = Annotation.Root({
  subject: Annotation<Subject | null>(),
  responseSignal: Annotation<ListingResponseSignal | null>(),
  knownFound: Annotation<ResponseFinding[]>(),
  queryList: Annotation<string[]>(),
  probes: Annotation<ResponseProbe[]>(),
  located: Annotation<StoredProbe[]>(),
  found: Annotation<ResponseFinding[]>(),
  ranked: Annotation<ResponseFinding[]>(),
  run: Annotation<ListingResponseRun | null>(),
});

type ResponseGraphState = typeof ResponseState.State;

const PROBE_FAILED: ResponseFinding = {
  code: 'probe_failed',
  message: 'Could not check how buyers find the listing',
  action: null,
  evidence: {},
};

// The listing the graph works on: the product's first live listing, which must be on OLX and carry
// its marketplace id. InvalidStateError otherwise.
export async function findLiveOlxListing(
  deps: Pick<ListingResponseGraphDeps, 'listings' | 'marketplaces'>,
  workspaceId: string,
  productId: string,
): Promise<{ listing: Listing; ownId: string }> {
  const listing = (await deps.listings.findByProduct(productId)).find((l) => l.status === 'live');
  if (!listing) throw new InvalidStateError('The product has no live listing');
  const marketplace = await deps.marketplaces.findByIdForWorkspace(listing.marketplaceId, workspaceId);
  if (marketplace?.key !== OLX_MARKETPLACE_KEY) throw new InvalidStateError('The live listing is not on OLX');
  const ownId = listing.marketplaceListingId;
  if (!ownId) throw new InvalidStateError('The live listing has no marketplace listing id');
  return { listing, ownId };
}

export function responseFingerprint(product: Product, listing: Listing): string {
  return subjectFingerprint({
    title: product.name,
    price: listing.price.amount,
    categoryId: listing.marketplaceCategory?.providerCategoryId ?? null,
  });
}

export class ListingResponseGraph {
  constructor(private readonly deps: ListingResponseGraphDeps) {}

  // A missing product, an unusable listing, a run no longer active or an abort is thrown: the
  // caller fails the run.
  async run(input: ListingResponseRunInput): Promise<ListingResponseRun> {
    input.signal.throwIfAborted();
    const { workspaceId, productId } = input;
    const { value: state } = await withAiUsageScope({ workspaceId, feature: AI_FEATURE, productId }, () =>
      this.build(input).invoke({
        subject: null,
        responseSignal: null,
        knownFound: [],
        queryList: [],
        probes: [],
        located: [],
        found: [],
        ranked: [],
        run: null,
      }),
    );
    if (!state.run) throw new Error('The listing response run produced no result');
    return state.run;
  }

  private build(input: ListingResponseRunInput) {
    const node =
      (name: ResponseTransition['node'], work: (state: ResponseGraphState) => Promise<Partial<ResponseGraphState>>) =>
      (state: ResponseGraphState) =>
        this.step(name, () => {
          input.signal.throwIfAborted();
          return work(state);
        });

    return new StateGraph(ResponseState)
      .addNode('load', node('load', () => this.load(input)))
      .addNode('known', node('known', (state) => this.known(state)))
      .addNode('queries', node('queries', (state) => this.queries(input, state)))
      .addNode('probe', node('probe', (state) => this.probe(input, state)))
      .addNode('locate', node('locate', (state) => this.locate(state)))
      .addNode('compare', node('compare', (state) => this.compare(state)))
      .addNode('rank', node('rank', (state) => this.rank(state)))
      .addNode('save', node('save', (state) => this.save(input, state)))
      .addEdge(START, 'load')
      .addEdge('load', 'known')
      .addConditionalEdges(
        'known',
        (state: ResponseGraphState) => {
          this.observe('route', 'started');
          const next = state.responseSignal?.stage === 'not_seen' ? 'queries' : 'rank';
          this.observe('route', 'completed');
          return next;
        },
        ['queries', 'rank'],
      )
      .addConditionalEdges('queries', (state: ResponseGraphState) => (state.queryList.length > 0 ? 'probe' : 'rank'), [
        'probe',
        'rank',
      ])
      .addEdge('probe', 'locate')
      .addEdge('locate', 'compare')
      .addEdge('compare', 'rank')
      .addEdge('rank', 'save')
      .addEdge('save', END)
      .compile();
  }

  private async load(input: ListingResponseRunInput): Promise<Partial<ResponseGraphState>> {
    const { workspaceId, productId } = input;
    const product = await this.deps.products.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    const { listing, ownId } = await findLiveOlxListing(this.deps, workspaceId, product.id);

    const now = this.deps.now();
    const events = await this.deps.analytics.findByRange({
      workspaceId,
      from: new Date(now.getTime() - (STATS_DAYS + 1) * DAY_MS),
      to: new Date(now.getTime() + 1),
    });
    const views = summarizeListingViews(events, nonSyncViewEventIds(events), now);
    return {
      subject: { product, listing, ownId },
      responseSignal: listingResponseSignal(toResponseListing(listing), views.get(listing.id), now),
    };
  }

  private async known(state: ResponseGraphState): Promise<Partial<ResponseGraphState>> {
    const { product } = this.subject(state);
    const verdict = await this.deps.verdicts.findLatestCompleted(product.workspaceId, product.id);
    return { knownFound: knownFindings(verdict, product.updatedAt) };
  }

  private async queries(input: ListingResponseRunInput, state: ResponseGraphState): Promise<Partial<ResponseGraphState>> {
    const { product, listing } = this.subject(state);
    const client = this.deps.queryClient;
    if (!client) return { found: [PROBE_FAILED] };
    try {
      const { system, prompt } = buildQueriesPrompt(researchItemFromProduct(product, listing));
      const raw = await withAiOperation('response.queries', () =>
        client.complete({ system, prompt, signal: input.signal }),
      );
      const queries = parseQueries(raw);
      return queries ? { queryList: queries } : { found: [PROBE_FAILED] };
    } catch (error) {
      if (input.signal.aborted) throw error;
      this.warn(input, 'queries', error);
      return { found: [PROBE_FAILED] };
    }
  }

  private async probe(input: ListingResponseRunInput, state: ResponseGraphState): Promise<Partial<ResponseGraphState>> {
    const { ownId } = this.subject(state);
    const probes: ResponseProbe[] = [];
    for (const query of state.queryList) {
      probes.push(await withAiOperation('response.probe', () => this.probeQuery(input, query, ownId)));
    }
    return { probes };
  }

  private async probeQuery(input: ListingResponseRunInput, query: string, ownId: string): Promise<ResponseProbe> {
    const { signal } = input;
    let first;
    try {
      first = await this.deps.search.page(query, 1, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      this.warn(input, 'probe', error);
      return { query, status: 'failed', total: null, cards: [], firstPageSize: 0 };
    }
    const cards = [...first.cards];
    const lastPage = Math.min(this.deps.maxPages, first.totalPages ?? 1);
    for (let pageNumber = 2; pageNumber <= lastPage && locateOwn(cards, ownId).position === null; pageNumber += 1) {
      try {
        cards.push(...(await this.deps.search.page(query, pageNumber, signal)).cards);
      } catch (error) {
        if (signal.aborted) throw error;
        this.warn(input, 'probe', error);
        break;
      }
    }
    return { query, status: 'ok', total: first.total, cards, firstPageSize: first.cards.length };
  }

  private async locate(state: ResponseGraphState): Promise<Partial<ResponseGraphState>> {
    const { ownId } = this.subject(state);
    const located = state.probes.map(({ cards, ...probe }): StoredProbe => {
      const { position, checked } = locateOwn(cards, ownId);
      return { ...probe, position, checked };
    });
    return { located };
  }

  private async compare(state: ResponseGraphState): Promise<Partial<ResponseGraphState>> {
    const { product, listing, ownId } = this.subject(state);
    const own = { id: ownId, title: product.name, price: listing.price.amount };
    const found = state.probes.flatMap((probe) => probeFindings(probe, own));
    if (state.probes.every((probe) => probe.status === 'failed')) found.push(PROBE_FAILED);
    return { found: [...state.found, ...found] };
  }

  private async rank(state: ResponseGraphState): Promise<Partial<ResponseGraphState>> {
    return { ranked: rankFindings([...state.knownFound, ...state.found]) };
  }

  private async save(input: ListingResponseRunInput, state: ResponseGraphState): Promise<Partial<ResponseGraphState>> {
    const { product, listing } = this.subject(state);
    const responseSignal = state.responseSignal;
    if (!responseSignal) throw new Error('The listing response has no signal to save');
    const fields: CompletedListingResponseFields = {
      stage: responseSignal.stage,
      signal: responseSignal,
      probes: state.located,
      findings: state.ranked,
      completedAt: this.deps.now().toISOString(),
    };
    if (!(await this.deps.runs.complete(input.runId, fields))) {
      throw new Error('The listing response run is no longer active');
    }
    let stored: ListingResponseRun | null = null;
    try {
      stored = await this.deps.runs.findById(input.workspaceId, input.runId);
    } catch (error) {
      this.warn(input, 'save', error);
    }
    return {
      run: stored ?? {
        id: input.runId,
        productId: product.id,
        listingId: listing.id,
        graphVersion: LISTING_RESPONSE_GRAPH_VERSION,
        status: 'completed',
        ...fields,
        fingerprint: responseFingerprint(product, listing),
        errorCode: null,
        createdAt: fields.completedAt,
      },
    };
  }

  private subject(state: ResponseGraphState): Subject {
    if (!state.subject) throw new Error('The listing response graph has not loaded its listing');
    return state.subject;
  }

  private warn(input: ListingResponseRunInput, node: ResponseTransition['node'], error: unknown): void {
    this.deps.logger?.warn(
      {
        productId: input.productId,
        runId: input.runId,
        node,
        errorName: error instanceof Error ? error.name : 'unknown',
      },
      'Listing response step failed',
    );
  }

  private async step<T>(node: ResponseTransition['node'], work: () => Promise<T>): Promise<T> {
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

  private observe(node: ResponseTransition['node'], phase: ResponseTransition['phase']): void {
    this.deps.observe?.({ node, phase });
  }
}
