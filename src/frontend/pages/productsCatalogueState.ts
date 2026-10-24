import type { Product, ProductStatus } from '@shared/types';

export const PRODUCTS_PAGE_SIZE = 25;
export const PRODUCT_SEARCH_DEBOUNCE_MS = 200;
export type ProductsView = 'list' | 'card';
export type ProductsTab = 'all' | 'active' | 'attention' | 'draft';

export interface ProductsCatalogueState {
  tab: ProductsTab;
  search: string;
  tags: string[];
  priceMin: string;
  priceMax: string;
  sort: string;
  page: number;
  view: ProductsView;
}

const SORTS = new Set([
  'name',
  '-name',
  'sellingPrice',
  '-sellingPrice',
  'costPrice',
  '-costPrice',
  'status',
  '-status',
  'updatedAt',
  '-updatedAt',
]);
const TABS = new Set<ProductsTab>(['all', 'active', 'attention', 'draft']);

// Sort orders offered by the toolbar menu; each one is accepted by the API.
export const PRODUCT_SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '-updatedAt', label: 'Recently updated' },
  { value: 'updatedAt', label: 'Least recently updated' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: 'sellingPrice', label: 'Price: low to high' },
  { value: '-sellingPrice', label: 'Price: high to low' },
  { value: 'costPrice', label: 'Cost: low to high' },
  { value: '-costPrice', label: 'Cost: high to low' },
];

export function parseProductsCatalogueState(search: string): ProductsCatalogueState {
  const query = new URLSearchParams(search);
  const tabValue = query.get('tab') as ProductsTab | null;
  const pageValue = Number.parseInt(query.get('page') ?? '1', 10);
  const sortValue = query.get('sort') ?? '-updatedAt';
  return {
    tab: tabValue && TABS.has(tabValue) ? tabValue : 'all',
    search: query.get('search') ?? '',
    tags: query.getAll('tag').length
      ? query
          .getAll('tag')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : (query.get('tags') ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
    priceMin: query.get('priceMin') ?? '',
    priceMax: query.get('priceMax') ?? '',
    sort: SORTS.has(sortValue) ? sortValue : '-updatedAt',
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue - 1 : 0,
    view: query.get('view') === 'card' ? 'card' : 'list',
  };
}

export function updateProductsCatalogueSearch(
  currentSearch: string,
  patch: Partial<ProductsCatalogueState>
): string {
  const current = parseProductsCatalogueState(currentSearch);
  const next = { ...current, ...patch };
  const query = new URLSearchParams(currentSearch);
  for (const key of [
    'tab',
    'search',
    'tag',
    'tags',
    'priceMin',
    'priceMax',
    'sort',
    'page',
    'view',
  ]) {
    query.delete(key);
  }
  if (next.tab !== 'all') query.set('tab', next.tab);
  if (next.search.trim()) query.set('search', next.search.trim());
  next.tags.forEach((tag) => query.append('tag', tag));
  if (next.priceMin.trim()) query.set('priceMin', next.priceMin.trim());
  if (next.priceMax.trim()) query.set('priceMax', next.priceMax.trim());
  if (next.sort !== '-updatedAt') query.set('sort', next.sort);
  if (next.page > 0) query.set('page', String(next.page + 1));
  if (next.view === 'card') query.set('view', 'card');
  const result = query.toString();
  return result ? `?${result}` : '';
}

export function tabStatus(tab: ProductsTab): ProductStatus[] | undefined {
  return tab === 'all' ? undefined : [tab];
}

export function hasCatalogueFilters(state: ProductsCatalogueState): boolean {
  return Boolean(
    state.tab !== 'all' ||
    state.search.trim() ||
    state.tags.length ||
    state.priceMin.trim() ||
    state.priceMax.trim()
  );
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const text = /^[\t\r\n]|^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function productsToCsv(products: Product[], currency: string): string {
  const rows = products.map((product) => [
    product.id,
    product.sku,
    product.name,
    product.status,
    product.category,
    product.costPrice ?? '',
    product.sellingPrice,
    currency,
    product.tags.join('|'),
    product.updatedAt,
  ]);
  return [
    [
      'id',
      'sku',
      'name',
      'status',
      'category',
      'costPrice',
      'sellingPrice',
      'currency',
      'tags',
      'updatedAt',
    ],
    ...rows,
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

export function productInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return initials || '?';
}

export type ProductTileTone = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';

const TILE_TONES: readonly ProductTileTone[] = [
  'primary',
  'secondary',
  'success',
  'warning',
  'error',
  'info',
];

// Stable hue for the initials tile: the same SKU always gets the same tone.
export function productTileTone(sku: string): ProductTileTone {
  let sum = 0;
  for (const char of sku) sum += char.charCodeAt(0);
  return TILE_TONES[sum % TILE_TONES.length]!;
}

export function catalogueFooterLabel(total: number, page: number, pageSize: number): string {
  if (total <= pageSize) return `Showing ${total} ${total === 1 ? 'product' : 'products'}`;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return `Showing ${from}–${to} of ${total} products`;
}
