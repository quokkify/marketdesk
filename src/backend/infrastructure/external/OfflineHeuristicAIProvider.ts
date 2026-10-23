// Built-in heuristic implementation of the IAIProvider port. AIProviderSelector uses
// it when Hermes is not configured or not reachable, or when HERMES_PROVIDER_MODE is
// offline. It never calls the network, reports low confidence, and every price
// reasoning and SEO rationale ends by saying that Hermes was not consulted.

import type {
  IAIProvider,
  ListingAnalysis,
  PriceSuggestion,
  PriceSuggestionContext,
} from '../../domain/ports/IAIProvider';
import type { Product } from '../../domain/entities/Product';
import type { ProductCondition } from '../../../shared/types';
import {
  listingSeoInputSchema,
  listingSeoOutputSchema,
  normalizeRecommendation,
  type ListingSeoInput,
  type ListingSeoOutput,
} from '../../domain/agents/MarketDeskAgentCatalog';

const OFFLINE_NOTICE = 'Heuristic offline suggestion; Hermes was not consulted.';
const TITLE_MAX_LENGTH = 70;

// Appended to titles that do not name the condition yet; "unknown" adds nothing.
const CONDITION_LABELS: Record<ProductCondition, string | null> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good condition',
  fair: 'Fair condition',
  poor: 'Poor condition',
  refurbished: 'Refurbished',
  unknown: null,
};

interface Rewrite {
  value: string;
  changes: string[];
}

export class OfflineHeuristicAIProvider implements IAIProvider {
  // Prices are whole units of the listing currency (PLN), computed in minor units.
  async suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion> {
    const { listing, recentViews, conversionRate, costPrice } = context;
    const currency = listing.price.currency;
    const priceMinor = listing.price.minorUnits;
    const costMinor =
      costPrice !== undefined && costPrice > 0 ? Math.round(costPrice * 100) : null;

    if (priceMinor <= 0) {
      if (costMinor === null) {
        return lowConfidence(
          1,
          `The listing has no price and the product cost is unknown, so the 1 ${currency} minimum is suggested.`
        );
      }
      return lowConfidence(
        Math.max(Math.round((costMinor * 13) / 1000), 1),
        `The listing has no price, so cost plus 30%, rounded to whole ${currency}, is suggested.`
      );
    }

    const currentPrice = listing.price.amount;
    if (recentViews > 50 && conversionRate === 0) {
      const floor = costMinor === null ? 1 : Math.ceil((costMinor * 105) / 10_000);
      const floorLabel = costMinor === null ? `the 1 ${currency} minimum` : 'cost plus 5%';
      const costNote =
        costMinor === null
          ? ` The product cost is unknown, so the floor is 1 ${currency} instead of cost plus 5%.`
          : '';
      const cut = Math.round((priceMinor * 9) / 1000);
      const target = Math.max(cut, floor);
      if (target >= currentPrice) {
        return lowConfidence(
          currentPrice,
          `${recentViews} recent views brought no sales, but no whole-${currency} cut stays above ${floorLabel}, so the current price is kept.${costNote}`
        );
      }
      return lowConfidence(
        target,
        target > cut
          ? `${recentViews} recent views brought no sales, so a cut down to ${floorLabel} is suggested.${costNote}`
          : `${recentViews} recent views brought no sales, so a 10% cut, rounded to whole ${currency}, is suggested.${costNote}`
      );
    }

    return lowConfidence(
      currentPrice,
      'There is not enough sales signal to change the price, so the current price is kept.'
    );
  }

  async generateTitle(product: Product): Promise<string> {
    return rewriteTitle(product.name, product.condition).value;
  }

  async analyzeListing(product: Product): Promise<ListingAnalysis> {
    const suggestions: string[] = [];
    if (product.imageCount === 0) {
      suggestions.push('The listing has no photos; add clear photos of the item.');
    }
    if (product.imageCount < 3) {
      suggestions.push('Add at least 3 photos that show the item from different angles.');
    }
    if (product.description.trim().length < 80) {
      suggestions.push(
        'Expand the description to at least 80 characters: size, condition, defects and what is included.'
      );
    }
    if (product.tags.length === 0) {
      suggestions.push('Add tags so buyers can find the product.');
    }
    if (product.name.trim().length < 15) {
      suggestions.push('Make the title more specific, at least 15 characters: brand, model, size.');
    }
    return { score: 100 - 20 * suggestions.length, suggestions };
  }

  async analyzeListingSeo(input: ListingSeoInput): Promise<ListingSeoOutput> {
    const { product } = listingSeoInputSchema.parse(input);
    const recommendations: ListingSeoOutput['recommendations'] = [];

    const title = rewriteTitle(product.name, product.condition);
    if (title.changes.length > 0) {
      recommendations.push({
        field: 'title',
        proposedValue: title.value,
        rationale: describeChanges(title.changes),
      });
    }
    const description = rewriteDescription(product.description);
    if (description.changes.length > 0 && description.value !== '') {
      recommendations.push({
        field: 'description',
        proposedValue: description.value,
        rationale: describeChanges(description.changes),
      });
    }

    return listingSeoOutputSchema.parse({ recommendations, disclaimer: OFFLINE_NOTICE });
  }
}

function lowConfidence(suggestedPrice: number, reasoning: string): PriceSuggestion {
  return { suggestedPrice, confidence: 'low', reasoning: `${reasoning} ${OFFLINE_NOTICE}` };
}

function describeChanges(changes: string[]): string {
  return `${capitalizeFirstLetter(changes.join(', '))}. ${OFFLINE_NOTICE}`;
}

function rewriteTitle(name: string, condition: string): Rewrite {
  const changes: string[] = [];
  const spaced = name.trim().replace(/\s+/g, ' ');
  if (spaced !== name) changes.push('removed extra spaces');
  const capitalized = capitalizeFirstLetter(spaced);
  if (capitalized !== spaced) changes.push('capitalized the first letter');

  const label = conditionLabel(condition);
  const fitted = truncateAtWord(capitalized, TITLE_MAX_LENGTH);
  if (label === null || mentions(fitted, label)) {
    if (fitted !== capitalized) changes.push(`shortened it to ${TITLE_MAX_LENGTH} characters`);
    return { value: fitted, changes };
  }

  const suffix = ` - ${label}`;
  const base = truncateAtWord(capitalized, TITLE_MAX_LENGTH - suffix.length);
  if (base !== capitalized) changes.push(`shortened it to ${TITLE_MAX_LENGTH} characters`);
  changes.push(`added the condition "${label}"`);
  return { value: `${base}${suffix}`, changes };
}

// Tidies whitespace without touching the wording: single spaces inside lines and at
// most one blank line between paragraphs. Line-ending style alone is not a change.
function rewriteDescription(description: string): Rewrite {
  const changes: string[] = [];
  const source = description.replace(/\r\n?/g, '\n');
  const tidy = source
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (tidy !== source) changes.push('removed extra spaces and blank lines');
  const capitalized = capitalizeFirstLetter(tidy);
  if (capitalized !== tidy) changes.push('capitalized the first letter');
  return { value: capitalized, changes };
}

// Leaves a first word that has capitals of its own ("iPhone", "eBay") alone, and
// skips letters whose uppercase form is longer (such as "ß") to keep length limits.
function capitalizeFirstLetter(text: string): string {
  const firstWord = text.split(/\s/, 1)[0] ?? '';
  if (/\p{Lu}/u.test(firstWord)) return text;
  const upper = text.charAt(0).toUpperCase();
  return upper.length === 1 ? `${upper}${text.slice(1)}` : text;
}

// Cuts at the last word boundary within max characters and drops a dangling separator.
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const lastSpace = text.lastIndexOf(' ', max);
  const cut = lastSpace > 0 ? text.slice(0, lastSpace) : text.slice(0, max);
  return cut.replace(/[\s,;:-]+$/u, '') || cut;
}

function mentions(text: string, phrase: string): boolean {
  return ` ${normalizeRecommendation(text)} `.includes(` ${normalizeRecommendation(phrase)} `);
}

function conditionLabel(condition: string): string | null {
  return Object.prototype.hasOwnProperty.call(CONDITION_LABELS, condition)
    ? CONDITION_LABELS[condition as ProductCondition]
    : null;
}
