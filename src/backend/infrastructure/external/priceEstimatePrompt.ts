// Prompt and answer parser for the Hermes price estimate. Seller-entered text
// (name, description, comparable notes, source label) reaches the prompt only
// through sellerDataBlock.

import type { PriceEstimateContext } from '../../domain/ports/IAIProvider';
import type { AnchorTier, FigureBasis, PriceComparable, PriceEstimate } from '../../../shared/types';
import { sellerDataBlock } from './sellerData';

export const PRICE_ESTIMATE_OPERATION = 'estimatePrice';

const FIGURE_BASES: readonly FigureBasis[] = ['observed', 'estimated'];

const figureBasisSchema = { type: 'string', enum: [...FIGURE_BASES] };

export const priceEstimateJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    startPrice: { type: 'number' },
    floorPrice: { type: 'number' },
    retailAnchor: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: { amount: { type: 'number' }, basis: figureBasisSchema },
          required: ['amount', 'basis'],
        },
      ],
    },
    usedRange: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            low: { type: 'number' },
            high: { type: 'number' },
            basis: figureBasisSchema,
          },
          required: ['low', 'high', 'basis'],
        },
      ],
    },
    reasoning: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['startPrice', 'floorPrice', 'retailAnchor', 'usedRange', 'reasoning', 'confidence'],
};

function counter(value: number | null): string {
  return value === null ? 'unavailable' : String(value);
}

// Untiered rows are same-model used prices, the same rule the server applies to the estimate.
function groupByTier(rows: readonly PriceComparable[]): Record<AnchorTier, PriceComparable[]> {
  const groups: Record<AnchorTier, PriceComparable[]> = {
    same_model_used: [],
    last_new_price: [],
    substitute_new: [],
    substitute_used: [],
  };
  for (const row of rows) groups[row.tier ?? 'same_model_used'].push(row);
  return groups;
}

export function buildPriceEstimatePrompt(ctx: PriceEstimateContext): string {
  const { product, listing, daysLive, research } = ctx;
  const currency = listing.price.currency;
  const anchor =
    research && research.retailPrice !== null && research.retailCurrency !== null
      ? {
          amount: research.retailPrice,
          currency: research.retailCurrency,
          source: research.retailSource,
          checkedAt: research.retailCheckedAt,
        }
      : 'none';

  return [
    'You are a pricing strategist for a used-item listing on the marketplace. Goal: sell within 1-2 weeks with at most 5-10 % haggling.',
    sellerDataBlock({
      name: product.name,
      condition: product.condition,
      category: listing.marketplaceCategory?.path.join(' > ') ?? product.category,
      description: product.description,
      missingAccessories: product.missingAccessories,
      retailAnchor: anchor,
      specs: research?.specs ?? null,
      comparables: groupByTier(research?.comparables ?? []),
    }),
    // The engine compares the estimate with the product price, which an approval changes.
    `current price: ${product.sellingPrice.amount} ${currency}`,
    `days live: ${counter(daysLive)}`,
    `views: ${counter(listing.views)}`,
    `watchers: ${counter(listing.watchers)}`,
    `conversations: ${counter(listing.conversations)}`,
    'When the retail anchor is none, estimate it yourself and label it "estimated". Comparables are "observed". startPrice must not exceed the retail anchor, and floorPrice must not exceed startPrice. All amounts are in the listing currency.',
    'If missing accessories are listed, lower the price for them and name the deduction in reasoning.',
    'Comparables are grouped by tier. Start below 70 % of the cheapest new substitutes and below the last new price; the server enforces it. The last_new_price tier is history, not the target.',
    'Respond as JSON with keys "startPrice" (number), "floorPrice" (number),',
    '"retailAnchor" ({amount, basis} or null), "usedRange" ({low, high, basis} or null),',
    '"reasoning" (string), "confidence" ("high", "medium" or "low"); basis is "observed" or "estimated".',
  ].join('\n');
}

function isBasis(value: unknown): value is FigureBasis {
  return value === 'observed' || value === 'estimated';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// Shape check only; range rules live in validatePriceEstimate. The currency is the
// listing's, kept in the signature so a future multi-currency answer can be rejected here.
export function parsePriceEstimate(raw: unknown, _currency: string): PriceEstimate | null {
  if (!isRecord(raw)) return null;
  const { startPrice, floorPrice, retailAnchor, usedRange, reasoning, confidence } = raw;
  if (!isNumber(startPrice) || !isNumber(floorPrice)) return null;
  if (typeof reasoning !== 'string' || reasoning.trim() === '') return null;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;

  let anchor: PriceEstimate['retailAnchor'] = null;
  if (retailAnchor !== null && retailAnchor !== undefined) {
    if (!isRecord(retailAnchor) || !isNumber(retailAnchor.amount) || !isBasis(retailAnchor.basis)) {
      return null;
    }
    anchor = { amount: toCents(retailAnchor.amount), basis: retailAnchor.basis };
  }

  let range: PriceEstimate['usedRange'] = null;
  if (usedRange !== null && usedRange !== undefined) {
    if (
      !isRecord(usedRange) ||
      !isNumber(usedRange.low) ||
      !isNumber(usedRange.high) ||
      !isBasis(usedRange.basis)
    ) {
      return null;
    }
    range = { low: toCents(usedRange.low), high: toCents(usedRange.high), basis: usedRange.basis };
  }

  return {
    startPrice: toCents(startPrice),
    floorPrice: toCents(floorPrice),
    retailAnchor: anchor,
    usedRange: range,
    reasoning: reasoning.trim(),
    confidence,
  };
}
