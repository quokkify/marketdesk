import { normalizeOlxAdvertUrl } from './olxAdvertUrl';
import type { AnchorTier } from './types';

export const ANCHOR_HOSTS: readonly string[] = [
  'olx.pl',
  'allegro.pl',
  'allegrolokalnie.pl',
  'ceneo.pl',
  'x-kom.pl',
  'komputronik.pl',
  'mediaexpert.pl',
  'euro.com.pl',
  'mediamarkt.pl',
  'morele.net',
  'amazon.pl',
];

// Hosts that show search results or foreign-currency mirrors, never a shop's own price.
export const NON_SHOP_HOSTS: readonly string[] = ['e-katalog.pl', 'keenable.ai', 'google.com', 'bing.com', 'duckduckgo.com'];

const USED_TIERS: ReadonlySet<AnchorTier> = new Set(['same_model_used', 'substitute_used']);
const LOKALNIE_HOST = 'allegrolokalnie.pl';
const LOKALNIE_OFFER_PATH = /^\/oferta\/[^/]+/;
const OLX_HOST = 'olx.pl';
const OLX_ADVERT_HOST = 'www.olx.pl';
// Spellings of one host that lead to the same page.
const HOST_ALIAS_PREFIX = /^(?:www|m)\./;

function isAnchorHost(host: string): boolean {
  return ANCHOR_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// The canonical form of an anchor link, or null when the link is not https on an allowed shop or marketplace.
// One page keys the same however it is spelled: the host lowercased and without `www.`/`m.`, no userinfo,
// port, query, hash or trailing slash. OLX adverts take the key normalizeOlxAdvertUrl gives the www link.
export function normalizeAnchorUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !isAnchorHost(parsed.hostname)) return null;
  const host = parsed.hostname.replace(HOST_ALIAS_PREFIX, '');
  if (host === OLX_HOST || host.endsWith(`.${OLX_HOST}`)) {
    return host === OLX_HOST ? normalizeOlxAdvertUrl(`https://${OLX_ADVERT_HOST}${parsed.pathname}`) : null;
  }
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
  return `https://${host}${path || '/'}`;
}

function matchesHost(host: string, listed: readonly string[]): boolean {
  return listed.some((name) => host === name || host.endsWith(`.${name}`));
}

// The canonical form of an anchor link for one tier, or null. New tiers accept the allowlist or any `.pl` host
// that is not a non-shop; used tiers accept only an OLX advert or an Allegro Lokalnie offer. Keys match normalizeAnchorUrl.
export function normalizeAnchorUrlForTier(url: string, tier: AnchorTier): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.replace(HOST_ALIAS_PREFIX, '');
  if (matchesHost(host, NON_SHOP_HOSTS)) return null;
  if (USED_TIERS.has(tier)) {
    if (host === OLX_HOST) return normalizeAnchorUrl(url);
    if (host === LOKALNIE_HOST && LOKALNIE_OFFER_PATH.test(parsed.pathname)) return normalizeAnchorUrl(url);
    return null;
  }
  if (isAnchorHost(parsed.hostname)) return normalizeAnchorUrl(url);
  if (!host.endsWith('.pl')) return null;
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
  return `https://${host}${path || '/'}`;
}
