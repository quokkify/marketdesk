import type { PriceComparable } from '../../../shared/types';
import { normalizeAnchorUrl } from '../../../shared/anchorUrl';

function autoUrls(rows: PriceComparable[]): Set<string> {
  const urls = new Set<string>();
  for (const row of rows) {
    if (row.source !== 'auto' || !row.url) continue;
    const normalized = normalizeAnchorUrl(row.url);
    if (normalized !== null) urls.add(normalized);
  }
  return urls;
}

// Auto rows are stored with the normalized link, as the ladder stores them; manual and web rows stay as typed.
export function withNormalizedAutoUrls(rows: PriceComparable[]): PriceComparable[] {
  return rows.map((row) => {
    if (row.source !== 'auto' || !row.url) return row;
    const url = normalizeAnchorUrl(row.url);
    return url === null ? row : { ...row, url };
  });
}

// An auto row the seller removed must not come back on the next search: its URL joins the dismissed list.
// Only auto rows count; manual and web rows are the seller's own and never dismiss anything.
export function dismissedAfterEdit(
  before: PriceComparable[],
  after: PriceComparable[],
  dismissed: string[],
): string[] {
  const kept = autoUrls(after);
  const result = [...dismissed];
  for (const url of autoUrls(before)) {
    if (!kept.has(url) && !result.includes(url)) result.push(url);
  }
  return result;
}

// Whether the stored research moved on since the client built its form from `baseUpdatedAt`.
// undefined skips the check (API clients that do not send it); null means the form saw no research.
export function researchChangedSince(storedUpdatedAt: string | null, baseUpdatedAt: string | null | undefined): boolean {
  if (baseUpdatedAt === undefined) return false;
  if (storedUpdatedAt === null || baseUpdatedAt === null) return storedUpdatedAt !== baseUpdatedAt;
  return new Date(storedUpdatedAt).getTime() !== new Date(baseUpdatedAt).getTime();
}
