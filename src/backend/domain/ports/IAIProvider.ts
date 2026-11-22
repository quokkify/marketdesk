// Domain port for the AI provider (ARCHITECTURE_AMENDMENTS FIX #1).
// The domain depends ONLY on this abstraction — no vendor/model detail leaks in.
// Concrete implementations (for example the Hermes Agent API adapter) live in infrastructure.

import type { Product } from '../entities/Product';
import type { Listing } from '../entities/Listing';
import type { Marketplace } from '../entities/Marketplace';
import type { PriceEstimate, PriceResearch } from '../../../shared/types';
import type {
  CreativityPreset,
  ListingSeoInput,
  ListingSeoOutput,
} from '../agents/MarketDeskAgentCatalog';

export interface PriceEstimateContext {
  product: Product;
  listing: Listing;
  daysLive: number | null;
  research: PriceResearch | null;
}

export interface ListingAnalysis {
  score: number; // 0-100
  suggestions: string[];
}

export interface IAIProvider {
  // Estimate a start and a floor price from the product card, optional research and listing stats.
  estimatePrice(context: PriceEstimateContext): Promise<PriceEstimate>;

  // Generate an SEO-optimized title for a marketplace (marketplace may be null
  // until per-marketplace titles are implemented).
  generateTitle(
    product: Product,
    marketplace: Marketplace | null,
    creativityPreset?: 'precise' | 'balanced' | 'creative'
  ): Promise<string>;

  // Analyze product listing quality and suggest improvements.
  analyzeListing(product: Product): Promise<ListingAnalysis>;

  // Run a MarketDesk-owned, tool-free listing SEO profile over sanitized input only.
  analyzeListingSeo(input: ListingSeoInput, preset: CreativityPreset): Promise<ListingSeoOutput>;
}

// Message of the plain error a provider throws when its price estimate answer cannot be used.
export const PRICE_ESTIMATE_UNUSABLE_MESSAGE = 'Hermes price estimate was not usable';

export { OFFLINE_AI_NOTICE } from '../../../shared/constants';

// Optional capability of a provider that may answer from built-in offline heuristics
// instead of Hermes. Changes made while offline stay review-only.
export interface AIProviderSourceAware {
  // The source that would answer the next call.
  activeProvider(): Promise<'hermes' | 'offline'>;
}

export function isAIProviderSourceAware(
  provider: IAIProvider
): provider is IAIProvider & AIProviderSourceAware {
  return typeof (provider as Partial<AIProviderSourceAware>).activeProvider === 'function';
}
