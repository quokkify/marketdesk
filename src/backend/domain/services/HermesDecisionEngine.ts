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
import { ValidationError, InvalidStateError, NotFoundError } from '../shared/DomainError';
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
import { ListingSeoProposals } from '../../application/services/verdict/ListingSeoProposals';
import { PriceProposals } from '../../application/services/verdict/PriceProposals';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';
import type { IAIProvider } from '../ports/IAIProvider';
import {
  aiAnswersOffline,
  withOfflineNotice,
  PRICE_ESTIMATE_PENDING,
  PRICE_EVENT_TYPES,
  type HermesEngineLogger,
  type IdFactory,
} from './proposalSupport';

export type { HermesEngineLogger, IdFactory };

interface Suggestion {
  type: HermesEventType;
  severity: HermesSeverity;
  title: string;
  detail: string;
  change: ProposedChange;
}

const AI_MADE_CHANGE_KINDS: ReadonlySet<string> = new Set(['title', 'price', 'description']);

export class HermesDecisionEngine {
  private readonly seoProposals: ListingSeoProposals;
  private readonly priceProposals: PriceProposals;

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
  ) {
    this.seoProposals = new ListingSeoProposals({
      products: productRepo,
      listings: listingRepo,
      events: eventRepo,
      ai: aiProvider,
      idFactory,
      logger,
    });
    this.priceProposals = new PriceProposals({
      products: productRepo,
      listings: listingRepo,
      events: eventRepo,
      estimates: priceEstimates,
      runs: researchRuns,
      ai: aiProvider,
      idFactory,
      logger,
    });
  }

  async run(workspace: Workspace): Promise<HermesEvent[]> {
    const events: HermesEvent[] = [];
    // Products whose earlier pending price events this run supersedes; closed when its events are saved.
    const superseding = new Set<Product>();
    const products = await this.productRepo.findByWorkspace(workspace.id);

    for (const product of products) {
      // Asked before and after the AI calls, so a switch to the offline heuristics at
      // any point during the check keeps this product's AI-made changes review-only.
      const offlineBefore = await aiAnswersOffline(this.aiProvider);
      const suggestions = await this.checkConditions(product);
      const answeredOffline = offlineBefore || (await aiAnswersOffline(this.aiProvider));

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

  /** Product-scoped safe slice: listing SEO, then the price estimate; SEO is always review-only and never auto-applied. */
  async runProductSeo(workspace: Workspace, productId: string): Promise<HermesEvent[]> {
    const product = await this.productRepo.findByIdForWorkspace(productId, workspace.id);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    if (!workspace.listingSeoEnabled) return [];

    const listings = await this.listingRepo.findByProduct(product.id);
    const primary = listings[0] ?? null;
    const events = await this.seoProposals.propose(workspace, product, primary);

    // Asked after the SEO events are saved, so a failing estimate never discards them.
    if (primary) {
      const researchNote = await this.priceProposals.requestResearch(product);
      const { event } = await this.priceProposals.proposeWithEvent(product, primary, { researchNote });
      if (event) events.push(event);
    }

    await this.eventPublisher.publish(this.runCompletedEvent(workspace.id, events.length));
    return events;
  }

  async reestimatePrice(workspaceId: string, productId: string): Promise<HermesEvent | null> {
    return this.priceProposals.reestimatePrice(workspaceId, productId);
  }

  async reestimateAfterResearch(
    workspaceId: string,
    productId: string,
    run: { outcome: RunOutcome; rowsChanged: boolean } | null,
  ): Promise<HermesEvent | null> {
    return this.priceProposals.reestimateAfterResearch(workspaceId, productId, run);
  }

  // Dismisses the product's events of the given types that are still pending when the write runs.
  private async closePendingPriceEvents(product: Product, types: readonly HermesEventType[]): Promise<void> {
    await this.eventRepo.dismissPendingByProduct(product.workspaceId, product.id, types, new Date());
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

  /**
   * Requests a research run (never waits for it), then estimates from the stored research. With no
   * ladder stored and a run active, the seller gets the pending notice; the job estimates later.
   */
  private async priceEstimateSuggestion(
    product: Product,
    primary: Listing
  ): Promise<Suggestion | null> {
    const researchNote = await this.priceProposals.requestResearch(product);
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
