import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Listing, ListingStatus } from '@shared/types';
import type { ListingsTableProps } from '../components/tables/index.js';
import ListingsPage, { parseListingStatusParam, withListingStatusParam } from './ListingsPage';

const mockCapture: { table?: ListingsTableProps } = {};
const mockUseListings = jest.fn();

jest.mock('../services/hooks/index.js', () => ({
  useListings: (params: unknown) => mockUseListings(params),
  useDelistListingToDraft: () => [jest.fn(), { isLoading: false }],
}));

jest.mock('../hooks/useMarketplaceLookup.js', () => ({
  useMarketplaceLookup: () => ({
    resolveMarketplaceName: (id: string) => id,
    resolveMarketplaceKey: () => 'olx',
  }),
}));

jest.mock('../state/hooks.js', () => ({
  useAppSelector: () => 'PLN',
}));

jest.mock('../components/tables/index.js', () => ({
  ListingsTable: (props: ListingsTableProps) => {
    mockCapture.table = props;
    return null;
  },
}));

function listing(id: string, status: ListingStatus): Listing {
  return {
    id,
    productId: `product-${id}`,
    marketplaceId: 'marketplace-olx',
    price: 100,
    status,
    views: null,
    watchers: null,
    conversations: null,
    messages: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const LISTINGS = [listing('live-1', 'live'), listing('error-1', 'error'), listing('draft-1', 'draft')];

function renderAt(url: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <ListingsPage />
    </MemoryRouter>,
  );
}

describe('ListingsPage status filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete mockCapture.table;
    mockUseListings.mockReturnValue({
      data: LISTINGS,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: undefined,
      refetch: jest.fn(),
    });
  });

  it('reads the status filter from the URL so sync issues deep-link to error listings', () => {
    const html = renderAt('/listings?status=error');

    expect(mockUseListings).toHaveBeenCalledWith({ sort: '-updatedAt', limit: 100, status: ['error'] });
    expect(mockCapture.table?.listings?.map((l) => l.id)).toEqual(['error-1']);
    expect(html).toContain('>Error</span>');
    expect(html).not.toContain('All statuses');
  });

  it('shows every listing when the URL has no status filter', () => {
    const html = renderAt('/listings');

    expect(mockUseListings).toHaveBeenCalledWith({ sort: '-updatedAt', limit: 100 });
    expect(mockCapture.table?.listings).toEqual(LISTINGS);
    expect(html).toContain('All statuses');
  });

  it('ignores unknown and repeated statuses in the URL', () => {
    expect(parseListingStatusParam('bogus,error,live,error')).toEqual(['live', 'error']);
    expect(parseListingStatusParam(null)).toEqual([]);
    expect(parseListingStatusParam('')).toEqual([]);
  });

  it('writes the selected statuses to the URL and drops the param when cleared', () => {
    const current = new URLSearchParams('status=error&page=2');

    expect(withListingStatusParam(current, ['live', 'error']).toString()).toBe('status=live%2Cerror&page=2');
    expect(withListingStatusParam(current, []).toString()).toBe('page=2');
    expect(current.toString()).toBe('status=error&page=2');
  });
});
