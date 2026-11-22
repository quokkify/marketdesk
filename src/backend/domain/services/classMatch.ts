import type { ClassAttribute, PriceComparable } from '../../../shared/types';

const RATIO_MIN = 0.5;
const RATIO_MAX = 2;
const SUBSTITUTE_TIERS: ReadonlySet<PriceComparable['tier']> = new Set(['substitute_new', 'substitute_used']);

const nameKey = (name: string): string => name.trim().toLowerCase();

function equalKey(value: string | number): string {
  return String(value).toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');
}

function attributeMatches(wanted: ClassAttribute, found: ClassAttribute | undefined): boolean {
  if (!found) return false;
  if (wanted.match === 'equal') return equalKey(wanted.value) === equalKey(found.value);
  if (typeof wanted.value !== 'number' || typeof found.value !== 'number' || !Number.isFinite(found.value)) return false;
  if (wanted.value === 0) return found.value === 0;
  const ratio = found.value / wanted.value;
  return ratio >= RATIO_MIN && ratio <= RATIO_MAX;
}

export function matchesClass(
  item: readonly ClassAttribute[],
  candidate: readonly ClassAttribute[] | null | undefined,
): boolean {
  if (!candidate) return false;
  const byName = new Map(candidate.map((attribute) => [nameKey(attribute.name), attribute]));
  return item.every((wanted) => attributeMatches(wanted, byName.get(nameKey(wanted.name))));
}

// Substitutes must share the item's class; same-model and last-new-price rows are about the item itself.
export function applyClassFilter(rows: PriceComparable[], item: readonly ClassAttribute[]): PriceComparable[] {
  const kept: PriceComparable[] = [];
  for (const row of rows) {
    if (!SUBSTITUTE_TIERS.has(row.tier)) {
      kept.push(row);
    } else if (item.length === 0) {
      kept.push({ ...row, classChecked: false });
    } else if (matchesClass(item, row.classAttributes)) {
      kept.push({ ...row, classChecked: true });
    }
  }
  return kept;
}
