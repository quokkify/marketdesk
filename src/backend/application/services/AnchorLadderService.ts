// Researches the price anchor ladder of a product through the web-enabled Hermes research profile
// and stores it. The research profile is checked before every call and must enable exactly the web
// toolset. From the first call attempt on, every outcome records the attempt, so a failing search
// is not retried until the ladder is stale again.

import type { PriceResearch } from '../../../shared/types';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IPriceResearchRepository } from '../../domain/repositories/interfaces/IPriceResearchRepository';
import type { IPriceResearchRefresher, LadderOutcome } from '../../domain/ports/IPriceResearchRefresher';
import type { AITextCompletionClient } from '../../infrastructure/external/HermesAI';
import type { HermesReachability } from '../../infrastructure/external/HermesHealthProbe';
import {
  BadGatewayError,
  DomainError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../domain/shared/DomainError';
import {
  ANCHOR_LADDER_OPERATION,
  buildAnchorLadderPrompt,
  filterAnchorRows,
  isResearchToolsetSafe,
  parseAnchorLadder,
} from '../../infrastructure/external/anchorLadderPrompt';
import { mergeLadder } from '../../domain/services/anchorLadder';
import { isResearchFresh } from '../../domain/services/researchFreshness';
import { withAiOperation, withAiUsageScope } from '../ai/aiUsageScope';

export const SEARCH_NOT_CONFIGURED = 'Market search is not configured';
export const SEARCH_NEEDS_PLN = 'OLX search needs a PLN listing';
export const SEARCH_UNUSABLE = 'Hermes returned no usable results';

const SEARCH_CURRENCY = 'PLN';
const AI_FEATURE = 'research';

export interface ComparableResearchProfile {
  client: AITextCompletionClient;
  // A fresh answer for every search: the guard must not act on a cached toolset list.
  checkProfile(): Promise<Pick<HermesReachability, 'reachable' | 'enabledToolsets'>>;
}

// Structural, so the container can pass its logger.
export interface AnchorLadderLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export class AnchorLadderService implements IPriceResearchRefresher {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly priceResearchRepo: IPriceResearchRepository,
    private readonly research: ComparableResearchProfile | null,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: AnchorLadderLogger,
  ) {}

  async refreshIfStale(workspaceId: string, productId: string): Promise<LadderOutcome> {
    try {
      const stored = await this.priceResearchRepo.findByProduct(workspaceId, productId);
      if (isResearchFresh(stored?.lastAttemptAt ?? null, this.now())) return 'fresh';
      await this.refresh(workspaceId, productId);
      return 'refreshed';
    } catch (error) {
      if (error instanceof ServiceUnavailableError && error.message === SEARCH_NOT_CONFIGURED) return 'not_configured';
      if (error instanceof ValidationError && error.message === SEARCH_NEEDS_PLN) return 'not_pln';
      this.logger?.error({ productId, err: error }, 'Price anchor ladder refresh failed');
      return 'unavailable';
    }
  }

  // The workspace check comes first, so another workspace's product is a 404 whatever the setup.
  async refresh(workspaceId: string, productId: string): Promise<PriceResearch> {
    const product = await this.productRepo.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    if (!this.research) throw new ServiceUnavailableError(SEARCH_NOT_CONFIGURED);

    const listing = (await this.listingRepo.findByProduct(product.id))[0];
    if (!listing || listing.price.currency !== SEARCH_CURRENCY) {
      throw new ValidationError(SEARCH_NEEDS_PLN);
    }

    const attemptedAt = this.now().toISOString();
    try {
      return await this.runResearch(workspaceId, product, listing, this.research, attemptedAt);
    } catch (error) {
      // The original failure matters more than a second one while recording the attempt.
      try {
        await this.priceResearchRepo.markAttempt(workspaceId, product.id, attemptedAt);
      } catch (markError) {
        this.logger?.warn({ productId: product.id, err: markError }, 'Recording the failed research attempt failed');
      }
      throw error;
    }
  }

  private async runResearch(
    workspaceId: string,
    product: NonNullable<Awaited<ReturnType<IProductRepository['findByIdForWorkspace']>>>,
    listing: Awaited<ReturnType<IListingRepository['findByProduct']>>[number],
    research: ComparableResearchProfile,
    attemptedAt: string,
  ): Promise<PriceResearch> {
    const categoryPath = listing.marketplaceCategory?.path ?? [];
    const { system, prompt } = buildAnchorLadderPrompt({
      name: product.name,
      condition: product.condition,
      category: categoryPath[categoryPath.length - 1] ?? product.category,
      currency: listing.price.currency,
    });

    const profile = await research.checkProfile();
    if (!profile.reachable) {
      throw new ServiceUnavailableError('Market search is unavailable: the research profile is not reachable');
    }
    if (!isResearchToolsetSafe(profile.enabledToolsets)) {
      const enabled = profile.enabledToolsets.length ? profile.enabledToolsets.join(', ') : 'none';
      throw new ServiceUnavailableError(
        `Market search is unavailable: the research profile must enable only the web toolset (enabled: ${enabled})`,
      );
    }

    let raw: string;
    try {
      ({ value: raw } = await withAiUsageScope(
        { workspaceId, feature: AI_FEATURE, productId: product.id },
        () => withAiOperation(ANCHOR_LADDER_OPERATION, () => research.client.complete({ system, prompt })),
      ));
    } catch (error) {
      // Unavailability stays a 503; a 2xx answer without usable content is a bad gateway.
      if (error instanceof DomainError) throw error;
      throw new BadGatewayError(SEARCH_UNUSABLE, error);
    }

    const parsed = parseAnchorLadder(raw);
    if (!parsed) throw new BadGatewayError(SEARCH_UNUSABLE);

    const stored = await this.priceResearchRepo.findByProduct(workspaceId, product.id);
    const found = filterAnchorRows(parsed.anchors, {
      currency: listing.price.currency,
      ownUrl: listing.externalUrl,
      dismissed: new Set(stored?.dismissedUrls ?? []),
      today: attemptedAt.slice(0, 10),
    });
    return this.priceResearchRepo.saveLadder(workspaceId, product.id, {
      comparables: mergeLadder(stored?.comparables ?? [], found),
      specs: parsed.specs,
      attemptedAt,
    });
  }
}
