// Domain port for the AI provider (ARCHITECTURE_AMENDMENTS FIX #1).
// The domain depends ONLY on this abstraction — no vendor/model detail leaks in.
// Concrete implementations (for example the Hermes Agent API adapter) live in infrastructure.

import type { Product } from '../entities/Product';
import type { Listing } from '../entities/Listing';
import type { Marketplace } from '../entities/Marketplace';
import type {
  CreativityPreset,
  ListingSeoInput,
  ListingSeoOutput,
} from '../agents/MarketDeskAgentCatalog';

export interface PriceSuggestionContext {
  listing: Listing;
  recentViews: number;
  conversionRate: number;
  competitorPrice?: number;
  // Product cost in the listing currency, when known.
  costPrice?: number;
}

export interface PriceSuggestion {
  suggestedPrice: number;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ListingAnalysis {
  score: number; // 0-100
  suggestions: string[];
}

export interface IAIProvider {
  // Generate a pricing suggestion for a listing.
  suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion>;

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

// Optional capability of a provider that may answer from built-in offline heuristics
// instead of Hermes. HermesDecisionEngine keeps changes made while offline review-only.
export interface AIProviderSourceAware {
  // The source that would answer the next call.
  activeProvider(): Promise<'hermes' | 'offline'>;
}

export function isAIProviderSourceAware(
  provider: IAIProvider
): provider is IAIProvider & AIProviderSourceAware {
  return typeof (provider as Partial<AIProviderSourceAware>).activeProvider === 'function';
}
