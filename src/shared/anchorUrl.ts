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

function isAnchorHost(host: string): boolean {
  return ANCHOR_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// The canonical form of an anchor link, or null when the link is not https on an allowed shop or marketplace.
export function normalizeAnchorUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !isAnchorHost(parsed.hostname)) return null;
  if (parsed.hostname === OLX_HOST || parsed.hostname.endsWith(`.${OLX_HOST}`)) return normalizeOlxAdvertUrl(url);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
