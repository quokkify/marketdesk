export const OLX_ADVERT_URL_PATTERN = /^https:\/\/www\.olx\.pl\/d\/oferta\/[a-z0-9-]+-CID\d+-ID[0-9A-Za-z]+\.html$/;

export function normalizeOlxAdvertUrl(raw: string): string | null {
  const bare = raw.split('#')[0].split('?')[0];
  return OLX_ADVERT_URL_PATTERN.test(bare) ? bare : null;
}
