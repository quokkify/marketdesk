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
  ServiceUnavailableError,
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
  AnchorTier,
  EstimateHiddenReason,
  PriceComparable,
  PriceEstimate,
  ProposedChange,
} from '../../../shared/types';
import { BALANCED_SAFE_EVENT_TYPES } from '../../../shared/constants';
import type { Workspace } from '../entities/Workspace';
import type { IProductRepository } from '../repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../repositories/interfaces/IListingRepository';
import type { IEventRepository } from '../repositories/interfaces/IEventRepository';
import type { IPriceResearchRepository } from '../repositories/interfaces/IPriceResearchRepository';
import type { Listing } from '../entities/Listing';
import { applyLadderRules, estimateHiddenReason, validatePriceEstimate } from './priceEstimate';
import type { IPriceResearchRuns } from '../ports/IPriceResearchRuns';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';
import {
  isAIProviderSourceAware,
  OFFLINE_AI_NOTICE,
  PRICE_ESTIMATE_UNUSABLE_MESSAGE,
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
const USED_TIERS: ReadonlySet<AnchorTier> = new Set(['same_model_used', 'substitute_used']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function unavailablePriceEstimate(detail: string): Suggestion {
  return {
    type: 'price_estimate_unavailable',
    severity: 'info',
    title: 'Price estimate unavailable',
    detail,
    change: null,
  };
}

// The model's own basis labels are not trusted: a figure is observed only when it is the seller's
// research that reached the provider, otherwise it is estimated.
function labelEstimateFigures(
  estimate: PriceEstimate,
  researchAnchor: number | null,
  comparables: readonly PriceComparable[],
): PriceEstimate {
  const retailAnchor = estimate.retailAnchor && {
    amount: estimate.retailAnchor.amount,
    basis: researchAnchor !== null && estimate.retailAnchor.amount === researchAnchor
      ? ('observed' as const)
      : ('estimated' as const),
  };
  let usedRange = estimate.usedRange;
  if (usedRange) {
    const prices = comparables.map((c) => c.price);
    const withinComparables =
      prices.length > 0 &&
      usedRange.low >= Math.min(...prices) &&
      usedRange.high <= Math.max(...prices);
    usedRange = { low: usedRange.low, high: usedRange.high, basis: withinComparables ? 'observed' : 'estimated' };
  }
  return { ...estimate, retailAnchor, usedRange };
}

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
    private readonly priceResearchRepo: IPriceResearchRepository,
    private readonly researchRuns: IPriceResearchRuns | null,
    private readonly idFactory: IdFactory,
    private readonly logger?: HermesEngineLogger
  ) {}

  async run(workspace: Workspace): Promise<HermesEvent[]> {
    const events: HermesEvent[] = [];
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
      // Review-only like the SEO suggestions; an "unavailable" notice is no AI-made change.
      const priceSource =
        priceSuggestion.change === null
          ? null
          : priceOfflineBefore || (await this.aiAnswersOffline())
            ? 'offline'
            : 'hermes';
      const created = HermesEvent.create({
        id: this.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        type: priceSuggestion.type,
        severity: priceSuggestion.severity,
        title: priceSuggestion.title,
        detail:
          priceSource === 'offline'
            ? withOfflineNotice(priceSuggestion.detail)
            : priceSuggestion.detail,
        proposedChange: priceSuggestion.change,
        status: 'pending_review',
        autonomyDecision: 'pending_review',
        source: priceSource,
      });
      if (created.isOk()) {
        await this.eventRepo.saveAll([created.value]);
        events.push(created.value);
      }
    }

    await this.eventPublisher.publish(this.runCompletedEvent(workspace.id, events.length));
    return events;
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

  // The stored estimate is display-only, so a failed write is logged and the price path goes on.
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

  private async rememberEstimate(
    product: Product,
    estimate: PriceEstimate,
    hiddenReason: EstimateHiddenReason | null,
    researchNote: string | null,
  ): Promise<void> {
    try {
      await this.priceResearchRepo.saveEstimate(product.workspaceId, product.id, {
        estimate,
        estimatedAt: new Date().toISOString(),
        hiddenReason,
        researchNote,
      });
    } catch (error) {
      this.logger?.warn({ productId: product.id, err: error }, 'Storing the last price estimate failed');
    }
  }

  /**
   * Proposes a justified start price for the product's primary listing. Returns null when the
   * estimate is valid but not worth surfacing, and an info-only "unavailable" suggestion when it
   * is unusable or the call failed for any other reason. Provider unavailability propagates.
   */
  private async priceEstimateSuggestion(
    product: Product,
    primary: Listing
  ): Promise<Suggestion | null> {
    const researchNote = await this.requestResearch(product);
    const stored = await this.priceResearchRepo.findByProduct(product.workspaceId, product.id);
    // A retail anchor in another currency must not be compared against the listing price.
    const research =
      stored && stored.retailCurrency && stored.retailCurrency !== primary.price.currency
        ? {
            ...stored,
            retailPrice: null,
            retailCurrency: null,
            retailSource: null,
            retailCheckedAt: null,
          }
        : stored;
    const daysLive = primary.publishedAt
      ? Math.floor((Date.now() - primary.publishedAt.getTime()) / MS_PER_DAY)
      : null;

    let rawEstimate: Awaited<ReturnType<IAIProvider['estimatePrice']>>;
    try {
      rawEstimate = await this.aiProvider.estimatePrice({ product, listing: primary, daysLive, research });
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      // A fixed message: raw error or model text never reaches the seller.
      return unavailablePriceEstimate(PRICE_ESTIMATE_UNUSABLE_MESSAGE);
    }
    const researchAnchor = research?.retailPrice ?? null;
    const validated = validatePriceEstimate(rawEstimate, researchAnchor);
    if (validated.isErr()) return unavailablePriceEstimate(validated.error.message);

    const rows = research?.comparables ?? [];
    const capped = applyLadderRules(validated.value, rows, researchAnchor);
    // Only used prices describe what the item itself sells for; new prices are not a used range.
    const usedRows = rows.filter((r) => r.tier == null || USED_TIERS.has(r.tier));
    const labelled = labelEstimateFigures(capped, researchAnchor, usedRows);
    const currentPrice = product.sellingPrice.amount;
    // A drop never goes below the seller's lowest acceptable price, and a drop the floor cancels
    // is not turned into a raise. Without an explicit floor, the estimate stands as it was.
    const sellerFloor = product.minAcceptablePrice?.amount;
    let estimate = labelled;
    if (sellerFloor !== undefined) {
      const startPrice =
        labelled.startPrice < currentPrice ? Math.max(labelled.startPrice, sellerFloor) : labelled.startPrice;
      if (labelled.startPrice < currentPrice && startPrice >= currentPrice) {
        await this.rememberEstimate(product, labelled, 'floor_cancels', researchNote);
        return null;
      }
      estimate = { ...labelled, startPrice };
    }
    const hiddenReason = estimateHiddenReason(estimate, currentPrice);
    await this.rememberEstimate(product, estimate, hiddenReason, researchNote);
    if (hiddenReason !== null) return null;
    const isLower = estimate.startPrice < currentPrice;
    return {
      type: isLower ? 'suggested_lower_price' : 'suggested_higher_price',
      severity: isLower ? 'warning' : 'info',
      title: `AI suggests price ${estimate.startPrice}`,
      detail: estimate.reasoning,
      change: {
        kind: 'price',
        field: 'price',
        from: currentPrice,
        to: estimate.startPrice,
        estimate,
      },
    };
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
