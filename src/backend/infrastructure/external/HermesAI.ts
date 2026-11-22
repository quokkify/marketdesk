// Hermes-agent-backed implementation of the domain IAIProvider port.
//
// The application does not call a vendor LLM directly. It talks to the local
// Hermes Agent API Server through an injectable text-completion boundary, so the
// same native Hermes instance running on this VPS owns model/provider/tooling
// decisions. MarketDesk only uses a Hermes profile whose API server has no tools enabled
// (checked by HermesHealthProbe) and sends seller content as a <seller_data> block.

import {
  PRICE_ESTIMATE_UNUSABLE_MESSAGE,
  type IAIProvider,
  type PriceEstimateContext,
  type PriceSuggestionContext,
  type PriceSuggestion,
  type ListingAnalysis,
} from '../../domain/ports/IAIProvider';
import type { PriceEstimate } from '../../../shared/types';
import {
  PRICE_ESTIMATE_OPERATION,
  buildPriceEstimatePrompt,
  parsePriceEstimate,
  priceEstimateJsonSchema,
} from './priceEstimatePrompt';
import { SELLER_DATA_RULE, sellerDataBlock } from './sellerData';
import type { Product } from '../../domain/entities/Product';
import type { Marketplace } from '../../domain/entities/Marketplace';
import {
  getMarketDeskAgent,
  listingSeoOutputSchema,
  type CreativityPreset,
  type ListingSeoInput,
  type ListingSeoOutput,
} from '../../domain/agents/MarketDeskAgentCatalog';
import { withAiOperation } from '../../application/ai/aiUsageScope';
import { parseJsonObject } from './jsonText';

export const DEFAULT_HERMES_MODEL = 'hermes-agent';
export const DEFAULT_HERMES_API_URL = 'http://127.0.0.1:8642/v1';

export interface HermesAIConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  // HERMES_BILLING_MODE: `subscription_included` marks calls as included in the plan.
  billingMode?: string;
}

export const DEFAULT_HERMES_RESEARCH_TIMEOUT_MS = 180_000;
export const DEFAULT_HERMES_RESEARCH_MAX_CONCURRENCY = 3;

// How many research calls may run at once in this process (HERMES_RESEARCH_MAX_CONCURRENCY).
export function loadHermesResearchMaxConcurrency(): number {
  const value = Number.parseInt(process.env.HERMES_RESEARCH_MAX_CONCURRENCY ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HERMES_RESEARCH_MAX_CONCURRENCY;
}

// The web-enabled research profile, used only by the market search. null when its URL or key is
// empty or the key is a your_-prefixed placeholder; it shares the model and billing mode.
export function loadHermesResearchConfig(): HermesAIConfig | null {
  const apiUrl = (process.env.HERMES_RESEARCH_API_URL ?? '').trim();
  const apiKey = (process.env.HERMES_RESEARCH_API_KEY ?? '').trim();
  if (apiUrl === '' || apiKey === '' || apiKey.startsWith('your_')) return null;
  const timeoutMs = Number.parseInt(process.env.HERMES_RESEARCH_TIMEOUT_MS ?? '', 10);
  const main = loadHermesConfig();
  return {
    apiUrl,
    apiKey,
    model: main.model,
    maxTokens: main.maxTokens,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_HERMES_RESEARCH_TIMEOUT_MS,
    billingMode: main.billingMode,
  };
}

export function loadHermesConfig(): HermesAIConfig {
  return {
    apiUrl: process.env.HERMES_API_URL ?? DEFAULT_HERMES_API_URL,
    apiKey: process.env.HERMES_API_KEY ?? '',
    model: process.env.HERMES_MODEL ?? DEFAULT_HERMES_MODEL,
    maxTokens: Number.parseInt(process.env.HERMES_MAX_TOKENS ?? '2048', 10),
    timeoutMs: Number.parseInt(process.env.HERMES_REQUEST_TIMEOUT_MS ?? '30000', 10),
    billingMode: process.env.HERMES_BILLING_MODE ?? '',
  };
}

// Thin completion boundary. The concrete Hermes API Server implementation lives
// in HermesCompletionClient; tests inject a fake.
export interface AICompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  // When provided, Hermes is instructed to emit JSON matching this schema.
  jsonSchema?: Record<string, unknown>;
  // Optional stable scope for Hermes conversation/session affinity. Leave unset for stateless calls.
  sessionKey?: string;
  // Aborts the call, together with the client's own timeout.
  signal?: AbortSignal;
}

export interface AITextCompletionClient {
  complete(request: AICompletionRequest): Promise<string>;
}

export class HermesAI implements IAIProvider {
  private readonly client: AITextCompletionClient;
  private readonly maxTokens: number;

  constructor(client: AITextCompletionClient, config?: Pick<HermesAIConfig, 'maxTokens'>) {
    this.client = client;
    this.maxTokens = config?.maxTokens ?? loadHermesConfig().maxTokens;
  }

  async suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion> {
    const { listing, recentViews, conversionRate, competitorPrice } = context;
    const currentPrice = listing.price.amount;
    const currency = listing.price.currency;

    const prompt = [
      'You are a pricing strategist for an online marketplace listing.',
      `Current price: ${currentPrice} ${currency}.`,
      `Recent views: ${recentViews}. Conversion rate: ${(conversionRate * 100).toFixed(2)}%.`,
      competitorPrice !== undefined
        ? `Observed competitor price: ${competitorPrice} ${currency}.`
        : 'No competitor price observed.',
      'Suggest an optimal price and briefly justify it. Respond as JSON with keys',
      '"suggestedPrice" (number, same currency), "reasoning" (string),',
      '"confidence" (one of "high", "medium", "low").',
    ].join('\n');

    const raw = await this.complete('suggestPrice', {
      system: 'You output concise, data-driven pricing recommendations as strict JSON.',
      prompt,
      maxTokens: this.maxTokens,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          suggestedPrice: { type: 'number' },
          reasoning: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['suggestedPrice', 'reasoning', 'confidence'],
      },
    });

    const parsed = this.parseJson(raw);
    const suggestedPrice = this.asFiniteNumber(parsed?.suggestedPrice, currentPrice);
    const confidence = this.asConfidence(parsed?.confidence);
    const reasoning =
      typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'No reasoning provided by Hermes.';

    return { suggestedPrice, reasoning, confidence };
  }

  async estimatePrice(context: PriceEstimateContext): Promise<PriceEstimate> {
    const raw = await this.complete(PRICE_ESTIMATE_OPERATION, {
      system: `You output used-item price estimates as strict JSON.\n${SELLER_DATA_RULE}`,
      prompt: buildPriceEstimatePrompt(context),
      maxTokens: this.maxTokens,
      jsonSchema: priceEstimateJsonSchema,
    });
    const estimate = parsePriceEstimate(this.parseJson(raw), context.listing.price.currency);
    if (!estimate) throw new Error(PRICE_ESTIMATE_UNUSABLE_MESSAGE);
    return estimate;
  }

  async generateTitle(
    product: Product,
    marketplace: Marketplace | null,
    creativityPreset?: 'precise' | 'balanced' | 'creative'
  ): Promise<string> {
    const prompt = [
      'Write a single SEO-optimized marketplace listing title.',
      sellerDataBlock({
        name: product.name,
        category: product.category,
        condition: product.condition,
        ...(marketplace ? { marketplace: marketplace.name } : {}),
      }),
      'Return only the title text, no quotes, no preamble, max 80 characters.',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await this.complete('generateTitle', {
      system:
        (creativityPreset
          ? getMarketDeskAgent('listing-seo').instruction(creativityPreset)
          : 'You are an SEO copywriter. Output only the requested title.') +
        `\n${SELLER_DATA_RULE}`,
      prompt,
      maxTokens: this.maxTokens,
    });

    return this.cleanTitle(raw) || product.name;
  }

  async analyzeListing(product: Product): Promise<ListingAnalysis> {
    const prompt = [
      'Assess the quality of this product listing and suggest improvements.',
      sellerDataBlock({
        name: product.name,
        description: product.description,
        category: product.category,
        condition: product.condition,
        tags: product.tags,
        imageCount: product.imageCount,
      }),
      'Respond as JSON with keys "score" (integer 0-100) and',
      '"suggestions" (array of short actionable strings).',
    ].join('\n');

    const raw = await this.complete('analyzeListing', {
      system: `You output listing-quality assessments as strict JSON.\n${SELLER_DATA_RULE}`,
      prompt,
      maxTokens: this.maxTokens,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          score: { type: 'integer' },
          suggestions: { type: 'array', items: { type: 'string' } },
        },
        required: ['score', 'suggestions'],
      },
    });

    const parsed = this.parseJson(raw);
    const score = this.clampScore(this.asFiniteNumber(parsed?.score, 0));
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === 'string')
      : [];

    return { score, suggestions };
  }

  async analyzeListingSeo(
    input: ListingSeoInput,
    preset: CreativityPreset
  ): Promise<ListingSeoOutput> {
    const profile = getMarketDeskAgent('listing-seo');
    const cleanInput = profile.inputSchema.parse(input);
    const raw = await this.complete('analyzeListingSeo', {
      system: `${profile.instruction(preset)}\n${SELLER_DATA_RULE}`,
      prompt: sellerDataBlock(cleanInput),
      maxTokens: this.maxTokens,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recommendations: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string', enum: ['title', 'description'] },
                proposedValue: { type: 'string', minLength: 1, maxLength: 2000 },
                rationale: { type: 'string', minLength: 1, maxLength: 500 },
              },
              required: ['field', 'proposedValue', 'rationale'],
            },
          },
          disclaimer: { type: 'string', minLength: 1, maxLength: 300 },
        },
        required: ['recommendations', 'disclaimer'],
      },
      sessionKey: `marketdesk:listing-seo:${cleanInput.product.id}`,
    });
    const parsed = this.parseJson(raw);
    const safeParsed = listingSeoOutputSchema.safeParse(parsed);
    if (safeParsed.success) return safeParsed.data;
    throw new Error('Hermes listing-seo output failed strict schema validation');
  }

  // --- helpers ---

  // Names the call after the provider method, so usage records tell the analyses apart.
  private complete(operation: string, request: AICompletionRequest): Promise<string> {
    return withAiOperation(operation, () => this.client.complete(request));
  }

  private parseJson(raw: string): Record<string, unknown> | null {
    return parseJsonObject(raw);
  }

  private asFiniteNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }

  private asConfidence(value: unknown): PriceSuggestion['confidence'] {
    return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
  }

  private clampScore(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private cleanTitle(raw: string): string {
    return raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 120)
      .trim();
  }
}
