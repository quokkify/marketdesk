// Prompt and strict answer parser for the buyer-queries node of the listing response graph.
// Only the sanitized ResearchItem fields reach the prompt: the description and notes never do.
// Every parsed query is later put into a search URL, so it must pass isSafeQuery.

import { z } from 'zod';
import { ValidationError } from '../../domain/shared/DomainError';
import { SEARCH_NAME_TOO_SHORT, sanitizeSearchName } from './anchorLadderPrompt';
import { parseJsonObject } from './jsonText';
import type { ResearchItem } from './priceResearchPrompts';
import { SELLER_DATA_RULE, sellerDataBlock } from './sellerData';

export const MAX_QUERIES = 3;

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 40;
const SAFE_QUERY = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+){0,3}$/u;

export function isSafeQuery(value: string): boolean {
  const length = value.trim().length;
  return length >= MIN_QUERY_LENGTH && length <= MAX_QUERY_LENGTH && SAFE_QUERY.test(value);
}

const SYSTEM = [
  'You help a seller on a Polish marketplace understand how buyers find an advert.',
  SELLER_DATA_RULE,
].join(' ');

export function buildQueriesPrompt(item: ResearchItem): { system: string; prompt: string } {
  const name = sanitizeSearchName(item.name);
  if (name === '') throw new ValidationError(SEARCH_NAME_TOO_SHORT);
  const block = sellerDataBlock({
    name,
    condition: item.condition.replace(/_/g, ' '),
    category: sanitizeSearchName(item.category),
  });
  const prompt = [
    `Give ${MAX_QUERIES - 1}-${MAX_QUERIES} short phrases a buyer in Poland would type into the marketplace search box to find this item.`,
    block,
    `Each phrase: two to four words, ${MIN_QUERY_LENGTH}-${MAX_QUERY_LENGTH} characters, only letters, digits and single spaces, never a brand alone or generic words that match unrelated items.`,
    'Use no tools. Answer with JSON only, in this shape: {"queries": ["phrase one", "phrase two"]}',
  ].join('\n');
  return { system: SYSTEM, prompt };
}

const answerSchema = z.object({ queries: z.array(z.unknown()) });

export function parseQueries(raw: string): string[] | null {
  const object = parseJsonObject(raw);
  const parsed = answerSchema.safeParse(object);
  if (!parsed.success) return null;
  const queries: string[] = [];
  for (const entry of parsed.data.queries) {
    if (typeof entry !== 'string') continue;
    const query = entry.normalize('NFC').trim().toLowerCase();
    if (isSafeQuery(query) && !queries.includes(query)) queries.push(query);
  }
  return queries.length > 0 ? queries.slice(0, MAX_QUERIES) : null;
}
