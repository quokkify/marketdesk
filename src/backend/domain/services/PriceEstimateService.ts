// The estimate-only use case: one price estimate for a product's primary listing from the stored
// research (ceiling, confidence, seller floor, completeness), stored for display and turned into a
// review-only suggestion. Analyze calls it after requesting research; the research job calls it
// after a run that changed the ladder. It never starts research and never runs SEO.

import type { Product } from '../entities/Product';
import type { Listing } from '../entities/Listing';
import type {
  AnchorTier,
  EstimateHiddenReason,
  HermesEventType,
  HermesSeverity,
  PriceComparable,
  PriceEstimate,
  PriceResearch,
  ProposedChange,
  StoredPriceEstimate,
} from '../../../shared/types';
import type { IPriceResearchRepository } from '../repositories/interfaces/IPriceResearchRepository';
import type { IPriceResearchRuns } from '../ports/IPriceResearchRuns';
import { PRICE_ESTIMATE_UNUSABLE_MESSAGE, type IAIProvider } from '../ports/IAIProvider';
import { ServiceUnavailableError } from '../shared/DomainError';
import { applyLadderRules, estimateHiddenReason, validatePriceEstimate } from './priceEstimate';

export interface PriceSuggestion {
  type: HermesEventType;
  severity: HermesSeverity;
  title: string;
  detail: string;
  change: ProposedChange;
}

export interface PriceEstimateResult {
  suggestion: PriceSuggestion | null;
  stored: StoredPriceEstimate | null;
  skipped: 'research_pending' | null;
}

// Structural, so the container can pass its logger.
export interface PriceEstimateLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface PriceEstimateServiceDeps {
  ai: IAIProvider;
  research: IPriceResearchRepository;
  runs: IPriceResearchRuns | null;
  logger?: PriceEstimateLogger;
}

const USED_TIERS: ReadonlySet<AnchorTier> = new Set(['same_model_used', 'substitute_used']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function unavailablePriceEstimate(detail: string): PriceSuggestion {
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

export class PriceEstimateService {
  constructor(private readonly deps: PriceEstimateServiceDeps) {}

  /**
   * Proposes a justified start price for the listing. The suggestion is null when the estimate is
   * valid but not worth surfacing, and an info-only "unavailable" suggestion when it is unusable or
   * the call failed for any other reason; provider unavailability propagates. With no ladder stored
   * and a research run active, nothing is estimated: the run's job produces the first estimate.
   * An estimate the store refuses (computed from older research than the stored one) is neither
   * kept nor proposed: the newer estimate and its suggestion stand.
   * `researchNote` is kept on the stored estimate (Analyze notes a research run it could not request).
   * `ignoreActiveRun` is for the research job itself: its own run is still active while it re-estimates.
   */
  async estimate(
    product: Product,
    listing: Listing,
    opts: { researchNote?: string | null; ignoreActiveRun?: boolean } = {},
  ): Promise<PriceEstimateResult> {
    const stored = await this.deps.research.findByProduct(product.workspaceId, product.id);
    if (!opts.ignoreActiveRun && (await this.researchPending(product, stored))) {
      return { suggestion: null, stored: null, skipped: 'research_pending' };
    }
    const researchNote = opts.researchNote ?? null;
    const researchUpdatedAt = stored?.updatedAt ?? null;
    // A retail anchor in another currency must not be compared against the listing price.
    const research =
      stored && stored.retailCurrency && stored.retailCurrency !== listing.price.currency
        ? {
            ...stored,
            retailPrice: null,
            retailCurrency: null,
            retailSource: null,
            retailCheckedAt: null,
          }
        : stored;
    const daysLive = listing.publishedAt
      ? Math.floor((Date.now() - listing.publishedAt.getTime()) / MS_PER_DAY)
      : null;

    let rawEstimate: PriceEstimate;
    try {
      rawEstimate = await this.deps.ai.estimatePrice({ product, listing, daysLive, research });
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      // A fixed message: raw error or model text never reaches the seller.
      return { suggestion: unavailablePriceEstimate(PRICE_ESTIMATE_UNUSABLE_MESSAGE), stored: null, skipped: null };
    }
    const researchAnchor = research?.retailPrice ?? null;
    const validated = validatePriceEstimate(rawEstimate, researchAnchor);
    if (validated.isErr()) {
      return { suggestion: unavailablePriceEstimate(validated.error.message), stored: null, skipped: null };
    }

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
        const kept = await this.remember(product, labelled, 'floor_cancels', researchNote, researchUpdatedAt);
        return { suggestion: null, stored: kept, skipped: null };
      }
      estimate = { ...labelled, startPrice };
    }
    const hiddenReason = estimateHiddenReason(estimate, currentPrice);
    const kept = await this.remember(product, estimate, hiddenReason, researchNote, researchUpdatedAt);
    if (kept === null || hiddenReason !== null) return { suggestion: null, stored: kept, skipped: null };
    const isLower = estimate.startPrice < currentPrice;
    return {
      suggestion: {
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
      },
      stored: kept,
      skipped: null,
    };
  }

  // A run state that cannot be read does not hold the estimate back: it is logged and the estimate goes on.
  private async researchPending(product: Product, research: PriceResearch | null): Promise<boolean> {
    if (!this.deps.runs || (research !== null && research.comparables.length > 0)) return false;
    try {
      const { active } = await this.deps.runs.latest(product.workspaceId, product.id);
      return active !== null;
    } catch (error) {
      this.deps.logger?.warn({ productId: product.id, err: error }, 'Reading the price research run failed');
      return false;
    }
  }

  // Null when the store refused the estimate as stale. A failed write is logged and the price path
  // goes on: the stored estimate is display-only.
  private async remember(
    product: Product,
    estimate: PriceEstimate,
    hiddenReason: EstimateHiddenReason | null,
    researchNote: string | null,
    researchUpdatedAt: string | null,
  ): Promise<StoredPriceEstimate | null> {
    const stored: StoredPriceEstimate = {
      estimate,
      estimatedAt: new Date().toISOString(),
      hiddenReason,
      researchNote,
      researchUpdatedAt,
    };
    try {
      if (!(await this.deps.research.saveEstimate(product.workspaceId, product.id, stored))) return null;
    } catch (error) {
      this.deps.logger?.warn({ productId: product.id, err: error }, 'Storing the last price estimate failed');
    }
    return stored;
  }
}
