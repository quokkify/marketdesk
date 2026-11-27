// Prompts and strict answer parsers that let Hermes fill OLX advert fields from lists OLX allows.
// Hermes only picks: an attribute value must be one of the offered value codes, a parcel size one of S/M/L/XL.
// Only the sanitized ResearchItem fields reach the prompts: the description and notes never do.

import { z } from 'zod';
import type {
  AdvertAttribute,
  OlxCategoryAttribute,
  ParcelSize,
} from '../../domain/services/advertCompletenessRules';
import { ValidationError } from '../../domain/shared/DomainError';
import { SEARCH_NAME_TOO_SHORT, sanitizeSearchName } from './anchorLadderPrompt';
import { parseJsonObject } from './jsonText';
import type { ResearchItem } from './priceResearchPrompts';
import { SELLER_DATA_RULE, sellerDataBlock } from './sellerData';

const PARCEL_SIZES: readonly ParcelSize[] = ['S', 'M', 'L', 'XL'];

const SYSTEM = [
  'You help a seller on a Polish marketplace fill in the fields of an advert.',
  SELLER_DATA_RULE,
].join(' ');

const FENCED_ONLY = /^```(?:json)?\s*[\s\S]*?\s*```$/i;

// One fenced block is accepted; any other text around the JSON makes the answer unusable.
function parseStrictJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (text.startsWith('```') && !FENCED_ONLY.test(text)) return null;
  if (text.includes('```') && !text.startsWith('```')) return null;
  return parseJsonObject(text);
}

function itemBlock(item: ResearchItem): string {
  const name = sanitizeSearchName(item.name);
  if (name === '') throw new ValidationError(SEARCH_NAME_TOO_SHORT);
  return sellerDataBlock({
    name,
    condition: item.condition.replace(/_/g, ' '),
    category: sanitizeSearchName(item.category),
  });
}

export function buildAttributeChoicePrompt(
  item: ResearchItem,
  attributes: OlxCategoryAttribute[]
): { system: string; prompt: string } {
  const block = itemBlock(item);
  const lines = attributes.map((attribute) => {
    const values = attribute.values.map((value) => `${value.code} (${value.label})`).join(', ');
    return `- ${attribute.code} (${attribute.label}): ${values}`;
  });
  const prompt = [
    'For each attribute below, pick the one allowed value code that fits this item, or null when you cannot tell from the item data.',
    block,
    'Attributes and their allowed value codes:',
    ...lines,
    'Use only the value codes listed. Never invent a value. Use no tools. Answer with JSON only, in this shape: {"values": {"<attribute code>": "<value code>" or null}}',
  ].join('\n');
  return { system: SYSTEM, prompt };
}

const valuesSchema = z.object({ values: z.record(z.string(), z.unknown()) });

export function parseAttributeChoices(
  raw: string,
  attributes: OlxCategoryAttribute[]
): AdvertAttribute[] {
  const parsed = valuesSchema.safeParse(parseStrictJsonObject(raw));
  if (!parsed.success) return [];
  const choices: AdvertAttribute[] = [];
  for (const attribute of attributes) {
    if (choices.some((choice) => choice.code === attribute.code)) continue;
    if (!Object.prototype.hasOwnProperty.call(parsed.data.values, attribute.code)) continue;
    const value = parsed.data.values[attribute.code];
    if (typeof value !== 'string') continue;
    if (attribute.values.some((allowed) => allowed.code === value)) {
      choices.push({ code: attribute.code, value });
    }
  }
  return choices;
}

export function buildParcelSizePrompt(item: ResearchItem): { system: string; prompt: string } {
  const block = itemBlock(item);
  const prompt = [
    'Pick the OLX parcel size this item fits in when shipped.',
    block,
    'Sizes: "S" a small parcel, like a phone or headphones; "M" shoebox size, like a projector; "L" a larger parcel; "XL" the largest parcel.',
    'Use no tools. Answer with JSON only, in this shape: {"size": "S"}',
  ].join('\n');
  return { system: SYSTEM, prompt };
}

export function parseParcelSize(raw: string): ParcelSize | null {
  const parsed = z.object({ size: z.string() }).safeParse(parseStrictJsonObject(raw));
  if (!parsed.success) return null;
  const size = parsed.data.size.trim().toUpperCase();
  return PARCEL_SIZES.find((candidate) => candidate === size) ?? null;
}
