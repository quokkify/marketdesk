import { Product } from '../../entities/Product';
import { Listing } from '../../entities/Listing';
import type { ListingStatus, ProductStatus } from '../../../../shared/types';
import { Money } from '../../valueObjects/Money';
import { activateDraftWithLiveListing } from '../productSaleStatus';

function unwrap<T>(r: { isOk(): boolean; value?: T; error?: unknown }): T {
  if (!r.isOk()) throw r.error;
  return r.value as T;
}

function product(status: ProductStatus): Product {
  return unwrap(
    Product.create({
      id: 'p-1',
      workspaceId: 'ws-1',
      sku: 'SKU-1',
      name: 'Projector',
      description: 'Projector with complete details and accessories',
      costPrice: null,
      sellingPrice: unwrap(Money.of(299, 'PLN')),
      condition: 'unknown',
      category: 'Projektory',
      status,
    })
  );
}

function listing(productId: string, status: ListingStatus): Listing {
  return unwrap(
    Listing.create({
      id: `l-${status}`,
      productId,
      marketplaceId: 'm-1',
      price: unwrap(Money.of(299, 'PLN')),
      status,
    })
  );
}

describe('activateDraftWithLiveListing', () => {
  it('puts a draft product on sale when one of its listings is live', () => {
    const p = product('draft');
    expect(
      unwrap(activateDraftWithLiveListing(p, [listing('p-1', 'expired'), listing('p-1', 'live')]))
    ).toBe(true);
    expect(p.status).toBe('active');
  });

  it('leaves a draft product alone when none of its listings is live', () => {
    const p = product('draft');
    expect(unwrap(activateDraftWithLiveListing(p, [listing('p-1', 'expired')]))).toBe(false);
    expect(p.status).toBe('draft');
  });

  it('ignores live listings of other products', () => {
    const p = product('draft');
    expect(unwrap(activateDraftWithLiveListing(p, [listing('p-other', 'live')]))).toBe(false);
    expect(p.status).toBe('draft');
  });

  it.each<ProductStatus>(['active', 'attention', 'sold'])('never moves a %s product', (status) => {
    const p = product(status);
    expect(unwrap(activateDraftWithLiveListing(p, [listing('p-1', 'live')]))).toBe(false);
    expect(p.status).toBe(status);
  });
});
