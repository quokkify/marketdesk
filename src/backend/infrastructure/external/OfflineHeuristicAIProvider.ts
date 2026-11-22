// Built-in heuristic implementation of the IAIProvider port. AIProviderSelector uses
// it when Hermes is not configured or not reachable, or when HERMES_PROVIDER_MODE is
// offline. It never calls the network, reports low confidence, and every price
// reasoning and SEO rationale ends by saying that Hermes was not consulted.

import {
  OFFLINE_AI_NOTICE,
  type AIProviderSourceAware,
  type IAIProvider,
  type ListingAnalysis,
  type PriceEstimateContext,
} from '../../domain/ports/IAIProvider';
import type { Product } from '../../domain/entities/Product';
import type { PriceEstimate, ProductCondition } from '../../../shared/types';
import {
  listingSeoInputSchema,
  listingSeoOutputSchema,
  normalizeRecommendation,
  type ListingSeoInput,
  type ListingSeoOutput,
} from '../../domain/agents/MarketDeskAgentCatalog';

const TITLE_MAX_LENGTH = 70;

// Appended to titles that name no condition yet; "unknown" adds nothing.
const CONDITION_LABELS: Record<ProductCondition, string | null> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good condition',
  fair: 'Fair condition',
  poor: 'Poor condition',
  refurbished: 'Refurbished',
  unknown: null,
};
const KNOWN_CONDITION_LABELS = Object.values(CONDITION_LABELS).filter(
  (label): label is string => label !== null
);
// Phrases that show a title already names a condition. The bare word "New" is left out:
// it starts brand names such as "New Balance" and "New Era".
const CONDITION_PHRASES = KNOWN_CONDITION_LABELS.filter((label) => label !== CONDITION_LABELS.new);
// One or more trailing " - <condition label>" suffixes, the form appended below.
const CONDITION_SUFFIXES = new RegExp(
  `(?:\\s+-\\s+(?:${KNOWN_CONDITION_LABELS.join('|')}))+$`,
  'i'
);

interface Rewrite {
  value: string;
  changes: string[];
}

export class OfflineHeuristicAIProvider implements IAIProvider, AIProviderSourceAware {
  // Reports itself, so callers label its results offline however it is wired.
  async activeProvider(): Promise<'offline'> {
    return 'offline';
  }

  // Never surfaced: low confidence by design, so it only restates the stored figures.
  async estimatePrice(context: PriceEstimateContext): Promise<PriceEstimate> {
    const { listing, research } = context;
    const price = listing.price.amount;
    const prices = (research?.comparables ?? []).map((c) => c.price);
    return {
      startPrice: price,
      floorPrice: price,
      retailAnchor:
        research?.retailPrice != null ? { amount: research.retailPrice, basis: 'observed' } : null,
      usedRange:
        prices.length > 0
          ? { low: Math.min(...prices), high: Math.max(...prices), basis: 'observed' }
          : null,
      confidence: 'low',
      reasoning: `${OFFLINE_AI_NOTICE} The current price is kept as both the start and the floor.`,
    };
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

    return listingSeoOutputSchema.parse({ recommendations, disclaimer: OFFLINE_AI_NOTICE });
  }
}

function describeChanges(changes: string[]): string {
  return `${capitalizeFirstLetter(changes.join(', '))}. ${OFFLINE_AI_NOTICE}`;
}

function rewriteTitle(name: string, condition: string): Rewrite {
  const changes: string[] = [];
  const spaced = name.trim().replace(/\s+/g, ' ');
  if (spaced !== name) changes.push('removed extra spaces');
  const capitalized = capitalizeFirstLetter(spaced);
  if (capitalized !== spaced) changes.push('capitalized the first letter');

  // Condition suffixes appended earlier are dropped first, so a changed condition
  // replaces the old one instead of stacking ("Camera - Good condition - Fair condition").
  const label = conditionLabel(condition);
  const base = capitalized.replace(CONDITION_SUFFIXES, '');
  if (label === null || mentionsAnyCondition(truncateAtWord(base, TITLE_MAX_LENGTH))) {
    const fitted = truncateAtWord(capitalized, TITLE_MAX_LENGTH);
    if (fitted !== capitalized) changes.push(`shortened it to ${TITLE_MAX_LENGTH} characters`);
    return { value: fitted, changes };
  }

  const suffix = ` - ${label}`;
  const fittedBase = truncateAtWord(base, TITLE_MAX_LENGTH - suffix.length);
  const value = `${fittedBase}${suffix}`;
  if (value !== capitalized) {
    if (fittedBase !== base) changes.push(`shortened it to ${TITLE_MAX_LENGTH} characters`);
    changes.push(
      base === capitalized ? `added the condition "${label}"` : `set the condition to "${label}"`
    );
  }
  return { value, changes };
}

function mentionsAnyCondition(text: string): boolean {
  return CONDITION_PHRASES.some((phrase) => mentions(text, phrase));
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
