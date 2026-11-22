import { normalizeOlxAdvertUrl } from './olxAdvertUrl';

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
