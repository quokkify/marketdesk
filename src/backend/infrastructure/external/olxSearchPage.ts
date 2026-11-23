// Pure reader of a public OLX search page. The page embeds its data as a JSON string literal in
// window.__PRERENDERED_STATE__. Only ids, prices, promotion flags and totals leave this module:
// titles, descriptions and seller data on the page are never read.

import { z } from 'zod';
import type { ProbeCard } from '../../../shared/types';
import type { OlxSearchPage } from '../../application/ports/IOlxSearch';
import { isSafeQuery } from './listingResponsePrompts';

const STATE_LITERAL = /__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\[\s\S])*")/;
const PRICE_CURRENCY = 'PLN';

const adSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  isPromoted: z.boolean().optional(),
  searchReason: z.string().optional(),
  price: z
    .object({
      regularPrice: z.object({ value: z.number().optional(), currencyCode: z.string().optional() }).optional(),
      free: z.boolean().optional(),
      exchange: z.boolean().optional(),
    })
    .optional(),
});

const stateSchema = z.object({
  listing: z.object({
    listing: z.object({
      totalElements: z.number().optional(),
      totalPages: z.number().optional(),
      ads: z.array(z.unknown()),
    }),
  }),
});

export function olxSearchUrl(baseUrl: string, query: string, page: number): string {
  if (!isSafeQuery(query)) throw new Error('Unsafe search query');
  if (!Number.isInteger(page) || page < 1) throw new Error(`Invalid search page ${page}`);
  const slug = query.split(' ').map(encodeURIComponent).join('-');
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/oferty/q-${slug}/${page > 1 ? `?page=${page}` : ''}`;
}

function toCard(value: unknown): ProbeCard | null {
  const parsed = adSchema.safeParse(value);
  if (!parsed.success || parsed.data.id === undefined) return null;
  const { id, isPromoted, searchReason, price } = parsed.data;
  const regular = price?.regularPrice;
  const plain =
    regular?.currencyCode === PRICE_CURRENCY && !price?.free && !price?.exchange && typeof regular.value === 'number';
  return {
    id: String(id),
    price: plain ? (regular.value as number) : null,
    promoted: isPromoted === true || searchReason === 'promoted',
  };
}

export function parseOlxSearchPage(html: string): OlxSearchPage | null {
  const literal = STATE_LITERAL.exec(html)?.[1];
  if (literal === undefined) return null;
  let state: unknown;
  try {
    state = JSON.parse(JSON.parse(literal) as string);
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(state);
  if (!parsed.success) return null;
  const { totalElements, totalPages, ads } = parsed.data.listing.listing;
  const cards: ProbeCard[] = [];
  for (const ad of ads) {
    const card = toCard(ad);
    if (card) cards.push(card);
  }
  return { total: totalElements ?? null, totalPages: totalPages ?? null, cards };
}
