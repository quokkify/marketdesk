// Shared test support: Result unwrapping and in-memory mock repositories /
// AI provider for pure (no DB, no network) domain tests.

import { Result } from '../shared/Result';
import { Money } from '../valueObjects/Money';
import type { Product } from '../entities/Product';
import type { Listing } from '../entities/Listing';
import type { Marketplace } from '../entities/Marketplace';
import type { HermesEvent } from '../entities/HermesEvent';
import type { Workspace } from '../entities/Workspace';
import {
  decideOlxPublication,
  OLX_SANDBOX_QUOTA_EVALUATION,
  OlxPublicationQuota,
} from '../entities/OlxPublicationQuota';
import type {
  HermesEventStatus,
  MarketplaceKey,
  PriceEstimate,
  PriceComparable,
  PriceResearch,
  NodeStatus,
  ResearchNode,
  ResearchRun,
  StoredPriceEstimate,
} from '../../../shared/types';
import type { IProductRepository } from '../repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../repositories/interfaces/IMarketplaceRepository';
import type { IEventRepository } from '../repositories/interfaces/IEventRepository';
import type {
  IPriceResearchRepository,
  PriceResearchEdit,
} from '../repositories/interfaces/IPriceResearchRepository';
import type {
  AuthorizeOlxPublicationInput,
  IOlxPublicationQuotaRepository,
  OlxPublicationAuthorization,
  OlxQuotaLookup,
} from '../repositories/interfaces/IOlxPublicationQuotaRepository';
import type {
  FinishedRunFields,
  IPriceResearchRunRepository,
  NewResearchRun,
} from '../repositories/interfaces/IPriceResearchRunRepository';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';
import type {
  IAIProvider,
  PriceEstimateContext,
  PriceSuggestion,
  ListingAnalysis,
} from '../ports/IAIProvider';
import type { AgentRecommendationRecord, ListingSeoOutput } from '../agents/MarketDeskAgentCatalog';

export function unwrap<T>(r: Result<T>): T {
  if (r.isErr()) {
    throw r.error;
  }
  return r.value;
}

export function money(amount: number, currency = 'PLN'): Money {
  return unwrap(Money.of(amount, currency));
}

export class InMemoryProductRepository implements IProductRepository {
  readonly items = new Map<string, Product>();
  readonly saved: Product[] = [];

  async findById(id: string): Promise<Product | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Product | null> {
    const product = this.items.get(id);
    return product && product.workspaceId === workspaceId ? product : null;
  }
  async findByIdForWorkspaceForUpdate(id: string, workspaceId: string): Promise<Product | null> {
    return this.findByIdForWorkspace(id, workspaceId);
  }
  async findByWorkspace(workspaceId: string): Promise<Product[]> {
    return [...this.items.values()].filter((p) => p.workspaceId === workspaceId);
  }
  async findBySku(workspaceId: string, sku: string): Promise<Product | null> {
    return (
      [...this.items.values()].find(
        (p) => p.workspaceId === workspaceId && p.sku === sku,
      ) ?? null
    );
  }
  async save(product: Product): Promise<void> {
    this.items.set(product.id, product);
    this.saved.push(product);
  }
  async saveAll(products: Product[]): Promise<void> {
    for (const p of products) await this.save(p);
  }
  async delete(id: string, workspaceId: string): Promise<void> {
    const product = this.items.get(id);
    if (product && product.workspaceId === workspaceId) this.items.delete(id);
  }
}

export class InMemoryListingRepository implements IListingRepository {
  readonly items = new Map<string, Listing>();
  // Optional map of listingId -> workspaceId so tenant-scoped reads can be
  // exercised without a product/workspace join in pure tests.
  readonly listingWorkspaces = new Map<string, string>();

  async findById(id: string): Promise<Listing | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Listing | null> {
    const listing = this.items.get(id);
    if (!listing) return null;
    const owner = this.listingWorkspaces.get(id);
    // If no explicit owner is registered, treat the listing as visible (pure
    // domain tests seed listings without a workspace join).
    return owner === undefined || owner === workspaceId ? listing : null;
  }
  async findByProduct(productId: string): Promise<Listing[]> {
    return [...this.items.values()].filter((l) => l.productId === productId);
  }
  async findByMarketplace(marketplaceId: string): Promise<Listing[]> {
    return [...this.items.values()].filter((l) => l.marketplaceId === marketplaceId);
  }
  async findByWorkspace(): Promise<Listing[]> {
    return [...this.items.values()];
  }
  async findExpiring(before: Date): Promise<Listing[]> {
    return [...this.items.values()].filter(
      (l) => l.isLive() && l.expiresAt !== null && l.expiresAt.getTime() < before.getTime(),
    );
  }
  async save(listing: Listing): Promise<void> {
    this.items.set(listing.id, listing);
  }
  async saveAfterConfirmedDelist(listing: Listing, expectedExternalListingId: string): Promise<void> {
    void expectedExternalListingId;
    this.items.set(listing.id, listing);
  }
  async saveAll(listings: Listing[]): Promise<void> {
    for (const l of listings) await this.save(l);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryMarketplaceRepository implements IMarketplaceRepository {
  readonly items = new Map<string, Marketplace>();

  async findById(id: string): Promise<Marketplace | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Marketplace | null> {
    const marketplace = this.items.get(id);
    return marketplace && marketplace.workspaceId === workspaceId ? marketplace : null;
  }
  async findByWorkspace(workspaceId: string): Promise<Marketplace[]> {
    return [...this.items.values()].filter((m) => m.workspaceId === workspaceId);
  }
  async findConnected(workspaceId: string): Promise<Marketplace[]> {
    return [...this.items.values()].filter(
      (m) => m.workspaceId === workspaceId && m.isConnected(),
    );
  }
  async findByKey(workspaceId: string, key: MarketplaceKey): Promise<Marketplace | null> {
    return (
      [...this.items.values()].find(
        (m) => m.workspaceId === workspaceId && m.key === key,
      ) ?? null
    );
  }
  async save(marketplace: Marketplace): Promise<void> {
    this.items.set(marketplace.id, marketplace);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryEventRepository implements IEventRepository {
  readonly items = new Map<string, HermesEvent>();
  readonly savedBatches: HermesEvent[][] = [];
  readonly recommendationKeys = new Set<string>();
  readonly agentRecommendations = new Map<string, AgentRecommendationRecord>();

  async findById(id: string): Promise<HermesEvent | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<HermesEvent | null> {
    const event = this.items.get(id);
    return event && event.workspaceId === workspaceId ? event : null;
  }
  async findByWorkspace(workspaceId: string): Promise<HermesEvent[]> {
    return [...this.items.values()].filter((e) => e.workspaceId === workspaceId);
  }
  async findByStatus(
    workspaceId: string,
    status: HermesEventStatus,
  ): Promise<HermesEvent[]> {
    return [...this.items.values()].filter(
      (e) => e.workspaceId === workspaceId && e.status === status,
    );
  }
  async findPendingReview(workspaceId: string): Promise<HermesEvent[]> {
    return this.findByStatus(workspaceId, 'pending_review');
  }
  async save(event: HermesEvent): Promise<void> {
    this.items.set(event.id, event);
  }
  async saveRecommendationIfAbsent(event: HermesEvent, idempotencyKey: string): Promise<boolean> {
    const key = `${event.workspaceId}:${idempotencyKey}`;
    if (this.recommendationKeys.has(key)) return false;
    this.recommendationKeys.add(key);
    this.items.set(event.id, event);
    return true;
  }
  async saveAgentRecommendationIfAbsent(
    event: HermesEvent,
    idempotencyKey: string,
    recommendation: AgentRecommendationRecord,
  ): Promise<boolean> {
    const inserted = await this.saveRecommendationIfAbsent(event, idempotencyKey);
    if (!inserted) return false;
    this.agentRecommendations.set(recommendation.id, recommendation);
    return true;
  }
  async hasRecentAgentRecommendation(
    workspaceId: string,
    productId: string,
    agentId: 'listing-seo',
    agentVersion: string,
    sourceFingerprint: string,
    recommendationFingerprint: string,
    since: Date,
  ): Promise<boolean> {
    return [...this.agentRecommendations.values()].some((row) =>
      row.workspaceId === workspaceId &&
      row.productId === productId &&
      row.agentId === agentId &&
      row.agentVersion === agentVersion &&
      row.sourceFingerprint === sourceFingerprint &&
      row.recommendationFingerprint === recommendationFingerprint &&
      row.outcome === 'suggested' &&
      row.suggestedAt >= since
    );
  }
  async recordAgentRecommendationOutcome(recommendation: AgentRecommendationRecord): Promise<void> {
    this.agentRecommendations.set(recommendation.id, recommendation);
  }
  async findAgentRecommendationByEvent(
    workspaceId: string,
    eventId: string,
  ): Promise<AgentRecommendationRecord | null> {
    return [...this.agentRecommendations.values()].find(
      (row) => row.workspaceId === workspaceId && row.eventId === eventId,
    ) ?? null;
  }
  async markAgentRecommendationApproved(workspaceId: string, eventId: string, at: Date): Promise<void> {
    this.updateAgentRecommendation(eventId, workspaceId, { approvedAt: at });
  }
  async markAgentRecommendationDismissed(workspaceId: string, eventId: string, at: Date): Promise<void> {
    this.updateAgentRecommendation(eventId, workspaceId, { dismissedAt: at });
  }
  async markAgentRecommendationApplied(workspaceId: string, eventId: string, at: Date): Promise<void> {
    this.updateAgentRecommendation(eventId, workspaceId, { appliedAt: at });
  }
  async markAgentRecommendationFailed(workspaceId: string, eventId: string, _at: Date): Promise<void> {
    this.updateAgentRecommendation(eventId, workspaceId, { outcome: 'failed', failedAt: _at });
  }
  async saveAll(events: HermesEvent[]): Promise<void> {
    this.savedBatches.push(events);
    for (const e of events) await this.save(e);
  }
  async deleteOlderThan(): Promise<void> {
    // no-op for tests
  }

  private updateAgentRecommendation(
    eventId: string,
    workspaceId: string,
    patch: Partial<AgentRecommendationRecord>,
  ): void {
    for (const [id, row] of this.agentRecommendations) {
      if (row.eventId === eventId && row.workspaceId === workspaceId) {
        this.agentRecommendations.set(id, { ...row, ...patch });
      }
    }
  }
}

export class InMemoryPriceResearchRepository implements IPriceResearchRepository {
  readonly items = new Map<string, PriceResearch>();
  async findByProduct(workspaceId: string, productId: string): Promise<PriceResearch | null> {
    return this.items.get(`${workspaceId}:${productId}`) ?? null;
  }
  async saveEditLocked(
    workspaceId: string,
    productId: string,
    apply: (current: PriceResearch | null) => PriceResearchEdit,
  ): Promise<PriceResearch> {
    const key = `${workspaceId}:${productId}`;
    const research = apply(this.items.get(key) ?? null);
    const saved: PriceResearch = {
      ...this.blank(productId),
      ...this.items.get(key),
      ...research,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(key, saved);
    return saved;
  }
  async saveLadderLocked(
    workspaceId: string,
    productId: string,
    apply: (current: PriceResearch | null) => { comparables: PriceComparable[]; specs: string | null } | null,
  ): Promise<PriceResearch | null> {
    const key = `${workspaceId}:${productId}`;
    const current = this.items.get(key) ?? null;
    const ladder = apply(current);
    if (!ladder) return current;
    const saved: PriceResearch = {
      ...this.blank(productId),
      ...current,
      comparables: ladder.comparables,
      specs: ladder.specs,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(key, saved);
    return saved;
  }
  async saveEstimate(workspaceId: string, productId: string, stored: StoredPriceEstimate): Promise<void> {
    const key = `${workspaceId}:${productId}`;
    this.items.set(key, { ...this.blank(productId), ...this.items.get(key), lastEstimate: stored, updatedAt: new Date().toISOString() });
  }
  private blank(productId: string): PriceResearch {
    return {
      productId,
      retailPrice: null,
      retailCurrency: null,
      retailSource: null,
      retailCheckedAt: null,
      comparables: [],
      specs: null,
      dismissedUrls: [],
      lastAttemptAt: null,
      lastEstimate: null,
      updatedAt: new Date().toISOString(),
    };
  }
}

// Mirrors the partial unique index: one queued or running run per product.
export class InMemoryPriceResearchRunRepository implements IPriceResearchRunRepository {
  readonly runs: ResearchRun[] = [];
  async insertQueued(run: NewResearchRun): Promise<ResearchRun | null> {
    if (this.runs.some((r) => r.productId === run.productId && r.status !== 'finished')) return null;
    const stored: ResearchRun = {
      ...run,
      status: 'queued',
      nodes: {},
      outcome: null,
      failedTiers: [],
      errorCode: null,
      consecutiveFailures: 0,
      startedAt: null,
      finishedAt: null,
      leaseUntil: null,
      nextAutoAt: null,
    };
    this.runs.push(stored);
    return { ...stored };
  }
  async findActive(workspaceId: string, productId: string): Promise<ResearchRun | null> {
    const run = this.runs.find((r) => r.workspaceId === workspaceId && r.productId === productId && r.status !== 'finished');
    return run ? { ...run } : null;
  }
  async findLastFinished(workspaceId: string, productId: string): Promise<ResearchRun | null> {
    const finished = this.runs.filter((r) => r.workspaceId === workspaceId && r.productId === productId && r.status === 'finished');
    const last = finished.sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
    return last ? { ...last } : null;
  }
  async countQueued(workspaceId: string, queuedSince: string): Promise<number> {
    return this.runs.filter((r) => r.workspaceId === workspaceId && r.status === 'queued' && r.queuedAt >= queuedSince).length;
  }
  async claim(runId: string, startedAt: string, leaseUntil: string): Promise<ResearchRun | null> {
    const run = this.runs.find((r) => r.id === runId && r.status === 'queued');
    if (!run) return null;
    Object.assign(run, { status: 'running', startedAt, leaseUntil });
    return { ...run };
  }
  async saveNode(runId: string, node: ResearchNode, status: NodeStatus): Promise<void> {
    const run = this.runs.find((r) => r.id === runId && r.status === 'running');
    if (run) run.nodes = { ...run.nodes, [node]: status };
  }
  async finish(runId: string, fields: FinishedRunFields): Promise<boolean> {
    const run = this.runs.find((r) => r.id === runId && r.status !== 'finished');
    if (!run) return false;
    Object.assign(run, { ...fields, status: 'finished', leaseUntil: null });
    return true;
  }
}

export class RecordingEventPublisher implements IEventPublisher {
  readonly published: DomainEvent[] = [];
  async publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
  }
}

export class StubAIProvider implements IAIProvider {
  constructor(
    private readonly price: PriceSuggestion = {
      suggestedPrice: 0,
      reasoning: 'stub',
      confidence: 'low',
    },
    private readonly title = '',
    private readonly analysis: ListingAnalysis = { score: 100, suggestions: [] },
    private readonly seoOutput: ListingSeoOutput = {
      recommendations: [
        { field: 'title', proposedValue: 'SEO title', rationale: 'More searchable wording for review.' },
      ],
      disclaimer: 'Review only; no marketplace changes were applied.',
    },
    // When set, the estimate answer as given, or the error the call fails with.
    private readonly estimateAnswer?: PriceEstimate | Error,
  ) {}

  async suggestPrice(): Promise<PriceSuggestion> {
    return this.price;
  }
  async estimatePrice(context: PriceEstimateContext): Promise<PriceEstimate> {
    if (this.estimateAnswer instanceof Error) throw this.estimateAnswer;
    if (this.estimateAnswer) return this.estimateAnswer;
    // A configured price suggestion doubles as the estimate; the default stays low confidence.
    const start = this.price.suggestedPrice > 0 ? this.price.suggestedPrice : context.listing.price.amount;
    return {
      startPrice: start,
      floorPrice: start,
      retailAnchor: null,
      usedRange: null,
      reasoning: this.price.reasoning,
      confidence: this.price.confidence,
    };
  }
  async generateTitle(): Promise<string> {
    return this.title;
  }
  async analyzeListing(): Promise<ListingAnalysis> {
    return this.analysis;
  }
  async analyzeListingSeo(): Promise<ListingSeoOutput> {
    return this.seoOutput;
  }
}

// In-memory OLX quota repository with the Postgres repository's serialized
// authorize/consume semantics, including the sandbox allowance.
export class AtomicInMemoryQuotaRepository implements IOlxPublicationQuotaRepository {
  readonly quotas: OlxPublicationQuota[] = [];
  readonly operations = new Map<string, OlxPublicationAuthorization>();
  private tail: Promise<void> = Promise.resolve();

  async findCurrent(input: OlxQuotaLookup): Promise<OlxPublicationQuota | null> {
    return this.quotas.find((quota) =>
      quota.workspaceId === input.workspaceId &&
      quota.marketplaceId === input.marketplaceId &&
      quota.marketplaceAccountId === input.marketplaceAccountId &&
      quota.subcategoryId === input.subcategoryId &&
      quota.cycleStartedAt.getTime() <= input.at.getTime() &&
      quota.cycleEndsAt.getTime() > input.at.getTime()
    ) ?? null;
  }

  async findByAccount(input: {
    workspaceId: string;
    marketplaceId: string;
    marketplaceAccountId: string;
    limit: number;
  }): Promise<OlxPublicationQuota[]> {
    return this.quotas.filter((quota) =>
      quota.workspaceId === input.workspaceId &&
      quota.marketplaceId === input.marketplaceId &&
      quota.marketplaceAccountId === input.marketplaceAccountId
    );
  }

  async save(quota: OlxPublicationQuota): Promise<void> {
    const index = this.quotas.findIndex((candidate) =>
      candidate.workspaceId === quota.workspaceId &&
      candidate.marketplaceAccountId === quota.marketplaceAccountId &&
      candidate.subcategoryId === quota.subcategoryId &&
      candidate.cycleStartedAt.getTime() === quota.cycleStartedAt.getTime()
    );
    if (index < 0) {
      this.quotas.push(quota);
      return;
    }
    const current = this.quotas[index];
    this.quotas[index] = this.copy(quota, Math.max(current.consumed, quota.consumed));
  }

  async authorize(input: AuthorizeOlxPublicationInput): Promise<OlxPublicationAuthorization> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const replay = this.operations.get(input.operationId);
      if (replay) return { ...replay, replayed: true };
      let quota = await this.findCurrent(input);
      const evaluation = quota?.evaluate(input.at)
        ?? (input.sandboxMode ? OLX_SANDBOX_QUOTA_EVALUATION : undefined);
      const { decision, consumedUnit } = decideOlxPublication(
        evaluation,
        input.overrideConfirmed,
        quota !== null,
      );
      if (consumedUnit && quota) {
        quota = this.copy(quota, quota.consumed + 1);
        const index = this.quotas.findIndex((candidate) => candidate.id === quota!.id);
        this.quotas[index] = quota;
      }
      const result: OlxPublicationAuthorization = {
        operationId: input.operationId,
        decision,
        status: evaluation?.status ?? 'unknown',
        reason: evaluation?.reason ?? 'quota_unknown',
        quota,
        consumedUnit,
        replayed: false,
      };
      this.operations.set(input.operationId, result);
      return result;
    } finally {
      release();
    }
  }

  // Units are consumed at authorize time here, so consume only re-checks a reservation
  // that holds no quota row, the way the Postgres repository does.
  async consume(operationId: string, _at: Date, sandboxMode = false): Promise<OlxPublicationAuthorization> {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error(`OLX quota reservation not found: ${operationId}`);
    if (operation.consumedUnit || operation.decision === 'block' || operation.quota) {
      return { ...operation, replayed: true };
    }
    const evaluation = sandboxMode ? OLX_SANDBOX_QUOTA_EVALUATION : undefined;
    const result: OlxPublicationAuthorization = {
      ...operation,
      decision: operation.decision === 'allow' && !evaluation?.canPublishForFree
        ? 'block'
        : operation.decision,
      status: evaluation?.status ?? 'unknown',
      reason: evaluation?.reason ?? 'quota_unknown',
      replayed: false,
    };
    this.operations.set(operationId, result);
    return result;
  }

  private copy(quota: OlxPublicationQuota, consumed: number): OlxPublicationQuota {
    return unwrap(OlxPublicationQuota.create({
      id: quota.id,
      workspaceId: quota.workspaceId,
      marketplaceId: quota.marketplaceId,
      marketplaceAccountId: quota.marketplaceAccountId,
      subcategoryId: quota.subcategoryId,
      cycleStartedAt: quota.cycleStartedAt,
      cycleEndsAt: quota.cycleEndsAt,
      publicationLimit: quota.publicationLimit,
      consumed,
      source: quota.source,
      confidence: quota.confidence,
      verifiedAt: quota.verifiedAt,
      staleAt: quota.staleAt,
      createdAt: quota.createdAt,
      updatedAt: new Date(),
    }));
  }
}

let counter = 0;
export function sequentialIdFactory(prefix = 'evt'): () => string {
  return () => `${prefix}-${++counter}`;
}

// Silence unused-import complaints for Workspace type re-export convenience.
export type { Workspace };
