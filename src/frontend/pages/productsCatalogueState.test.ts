import type { Product } from '@shared/types';
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
  it('still parses old attention links', () => {
    expect(parseProductsCatalogueState('?tab=attention').tab).toBe('attention');
  });
  it('hides the attention tab while it is empty or unknown', () => {
    expect(visibleProductTabs(0)).toEqual(['all', 'active', 'draft', 'sold']);
    expect(visibleProductTabs(undefined)).toEqual(['all', 'active', 'draft', 'sold']);
    expect(visibleProductTabs(2)).toEqual(['all', 'active', 'attention', 'draft', 'sold']);
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
