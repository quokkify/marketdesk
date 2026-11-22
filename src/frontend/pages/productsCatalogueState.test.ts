import type { Product, ProductStats } from '@shared/types';
import {
  catalogueFooterLabel,
  catalogueShowsSkeleton,
  hasCatalogueFilters,
  parseProductsCatalogueState,
  PRODUCT_SORT_OPTIONS,
  productInitials,
  productsToCsv,
  productTileTone,
  shortListingSku,
  tabStatus,
  updateProductsCatalogueSearch,
  needsActionLabel,
  sparklinePoints,
  tabNeedsAction,
  viewsSummary,
  visibleProductTabs,
} from './productsCatalogueState';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    workspaceId: 'w-1',
    sku: 'SKU,1',
    name: 'Quoted "name"',
    description: 'Description',
    costPrice: 10,
    sellingPrice: 20,
    condition: 'new',
    category: 'Audio',
    status: 'active',
    tags: ['featured', 'audio'],
    images: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('products catalogue URL state', () => {
  it('parses validated state and serializes every catalogue control while preserving wizard state', () => {
    const parsed = parseProductsCatalogueState(
      '?tab=active&search=phone&tags=audio,featured&priceMin=10&priceMax=99&sort=name&page=3&view=card'
    );
    expect(parsed).toEqual({
      tab: 'active',
      search: 'phone',
      tags: ['audio', 'featured'],
      priceMin: '10',
      priceMax: '99',
      sort: 'name',
      page: 2,
      view: 'card',
    });
    expect(updateProductsCatalogueSearch('?newProduct=1', parsed)).toBe(
      '?newProduct=1&tab=active&search=phone&tag=audio&tag=featured&priceMin=10&priceMax=99&sort=name&page=3&view=card'
    );
  });

  it('falls back from invalid URL values and maps tabs to real API statuses', () => {
    expect(
      parseProductsCatalogueState('?tab=deleted&page=-2&sort=profit&view=tiles')
    ).toMatchObject({ tab: 'all', page: 0, sort: '-updatedAt', view: 'list' });
    expect(tabStatus('all')).toBeUndefined();
    expect(tabStatus('attention')).toEqual(['attention']);
  });

  it('detects filters independently from sort/view/page', () => {
    expect(hasCatalogueFilters(parseProductsCatalogueState('?sort=name&view=card&page=2'))).toBe(
      false
    );
    expect(hasCatalogueFilters(parseProductsCatalogueState('?search=chair'))).toBe(true);
  });
});

describe('products catalogue export and identity helpers', () => {
  it('exports selected real fields as escaped CSV', () => {
    const csv = productsToCsv([product()], 'PLN');
    expect(csv).toContain(
      'id,sku,name,status,category,costPrice,sellingPrice,currency,tags,updatedAt'
    );
    expect(csv).toContain('p-1,"SKU,1","Quoted ""name""",active,Audio,10,20,PLN,featured|audio');
  });

  it.each(['=HYPERLINK("https://example.test")', '+cmd', '-1+1', '@SUM(1,1)', '\t=1+1'])(
    'neutralizes spreadsheet formula input %s',
    (name) => {
      const csv = productsToCsv([product({ name })], 'PLN');
      expect(csv).toContain(`'${name.replace(/"/g, '""')}`);
    }
  );

  it('round-trips tags containing commas without changing their identity', () => {
    const search = updateProductsCatalogueSearch('', {
      ...parseProductsCatalogueState(''),
      tags: ['home, office', 'featured'],
    });
    expect(parseProductsCatalogueState(search).tags).toEqual(['home, office', 'featured']);
  });

  it('creates a stable two-word fallback initial', () => {
    expect(productInitials(' wireless headphones pro ')).toBe('WH');
    expect(productInitials('')).toBe('?');
  });
});

describe('products catalogue presentation helpers', () => {
  it('derives a stable initials tile tone from the SKU character codes', () => {
    // 'A' = 65 -> 65 % 6 = 5; 'B' = 66 -> 0; 'CAM-001' sums to 399 -> 3.
    expect(productTileTone('A')).toBe('info');
    expect(productTileTone('B')).toBe('primary');
    expect(productTileTone('CAM-001')).toBe('warning');
    expect(productTileTone('CAM-001')).toBe(productTileTone('CAM-001'));
    expect(productTileTone('')).toBe('primary');
  });

  it('summarises the visible rows in the footer', () => {
    expect(catalogueFooterLabel(10, 0, 25)).toBe('Showing 10 products');
    expect(catalogueFooterLabel(1, 0, 25)).toBe('Showing 1 product');
    expect(catalogueFooterLabel(60, 1, 25)).toBe('Showing 26–50 of 60 products');
    expect(catalogueFooterLabel(60, 2, 25)).toBe('Showing 51–60 of 60 products');
  });

  it('offers only sort orders that the catalogue URL parser accepts', () => {
    expect(PRODUCT_SORT_OPTIONS.length).toBeGreaterThan(0);
    for (const option of PRODUCT_SORT_OPTIONS) {
      expect(parseProductsCatalogueState(`?sort=${option.value}`).sort).toBe(option.value);
    }
  });
});

describe('stage 1 catalogue helpers', () => {
  it('shortens an imported marketplace SKU to the marketplace and advert id', () => {
    expect(shortListingSku('OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-1085784120')).toBe(
      'OLX · 1085784120'
    );
  });
  it.each(['SKU-100', 'OLX-1085784120', 'olx-5e881fca-2811-4a73-aaaf-da9b23f485a1-1', ''])(
    'leaves a SKU that is not an imported marketplace SKU unchanged: %s',
    (sku) => expect(shortListingSku(sku)).toBe(sku)
  );
  it('keeps dashes inside the advert id', () => {
    expect(shortListingSku('OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-ab-12')).toBe('OLX · ab-12');
  });
  it('parses the sold tab and maps it to the sold status', () => {
    expect(parseProductsCatalogueState('?tab=sold').tab).toBe('sold');
    expect(tabStatus('sold')).toEqual(['sold']);
  });
  it('maps old attention links to the needs-action tab', () => {
    expect(parseProductsCatalogueState('?tab=attention').tab).toBe('needs-action');
    expect(parseProductsCatalogueState('?tab=needs-action').tab).toBe('needs-action');
  });
  it('always shows the needs-action tab', () => {
    expect(visibleProductTabs()).toEqual(['all', 'active', 'needs-action', 'draft', 'sold']);
  });
  it('filters the needs-action tab by reason, not by a stored status', () => {
    expect(tabStatus('needs-action')).toBeUndefined();
    expect(tabNeedsAction('needs-action')).toBe(true);
    expect(tabNeedsAction('active')).toBe(false);
  });
  it('offers sorting by views and growth', () => {
    const values = PRODUCT_SORT_OPTIONS.map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['-viewsDelta7d', 'viewsDelta7d', '-views']));
    expect(parseProductsCatalogueState('?sort=-viewsDelta7d').sort).toBe('-viewsDelta7d');
  });
  it('no longer offers cost sorting in the menu but accepts it from old URLs', () => {
    expect(PRODUCT_SORT_OPTIONS.map((o) => o.value)).not.toContain('costPrice');
    expect(PRODUCT_SORT_OPTIONS.map((o) => o.value)).not.toContain('-costPrice');
    expect(parseProductsCatalogueState('?sort=-costPrice').sort).toBe('-costPrice');
  });
});

describe('catalogue loading state', () => {
  // Regression guard: approving a suggestion refetches the list; the visible rows must stay.
  it('keeps showing rows while a refetch runs', () => {
    expect(catalogueShowsSkeleton({ hasData: true, isFetching: true, pageOutOfRange: false })).toBe(
      false
    );
  });
  it('shows skeletons before the first data and while correcting an out-of-range page', () => {
    expect(
      catalogueShowsSkeleton({ hasData: false, isFetching: true, pageOutOfRange: false })
    ).toBe(true);
    expect(catalogueShowsSkeleton({ hasData: true, isFetching: false, pageOutOfRange: true })).toBe(
      true
    );
    expect(
      catalogueShowsSkeleton({ hasData: true, isFetching: false, pageOutOfRange: false })
    ).toBe(false);
  });
});

describe('views presentation', () => {
  const base: ProductStats = {
    views: 10,
    watchers: 3,
    messages: 1,
    viewsDelta7d: 2,
    viewsByDay: [],
    lastSyncAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    stale: false,
    externalUrl: null,
    listingStatus: 'live',
    needsAction: [],
  };
  it('shows growth, no growth and stale data differently', () => {
    expect(viewsSummary({ ...base, views: 128, viewsDelta7d: 14 }).delta).toEqual({
      kind: 'up',
      text: '▲ +14',
    });
    expect(viewsSummary({ ...base, views: 41, viewsDelta7d: 0 }).delta).toEqual({
      kind: 'flat',
      text: 'no growth',
    });
    expect(viewsSummary({ ...base, views: 203, viewsDelta7d: null, stale: true }).delta).toEqual({
      kind: 'stale',
      text: 'stale',
    });
    expect(viewsSummary({ ...base, views: 128 }).primary).toBe('128');
  });
  it('describes watchers, messages and freshness', () => {
    expect(viewsSummary(base).secondary).toBe('3 watching · 1 msgs · synced 2h ago');
  });
  it('shows a dash without stats or views', () => {
    expect(viewsSummary(undefined)).toEqual({ primary: '—', delta: null, secondary: null });
    expect(viewsSummary({ ...base, views: null })).toEqual({
      primary: '—',
      delta: null,
      secondary: null,
    });
  });
  it('draws a flat line for equal values and nothing for no values', () => {
    expect(sparklinePoints([3, 3, 3], 70, 18)).toBe('0,9 35,9 70,9');
    expect(sparklinePoints([], 70, 18)).toBe('');
  });
  it('scales a rising series from bottom to top', () => {
    expect(sparklinePoints([0, 5], 10, 10)).toBe('0,10 10,0');
  });
  it('names every needs-action reason', () => {
    expect(needsActionLabel('buyer_waiting')).toBe('Buyer waiting');
    expect(needsActionLabel('listing_problem')).toBe('Listing expired or failing on OLX');
    expect(needsActionLabel('no_view_growth')).toBe('No view growth for 7 days');
  });
});
