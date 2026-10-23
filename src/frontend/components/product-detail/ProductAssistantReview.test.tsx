import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Product, Listing, ProductImprovementReviewSession } from '@shared/types';
import {
  ProductAssistantReview,
  improvementEditedValue,
  improvementReviewIsStale,
} from './ProductAssistantReview';
import { useProductImprovementReview } from '../../services/hooks/index';

jest.mock('../../services/hooks/index', () => ({
  useProductImprovementReview: jest.fn(),
  useProposeProductImprovements: () => [jest.fn()],
  useDecideProductImprovement: () => [jest.fn()],
}));
const product = {
  id: 'p1',
  updatedAt: '2026-09-30T10:00:00Z',
  name: 'Camera',
  description: 'Camera kit',
  costPrice: 50,
} as Product;
const listing = { id: 'l1', updatedAt: product.updatedAt, price: 100 } as Listing;
const session: ProductImprovementReviewSession = {
  sessionId: 's1',
  currency: 'PLN',
  graphVersion: 'product-assistance@1',
  revision: 1,
  productId: 'p1',
  listingId: 'l1',
  productUpdatedAt: product.updatedAt,
  listingUpdatedAt: listing.updatedAt,
  createdAt: product.updatedAt,
  updatedAt: product.updatedAt,
  proposals: [
    {
      proposalId: 'title',
      field: 'title',
      proposedValue: 'Camera and lens',
      rationale: 'Clarifies accessories',
      status: 'pending',
    },
    {
      proposalId: 'price',
      field: 'price',
      proposedValue: 80,
      rationale: 'Competitive price',
      status: 'accepted',
      editedValue: 85,
    },
    {
      proposalId: 'desc',
      field: 'description',
      proposedValue: 'Kit',
      rationale: 'Shorter',
      status: 'rejected',
    },
  ],
};
const query = jest.mocked(useProductImprovementReview);
function render(overrides = {}) {
  query.mockReturnValue({
    currentData: session,
    isFetching: false,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useProductImprovementReview>);
  return renderToStaticMarkup(
    <ProductAssistantReview
      product={product}
      listing={listing}
      currency="PLN"
      principalKey="w1:u1"
      ready
      refresh={async () => undefined}
    />
  );
}
describe('saved product assistance', () => {
  it('scopes restoration to principal, product and listing and shows each saved decision', () => {
    const html = render();
    expect(query).toHaveBeenCalledWith(
      { productId: 'p1', listingId: 'l1', principalKey: 'w1:u1' },
      { skip: false, refetchOnMountOrArgChange: true }
    );
    expect(html).toContain('Title · Pending review');
    expect(html).toContain('Listing price · Accepted');
    expect(html).toContain('85 PLN');
    expect(html).toContain('Description · Rejected');
    expect(html).toContain('Review title');
    expect(html).not.toContain('Review listing price');
  });
  it('distinguishes restoration failures, loading and no saved session', () => {
    expect(render({ currentData: undefined, isLoading: true, isFetching: true })).toContain(
      'Loading saved suggestions'
    );
    const failure = render({ currentData: undefined, isError: true });
    expect(failure).toContain('Unable to load saved suggestions');
    expect(failure).not.toContain('Ask Hermes');
    expect(render({ currentData: null })).toContain('Ask Hermes');
  });
  it('keeps stale pending suggestions visible but disables decisions', () => {
    const html = render({ currentData: { ...session, productUpdatedAt: 'old' } });
    expect(html).toContain('Request fresh suggestions');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Review title/);
  });
  it('keeps captured currency visible and allows dismissing a stale proposal', () => {
    const html = render({ currentData: { ...session, currency: 'EUR' } });
    expect(html).toContain('85 EUR');
    expect(html).toContain('currency changed');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Review title/);
    expect(html).toMatch(/<button(?:(?!disabled).)*>Reject title/);
  });
  it('invalidates review when either selected identity or saved version changes', () => {
    expect(improvementReviewIsStale(session, product, listing, 'PLN')).toBe(false);
    expect(improvementReviewIsStale(session, product, listing, 'EUR')).toBe(true);
    expect(improvementReviewIsStale(session, { ...product, id: 'p2' }, listing)).toBe(true);
    expect(improvementReviewIsStale(session, { ...product, updatedAt: 'new' }, listing)).toBe(true);
    expect(improvementReviewIsStale(session, product, { ...listing, id: 'l2' })).toBe(true);
    expect(improvementReviewIsStale(session, product, { ...listing, updatedAt: 'new' })).toBe(true);
    expect(improvementReviewIsStale(session, product)).toBe(true);
  });
  it.each(['', '   ', '0', '-1', 'NaN', 'Infinity'])('does not apply invalid price %j', (value) => {
    expect(improvementEditedValue('price', value)).toBeNull();
  });
  it('normalizes edited price and requires non-empty copy', () => {
    expect(improvementEditedValue('price', ' 39.99 ')).toBe(39.99);
    expect(improvementEditedValue('title', '  Camera kit  ')).toBe('Camera kit');
    expect(improvementEditedValue('description', '  ')).toBeNull();
  });
});
