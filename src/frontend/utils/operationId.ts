// Ids for remote operations the API runs at most once per id, such as delisting an advert.
// crypto.randomUUID exists only in secure contexts (HTTPS or localhost). A tester stand reached
// over plain HTTP gets the same RFC 4122 version 4 shape from crypto.getRandomValues, which every
// context has.
export function newOperationId(
  source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto
): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
