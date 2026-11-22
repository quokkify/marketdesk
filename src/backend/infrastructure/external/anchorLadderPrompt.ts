// Name sanitizing, row filter and toolset guard for the price anchor ladder, which runs on the
// web-enabled research profile. Every row the agent reports is checked here before the seller sees it.

import type { AnchorTier, ClassAttribute, PriceComparable } from '../../../shared/types';
import { normalizeAnchorUrl, normalizeAnchorUrlForTier } from '../../../shared/anchorUrl';
import { MAX_ANCHORS_PER_TIER, MAX_AUTO_ROWS } from '../../domain/services/anchorLadder';

export const RESEARCH_TOOLSET = 'web';
export const SEARCH_NAME_TOO_SHORT = 'Product name is too short to search';

const MAX_NAME_LENGTH = 120;
const MAX_TITLE_LENGTH = 200;
const MAX_PRICE = 100_000;
const TIERS: readonly AnchorTier[] = ['same_model_used', 'last_new_price', 'substitute_new', 'substitute_used'];

// Top-level domains that mark a dotted word as a host. A fixed list, so names written without a
// space after a period (256GB.Czarny, stan.bdb) keep their words.
const URL_TLDS = [
  'com', 'net', 'org', 'info', 'biz', 'io', 'co', 'app', 'dev', 'xyz', 'site', 'online', 'top', 'pl', 'eu',
  'de', 'uk', 'ru', 'ua', 'by', 'cz', 'sk', 'lt', 'lv', 'ee', 'fr', 'it', 'es', 'nl', 'be', 'at', 'ch', 'se',
  'no', 'dk', 'fi', 'us', 'ca', 'me', 'tv', 'cc', 'ly', 'gl', 'to', 'sh', 'ai', 'gg', 'link', 'click', 'shop',
  'store',
];
const LABEL = String.raw`[\p{L}\p{N}-]+`;
const REST = String.raw`(?:[:/?#]\S*)?`;
// Each alternative matches only the URL itself:
// any scheme with ://; a web scheme with a bare colon (http:host); a //host; user@host;
// an IPv4 host; a www. host; a host on a listed TLD; any dotted host followed by a port, path or query.
const URL_LIKE = new RegExp(
  [
    String.raw`[a-z][a-z0-9+.-]*:\/\/\S*`,
    String.raw`(?:https?|ftps?|file|wss?|mailto):\S*`,
    String.raw`\/\/\S+`,
    String.raw`[^\s@]*@\S+`,
    String.raw`(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){3}(?![\p{N}])${REST}`,
    String.raw`www\.\S*`,
    String.raw`(?:${LABEL}\.)+(?:${URL_TLDS.join('|')})(?![\p{L}\p{N}-])${REST}`,
    String.raw`(?:${LABEL}\.)+\p{L}{2,}[:/?#]\S*`,
  ].join('|'),
  'giu',
);
const NOT_ALLOWED = /[^\p{L}\p{N} \-/.()+]/gu;

// URLs removed; only letters, digits, spaces and -/.()+ kept; spaces collapsed; at most 120 chars.
export function sanitizeSearchName(name: string): string {
  return name
    .replace(URL_LIKE, ' ')
    .replace(NOT_ALLOWED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

export function filterAnchorRows(
  items: unknown[],
  ctx: { currency: string; ownUrl: string | null; dismissed: ReadonlySet<string>; today: string },
): PriceComparable[] {
  return capAnchorRows(anchorRows(items, ctx));
}

// The agent's rows that pass the checks, deduplicated by normalized URL, without the row caps:
// a caller that drops more rows afterwards applies capAnchorRows last.
export function anchorRows(
  items: unknown[],
  ctx: { currency: string; ownUrl: string | null; dismissed: ReadonlySet<string>; today: string },
): PriceComparable[] {
  const ownUrl = ctx.ownUrl ? normalizeAnchorUrl(ctx.ownUrl) : null;
  const seen = new Set<string>();
  const rows: PriceComparable[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const { tier, price, currency, title, url, classAttributes } = item as Record<string, unknown>;
    if (typeof url !== 'string' || typeof title !== 'string') continue;
    if (!TIERS.includes(tier as AnchorTier)) continue;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE) continue;
    if (currency !== ctx.currency) continue;
    const anchorTier = tier as AnchorTier;
    const normalized = normalizeAnchorUrlForTier(url, anchorTier);
    if (!normalized || normalized === ownUrl || seen.has(normalized) || ctx.dismissed.has(normalized)) continue;
    const note = title.trim().slice(0, MAX_TITLE_LENGTH).trim();
    if (note === '') continue;
    seen.add(normalized);
    rows.push({
      price, note, url: normalized, source: 'auto', tier: anchorTier, seenAt: ctx.today,
      // Carried as given: the caller parses the attributes first; an empty list counts as none.
      ...(Array.isArray(classAttributes) && classAttributes.length > 0
        ? { classAttributes: classAttributes as ClassAttribute[] }
        : {}),
    });
  }
  return rows;
}

// The first MAX_ANCHORS_PER_TIER rows of each tier, at most MAX_AUTO_ROWS in all, in order.
export function capAnchorRows(rows: PriceComparable[]): PriceComparable[] {
  const perTier = new Map<AnchorTier | null | undefined, number>();
  const kept: PriceComparable[] = [];
  for (const row of rows) {
    if (kept.length >= MAX_AUTO_ROWS) break;
    const count = perTier.get(row.tier) ?? 0;
    if (count >= MAX_ANCHORS_PER_TIER) continue;
    perTier.set(row.tier, count + 1);
    kept.push(row);
  }
  return kept;
}

// The research profile must expose exactly the web toolset (web_search + web_extract), nothing else.
export function isResearchToolsetSafe(enabled: readonly string[]): boolean {
  return enabled.length > 0 && enabled.every((name) => name === RESEARCH_TOOLSET);
}
