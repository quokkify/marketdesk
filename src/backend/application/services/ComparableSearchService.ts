// Finds OLX adverts comparable to a product through the web-enabled Hermes research profile.
// Nothing is stored: the seller picks candidates and saves them through the price research PUT.
// The research profile is checked before every search and must enable exactly the web toolset.

import type { ComparableCandidate } from '../../../shared/types';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
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
  COMPARABLE_SEARCH_OPERATION,
  buildComparableSearchPrompt,
  filterComparableCandidates,
  isResearchToolsetSafe,
  parseComparableCandidates,
} from '../../infrastructure/external/comparableSearchPrompt';
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

export class ComparableSearchService {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly research: ComparableResearchProfile | null,
  ) {}

  // The workspace check comes first, so another workspace's product is a 404 whatever the setup.
  async search(
    workspaceId: string,
    productId: string,
  ): Promise<{ candidates: ComparableCandidate[]; searchedAt: string }> {
    const product = await this.productRepo.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    if (!this.research) throw new ServiceUnavailableError(SEARCH_NOT_CONFIGURED);

    const listing = (await this.listingRepo.findByProduct(product.id))[0];
    if (!listing || listing.price.currency !== SEARCH_CURRENCY) {
      throw new ValidationError(SEARCH_NEEDS_PLN);
    }

    const profile = await this.research.checkProfile();
    if (!profile.reachable) {
      throw new ServiceUnavailableError('Market search is unavailable: the research profile is not reachable');
    }
    if (!isResearchToolsetSafe(profile.enabledToolsets)) {
      const enabled = profile.enabledToolsets.length ? profile.enabledToolsets.join(', ') : 'none';
      throw new ServiceUnavailableError(
        `Market search is unavailable: the research profile must enable only the web toolset (enabled: ${enabled})`,
      );
    }

    const categoryPath = listing.marketplaceCategory?.path ?? [];
    const { system, prompt } = buildComparableSearchPrompt({
      name: product.name,
      condition: product.condition,
      category: categoryPath[categoryPath.length - 1] ?? product.category,
      currency: listing.price.currency,
    });
    const client = this.research.client;
    let raw: string;
    try {
      ({ value: raw } = await withAiUsageScope(
        { workspaceId, feature: AI_FEATURE, productId: product.id },
        () => withAiOperation(COMPARABLE_SEARCH_OPERATION, () => client.complete({ system, prompt })),
      ));
    } catch (error) {
      // Unavailability stays a 503; a 2xx answer without usable content is a bad gateway.
      if (error instanceof DomainError) throw error;
      throw new BadGatewayError(SEARCH_UNUSABLE, error);
    }

    const items = parseComparableCandidates(raw);
    if (!items) throw new BadGatewayError(SEARCH_UNUSABLE);
    return {
      candidates: filterComparableCandidates(items, {
        currency: listing.price.currency,
        ownUrl: listing.externalUrl,
      }),
      searchedAt: new Date().toISOString(),
    };
  }
}
