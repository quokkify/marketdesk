// HermesDecisionEngine — the autonomous analyzer. Implements ARCHITECTURE.md §10
// with the IAIProvider abstraction from ARCHITECTURE_AMENDMENTS FIX #1.
//
// Autonomy tiers (determineAutonomy):
//   suggest_only : everything -> pending_review
//   full_auto    : auto_apply, EXCEPT critical competitor_price_detected -> review
//   balanced     : safe types (create_listing/update_description/relist) auto_apply,
//                  everything else -> pending_review
//
// Additionally, HermesEvent.requiresHumanReview() forces review for critical price
// drops (> 20%), so those never auto-apply regardless of tier. Title, price and
// description changes made while the AI provider answers from its offline heuristics
// (AIProviderSourceAware) always go to review, whatever the tier and guardrails say.
// Every AI-made event records its source, and offline ones say so in their detail.

import { Result, Ok, Err } from '../shared/Result';
import {
  ValidationError,
  InvalidStateError,
  NotFoundError,
  TooManyRequestsError,
} from '../shared/DomainError';
import { HermesEvent } from '../entities/HermesEvent';
import { Product } from '../entities/Product';
import { Money } from '../valueObjects/Money';
import type {
  AIProviderSource,
  AutonomyLevel,
  AutonomyDecision,
  HermesEventType,
  HermesSeverity,
  ProposedChange,
  RunOutcome,
} from '../../../shared/types';
import { BALANCED_SAFE_EVENT_TYPES } from '../../../shared/constants';
import type { Workspace } from '../entities/Workspace';
import type { IProductRepository } from '../repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../repositories/interfaces/IListingRepository';
import type { IEventRepository } from '../repositories/interfaces/IEventRepository';
import type { Listing } from '../entities/Listing';
import type { IPriceResearchRuns } from '../ports/IPriceResearchRuns';
import type { PriceEstimateService } from './PriceEstimateService';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';
import {
  isAIProviderSourceAware,
  OFFLINE_AI_NOTICE,
  type IAIProvider,
} from '../ports/IAIProvider';
import {
  listingSeoProfile,
  listingSeoInputSchema,
  recommendationFingerprint,
  rawSeoSourceFingerprint,
  seoSourceFingerprint,
  type AgentRecommendationRecord,
} from '../agents/MarketDeskAgentCatalog';

interface Suggestion {
  type: HermesEventType;
  severity: HermesSeverity;
  title: string;
  detail: string;
  change: ProposedChange;
}

export type IdFactory = () => string;

const RESEARCH_UNAVAILABLE_NOTE = 'Market research failed; the estimate uses saved data.';
const PRICE_ESTIMATE_PENDING: Suggestion = {
  type: 'price_estimate_unavailable',
  severity: 'info',
  title: 'Price estimate pending',
  detail: 'Searching prices, about 2–4 min. The estimate appears when it finishes.',
  change: null,
};

// One pending price event per product: a new one closes the earlier pending ones (applied or
// otherwise resolved events are never touched). The job's "unavailable" notice closes only earlier
// notices, so a background failure never takes away a priced suggestion the seller can still act on.
const PRICE_EVENT_TYPES: readonly HermesEventType[] = [
  'suggested_lower_price',
  'suggested_higher_price',
  'price_estimate_unavailable',
];
const PRICE_NOTICE_TYPES: readonly HermesEventType[] = ['price_estimate_unavailable'];

const AI_MADE_CHANGE_KINDS: ReadonlySet<string> = new Set(['title', 'price', 'description']);

// Adds the offline notice unless the provider already wrote it into the detail.
function withOfflineNotice(detail: string): string {
  if (detail.includes(OFFLINE_AI_NOTICE)) return detail;
  const text = detail.trim();
  if (text === '') return OFFLINE_AI_NOTICE;
  return /[.!?]$/.test(text) ? `${text} ${OFFLINE_AI_NOTICE}` : `${text}. ${OFFLINE_AI_NOTICE}`;
}

// Structural, so the container can pass its logger.
export interface HermesEngineLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export class HermesDecisionEngine {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly eventRepo: IEventRepository,
    private readonly eventPublisher: IEventPublisher,
    private readonly aiProvider: IAIProvider,
    private readonly priceEstimates: PriceEstimateService,
    private readonly researchRuns: IPriceResearchRuns | null,
    private readonly idFactory: IdFactory,
    private readonly logger?: HermesEngineLogger
  ) {}

  async run(workspace: Workspace): Promise<HermesEvent[]> {
    const events: HermesEvent[] = [];
    // Products whose earlier pending price events this run supersedes; closed when its events are saved.
    const superseding = new Set<Product>();
    const products = await this.productRepo.findByWorkspace(workspace.id);

    for (const product of products) {
      // Asked before and after the AI calls, so a switch to the offline heuristics at
      // any point during the check keeps this product's AI-made changes review-only.
      const offlineBefore = await this.aiAnswersOffline();
      const suggestions = await this.checkConditions(product);
      const answeredOffline = offlineBefore || (await this.aiAnswersOffline());

      for (const suggestion of suggestions) {
        // Suggestions no AI produced (relist, more photos) carry no source.
        let source: AIProviderSource | null = null;
        if (suggestion.change !== null && AI_MADE_CHANGE_KINDS.has(suggestion.change.kind)) {
          source = answeredOffline ? 'offline' : 'hermes';
        }
        // A price from a Hermes estimate is never applied without the owner's approval.
        const estimatedPrice = suggestion.change?.kind === 'price' && suggestion.change.estimate !== undefined;
        let decision: AutonomyDecision =
          source === 'offline' || estimatedPrice
            ? 'pending_review'
            : this.determineAutonomy(workspace.autonomyLevel, suggestion.type, suggestion.severity);
        const created = HermesEvent.create({
          id: this.idFactory(),
          workspaceId: workspace.id,
          productId: product.id,
          type: suggestion.type,
          severity: suggestion.severity,
          title: suggestion.title,
          detail: source === 'offline' ? withOfflineNotice(suggestion.detail) : suggestion.detail,
          proposedChange: suggestion.change,
          status: decision === 'auto_apply' ? 'pending_decision' : 'pending_review',
          source,
        });
        if (created.isErr()) continue;
        const event = created.value;
        if (PRICE_EVENT_TYPES.includes(event.type)) superseding.add(product);

        event.setAutonomyDecision(decision);
        const unsupportedAutomaticChange =
          event.proposedChange?.kind === 'relist' ||
          event.proposedChange?.kind === 'create_listing';

        if (decision === 'auto_apply' && unsupportedAutomaticChange) {
          decision = 'pending_review';
          event.setAutonomyDecision(decision);
          event.requestReview();
        } else if (
          decision === 'auto_apply' &&
          !event.requiresHumanReview() &&
          this.passesGuardrails(product, event, workspace)
        ) {
          const started = event.beginAutoApply();
          if (started.isErr()) continue;
          await this.eventRepo.saveAll([event]);
          try {
            const applied = await this.applyChange(product, event.proposedChange);
            if (applied.isOk()) {
              event.markApplied();
            } else {
              event.markFailed();
            }
          } catch {
            event.markFailed();
          }
          await this.eventRepo.saveAll([event]);
        } else if (decision === 'auto_apply') {
          // Guardrail: a critical change, a >20% drop, or a workspace guardrail
          // violation cannot auto-apply — force human review.
          decision = 'pending_review';
          event.setAutonomyDecision(decision);
          event.requestReview();
        }

        events.push(event);
      }
    }

    // Closed right before this run's events are saved, so only earlier ones are closed, and an event
    // the seller resolved while the run was working keeps the seller's decision.
    for (const product of superseding) await this.closePendingPriceEvents(product, PRICE_EVENT_TYPES);
    await this.eventRepo.saveAll(events);
    await this.eventPublisher.publish(this.runCompletedEvent(workspace.id, events.length));

    return events;
  }

  /** Product-scoped safe slice: listing SEO only, always review-only and never auto-applied. */
  async runProductSeo(workspace: Workspace, productId: string): Promise<HermesEvent[]> {
    const product = await this.productRepo.findByIdForWorkspace(productId, workspace.id);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    if (!workspace.listingSeoEnabled) return [];

    const listings = await this.listingRepo.findByProduct(product.id);
    const primary = listings[0];
    const rawInput = {
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        condition: product.condition,
        tags: [...product.tags],
        imageCount: product.imageCount,
      },
      listing: primary
        ? {
            id: primary.id,
            title: product.name,
            description: product.description,
            marketplace: primary.marketplaceId,
          }
        : null,
    };
    let source = rawSeoSourceFingerprint(rawInput);
    let input: ReturnType<typeof listingSeoInputSchema.parse>;
    let output: Awaited<ReturnType<IAIProvider['analyzeListingSeo']>>;
    let aiSource: AIProviderSource;
    try {
      input = listingSeoInputSchema.parse(rawInput);
      source = seoSourceFingerprint(input);
      // Asked before and after the call, as in run(): any offline answer labels the events.
      const offlineBefore = await this.aiAnswersOffline();
      output = await this.aiProvider.analyzeListingSeo(input, workspace.creativityPreset);
      aiSource = offlineBefore || (await this.aiAnswersOffline()) ? 'offline' : 'hermes';
    } catch (error) {
      await this.eventRepo.recordAgentRecommendationOutcome({
        id: this.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        eventId: null,
        agentId: listingSeoProfile.id,
        agentVersion: listingSeoProfile.version,
        creativityPreset: workspace.creativityPreset,
        sourceFingerprint: source,
        recommendationFingerprint: recommendationFingerprint(
          listingSeoProfile.id,
          listingSeoProfile.version,
          source,
          'analysis_failed',
        ),
        outcome: 'failed',
        suggestedAt: new Date(),
      });
      throw error;
    }
    const events: HermesEvent[] = [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const windowStart = Math.floor(Date.now() / (30 * 24 * 60 * 60 * 1000));

    for (const recommendation of output.recommendations) {
      const fingerprint = recommendationFingerprint(
        listingSeoProfile.id,
        listingSeoProfile.version,
        source,
        recommendation.proposedValue
      );
      const duplicate = await this.eventRepo.hasRecentAgentRecommendation(
        workspace.id,
        product.id,
        listingSeoProfile.id,
        listingSeoProfile.version,
        source,
        fingerprint,
        new Date(cutoff),
      );
      if (duplicate) {
        await this.eventRepo.recordAgentRecommendationOutcome(this.agentRecommendationRecord({
          id: this.idFactory(),
          workspace,
          productId: product.id,
          eventId: null,
          source,
          fingerprint,
          outcome: 'suppressed',
        }));
        continue;
      }
      const proposedChange =
        recommendation.field === 'description'
          ? {
              kind: 'description' as const,
              field: 'description' as const,
              from: product.description,
              to: recommendation.proposedValue,
            }
          : {
              kind: 'title' as const,
              field: 'title' as const,
              from: product.name,
              to: recommendation.proposedValue,
            };
      const type: HermesEventType =
        recommendation.field === 'description'
          ? 'update_description'
          : 'suggested_better_title';
      // Fingerprints, source and ids stay in the agent recommendation record, not in seller copy.
      const detail = `${recommendation.rationale} Review-only suggestion from listing-seo@${listingSeoProfile.version} (${workspace.creativityPreset}). This may improve discoverability but does not guarantee a sale.`;
      const created = HermesEvent.create({
        id: this.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        type,
        severity: 'info',
        title: `Listing SEO suggestion: ${recommendation.field}`,
        detail: aiSource === 'offline' ? withOfflineNotice(detail) : detail,
        proposedChange,
        status: 'pending_review',
        autonomyDecision: 'pending_review',
        source: aiSource,
      });
      if (created.isErr()) continue;
      const event = created.value;
      const inserted = await this.eventRepo.saveAgentRecommendationIfAbsent(
        event,
        `listing-seo:${listingSeoProfile.version}:${product.id}:${source}:${fingerprint}:w${windowStart}`,
        this.agentRecommendationRecord({
          id: this.idFactory(),
          workspace,
          productId: product.id,
          eventId: event.id,
          source,
          fingerprint,
          outcome: 'suggested',
        }),
      );
      if (inserted) {
        events.push(event);
      } else {
        await this.eventRepo.recordAgentRecommendationOutcome(this.agentRecommendationRecord({
          id: this.idFactory(),
          workspace,
          productId: product.id,
          eventId: null,
          source,
          fingerprint,
          outcome: 'suppressed',
        }));
      }
    }

    // Asked after the SEO events are saved, so a failing estimate never discards them. The source
    // is asked before and after the estimate call, as for the SEO call.
    const priceOfflineBefore = primary ? await this.aiAnswersOffline() : false;
    const priceSuggestion = primary ? await this.priceEstimateSuggestion(product, primary) : null;
    if (priceSuggestion) {
      const priceEvent = await this.savePriceEvent(product, priceSuggestion, priceOfflineBefore);
      if (priceEvent) events.push(priceEvent);
    }

    await this.eventPublisher.publish(this.runCompletedEvent(workspace.id, events.length));
    return events;
  }

  /**
   * The research job's re-estimate: estimates from the stored research without requesting a run or
   * running SEO (the job's own run may still be active), and replaces the product's pending price
   * event (an "unavailable" result replaces only earlier notices). A stored estimate not worth
   * surfacing still closes the pending ones: they predate the research the job just stored. An estimate refused as stale closes nothing. Null when
   * the product or its listing is gone, or nothing is surfaced.
   */
  async reestimatePrice(workspaceId: string, productId: string): Promise<HermesEvent | null> {
    const product = await this.productRepo.findByIdForWorkspace(productId, workspaceId);
    if (!product) return null;
    const [primary] = await this.listingRepo.findByProduct(product.id);
    if (!primary) return null;
    const offlineBefore = await this.aiAnswersOffline();
    const { suggestion, stored } = await this.priceEstimates.estimate(product, primary, { ignoreActiveRun: true });
    if (suggestion) {
      const supersedes = suggestion.type === 'price_estimate_unavailable' ? PRICE_NOTICE_TYPES : PRICE_EVENT_TYPES;
      return this.savePriceEvent(product, suggestion, offlineBefore, supersedes);
    }
    if (stored === null) return null;
    await this.closePendingPriceEvents(product, PRICE_EVENT_TYPES);
    return null;
  }

  /**
   * Re-estimates after a finished research run when the estimate may be out of date or a notice is
   * waiting for it: the run threw, timed out or expired (no run result), failed, changed the ladder,
   * left a pending "unavailable" notice, or no estimate is stored yet. Null when nothing is surfaced.
   */
  async reestimateAfterResearch(
    workspaceId: string,
    productId: string,
    run: { outcome: RunOutcome; rowsChanged: boolean } | null,
  ): Promise<HermesEvent | null> {
    const due =
      run === null ||
      run.outcome === 'failed' ||
      run.rowsChanged ||
      (await this.eventRepo.findPendingByProduct(workspaceId, productId, PRICE_NOTICE_TYPES)).length > 0 ||
      !(await this.priceEstimates.hasStoredEstimate(workspaceId, productId));
    return due ? this.reestimatePrice(workspaceId, productId) : null;
  }

  // Review-only like the SEO suggestions; an "unavailable" notice is no AI-made change. The product's
  // earlier pending events of the superseded types are closed in the same save.
  private async savePriceEvent(
    product: Product,
    suggestion: Suggestion,
    offlineBefore: boolean,
    supersedes: readonly HermesEventType[] = PRICE_EVENT_TYPES,
  ): Promise<HermesEvent | null> {
    const source =
      suggestion.change === null
        ? null
        : offlineBefore || (await this.aiAnswersOffline())
          ? 'offline'
          : 'hermes';
    const created = HermesEvent.create({
      id: this.idFactory(),
      workspaceId: product.workspaceId,
      productId: product.id,
      type: suggestion.type,
      severity: suggestion.severity,
      title: suggestion.title,
      detail: source === 'offline' ? withOfflineNotice(suggestion.detail) : suggestion.detail,
      proposedChange: suggestion.change,
      status: 'pending_review',
      autonomyDecision: 'pending_review',
      source,
    });
    if (created.isErr()) return null;
    await this.closePendingPriceEvents(product, supersedes);
    await this.eventRepo.saveAll([created.value]);
    return created.value;
  }

  // Dismisses the product's events of the given types that are still pending when the write runs.
  private async closePendingPriceEvents(product: Product, types: readonly HermesEventType[]): Promise<void> {
    await this.eventRepo.dismissPendingByProduct(product.workspaceId, product.id, types, new Date());
  }

  private agentRecommendationRecord(params: {
    id: string;
    workspace: Workspace;
    productId: string;
    eventId: string | null;
    source: string;
    fingerprint: string;
    outcome: AgentRecommendationRecord['outcome'];
  }): AgentRecommendationRecord {
    return {
      id: params.id,
      workspaceId: params.workspace.id,
      productId: params.productId,
      eventId: params.eventId,
      agentId: listingSeoProfile.id,
      agentVersion: listingSeoProfile.version,
      creativityPreset: params.workspace.creativityPreset,
      sourceFingerprint: params.source,
      recommendationFingerprint: params.fingerprint,
      outcome: params.outcome,
      suggestedAt: new Date(),
    };
  }

  determineAutonomy(
    autonomyLevel: AutonomyLevel,
    eventType: HermesEventType,
    severity: HermesSeverity
  ): AutonomyDecision {
    if (autonomyLevel === 'suggest_only') {
      return 'pending_review';
    }

    if (autonomyLevel === 'full_auto') {
      if (severity === 'critical' && eventType === 'competitor_price_detected') {
        return 'pending_review';
      }
      return 'auto_apply';
    }

    if (autonomyLevel === 'balanced') {
      return BALANCED_SAFE_EVENT_TYPES.includes(eventType) ? 'auto_apply' : 'pending_review';
    }

    return 'pending_review';
  }

  // Enforce the workspace's configurable Hermes guardrails (ARCHITECTURE_AMENDMENTS
  // FIX #5). Returns false when the proposed auto-apply would violate a guardrail,
  // in which case the caller downgrades the event to pending_review. Guardrails:
  //   - autoAdjustPricing / autoCreateListings / autoRelist / smartTitleAndSEO:
  //     per-action master switches for auto-application
  //   - maxAutoPriceChangePct: max |price change| % allowed without review
  //   - minMarginFloor: minimum (price - cost)/price margin % to auto-apply a price
  // Informational events (e.g. suggested_more_photos) are not guardrail-gated.
  passesGuardrails(product: Product, event: HermesEvent, workspace: Workspace): boolean {
    const g = workspace.guardrails;
    const change = event.proposedChange;

    if (change && change.kind === 'price') {
      if (!g.autoAdjustPricing) return false;
      const { from, to } = change;
      if (from > 0) {
        const pctChange = Math.abs(to - from) / from;
        if (pctChange > g.maxAutoPriceChangePct / 100) return false;
      }
      if (to > 0) {
        if (!product.costPrice) return false;
        const margin = (to - product.costPrice.amount) / to;
        if (margin < g.minMarginFloor / 100) return false;
      }
      return true;
    }

    switch (event.type) {
      case 'create_listing':
        return g.autoCreateListings;
      case 'relist':
      case 'needs_relisting':
        return g.autoRelist;
      case 'suggested_better_title':
      case 'update_description':
        return g.smartTitleAndSEO;
      default:
        return true;
    }
  }

  // Asks for a background research run when one is due and never waits for it: the estimate uses
  // the stored research. A run that could not even be requested is noted on the estimate.
  private async requestResearch(product: Product): Promise<string | null> {
    if (!this.researchRuns) return null;
    try {
      await this.researchRuns.request(product.workspaceId, product.id, { force: false, trigger: 'analyze' });
      return null;
    } catch (error) {
      // A full workspace queue means the research was not started, not that it failed.
      if (error instanceof TooManyRequestsError) {
        this.logger?.warn({ productId: product.id }, 'Price research not started: the workspace queue is full');
        return null;
      }
      this.logger?.warn({ productId: product.id, err: error }, 'Requesting price research failed');
      return RESEARCH_UNAVAILABLE_NOTE;
    }
  }

  /**
   * Requests a research run (never waits for it), then estimates from the stored research. With no
   * ladder stored and a run active, the seller gets the pending notice; the job estimates later.
   */
  private async priceEstimateSuggestion(
    product: Product,
    primary: Listing
  ): Promise<Suggestion | null> {
    const researchNote = await this.requestResearch(product);
    const { suggestion, skipped } = await this.priceEstimates.estimate(product, primary, { researchNote });
    return skipped === 'research_pending' ? PRICE_ESTIMATE_PENDING : suggestion;
  }

  async checkConditions(product: Product): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    const listings = await this.listingRepo.findByProduct(product.id);

    // Check 1: expired listings -> needs relisting
    const expired = listings.filter((l) => l.isExpired());
    if (expired.length > 0) {
      suggestions.push({
        type: 'needs_relisting',
        severity: 'warning',
        title: 'Listing expired',
        detail: `${expired.length} listing(s) have expired`,
        change: {
          kind: 'relist',
          action: 'relist',
          listingIds: expired.map((l) => l.id),
        },
      });
    }

    // Check 2 + 3: AI-driven price and title suggestions (via abstracted provider)
    if (listings.length > 0) {
      const priceSuggestion = await this.priceEstimateSuggestion(product, listings[0]);
      if (priceSuggestion) suggestions.push(priceSuggestion);

      const titleResult = await this.aiProvider.generateTitle(product, null);
      if (titleResult !== product.name && titleResult.length <= 120) {
        suggestions.push({
          type: 'suggested_better_title',
          severity: 'info',
          title: 'Improve product title for search',
          detail: titleResult,
          change: {
            kind: 'title',
            field: 'title',
            from: product.name,
            to: titleResult,
          },
        });
      }
    }

    // Check 4: missing photos
    if (product.imageCount < 3) {
      suggestions.push({
        type: 'suggested_more_photos',
        severity: 'info',
        title: 'Add more photos',
        detail: 'Listings with three or more photos usually get more attention.',
        change: null,
      });
    }

    return suggestions;
  }

  async applyChange(product: Product, change: ProposedChange): Promise<Result<void>> {
    if (change === null) return Ok(undefined);

    switch (change.kind) {
      case 'price': {
        const money = Money.of(change.to, product.sellingPrice.currency);
        if (money.isErr()) return money;
        // AI-driven auto-apply may go below cost; > 20% drops are already gated
        // to human review by requiresHumanReview().
        const updated = product.updateSellingPrice(money.value, true);
        if (updated.isErr()) return updated;
        await this.productRepo.save(product);
        return Ok(undefined);
      }
      case 'title': {
        const renamed = product.rename(change.to);
        if (renamed.isErr()) return renamed;
        await this.productRepo.save(product);
        return Ok(undefined);
      }
      case 'description': {
        const updated = product.updateDescription(change.to);
        if (updated.isErr()) return updated;
        await this.productRepo.save(product);
        return Ok(undefined);
      }
      case 'relist':
      case 'create_listing':
        // Listing-level changes require the publish/relist job flow (a job queue),
        // which the decision engine does not have. Rather than mark the event
        // `applied` while doing nothing (C6), signal that it cannot be auto-applied
        // here so run() downgrades it to pending_review for a human to action.
        return Err(
          new InvalidStateError(
            `${change.kind} cannot be auto-applied by the decision engine; routed to review`
          )
        );
      default:
        return Err(new ValidationError('Unknown proposed change'));
    }
  }

  private async aiAnswersOffline(): Promise<boolean> {
    return (
      isAIProviderSourceAware(this.aiProvider) &&
      (await this.aiProvider.activeProvider()) === 'offline'
    );
  }

  private runCompletedEvent(workspaceId: string, count: number): DomainEvent {
    return {
      type: 'hermes.run_completed',
      aggregateType: 'Workspace',
      aggregateId: workspaceId,
      payload: { workspaceId, eventCount: count },
      occurredAt: new Date(),
    };
  }
}
