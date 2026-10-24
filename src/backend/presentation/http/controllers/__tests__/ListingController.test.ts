import type { NextFunction, Request, Response } from 'express';
import { ListingController } from '../ListingController';
import type { ListingApplicationService } from '../../../../application/services/ListingApplicationService';
import type { OlxAdapterMode } from '../../../../config/env';
import { Listing } from '../../../../domain/entities/Listing';
import { Marketplace } from '../../../../domain/entities/Marketplace';
import { Product } from '../../../../domain/entities/Product';
import {
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../../domain/testkit/support';

// The publish preview of a listing whose category came from the sandbox taxonomy.
async function previewSandboxCategory(olxAdapterMode: OlxAdapterMode | undefined) {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  await productRepo.save(unwrap(Product.create({
    id: 'product-1',
    workspaceId: 'ws-1',
    sku: 'CAM-1',
    name: 'Vintage film camera',
    description: 'A well-kept vintage film camera with a working light meter.',
    costPrice: money(120),
    sellingPrice: money(349),
    condition: 'good',
    category: 'electronics',
  })));
  await marketplaceRepo.save(unwrap(Marketplace.create({
    id: 'marketplace-olx', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected: true,
  })));
  await listingRepo.save(unwrap(Listing.create({
    id: 'listing-1',
    productId: 'product-1',
    marketplaceId: 'marketplace-olx',
    price: money(349),
    marketplaceCategory: {
      providerCategoryId: '1001',
      name: 'Cameras',
      path: ['Electronics', 'Cameras'],
      source: 'provider_taxonomy',
      confidence: 1,
      isLeaf: true,
      taxonomyVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
      taxonomyStaleAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
      sandbox: true,
    },
  })));
  // A composition root that forgets the mode passes undefined at runtime.
  const controller = new ListingController({} as ListingApplicationService, listingRepo, {
    productRepo,
    marketplaceRepo,
    olxAdapterMode: olxAdapterMode as OlxAdapterMode,
  });
  const json = jest.fn();
  const res = { status: jest.fn(() => res), json } as unknown as Response;
  const next = jest.fn() as NextFunction;

  await controller.publishPreview(
    { params: { id: 'listing-1' }, user: { userId: 'user-1', workspaceId: 'ws-1' } } as unknown as Request,
    res,
    next,
  );

  expect(next).not.toHaveBeenCalled();
  return json.mock.calls[0][0].data;
}

describe('ListingController publish preview', () => {
  it('treats an explicit stub adapter as the OLX sandbox', async () => {
    expect(await previewSandboxCategory('stub')).toMatchObject({
      sandbox: true,
      categoryDecision: { allowed: true },
    });
  });

  it('fails closed to real OLX when the adapter mode is missing', async () => {
    expect(await previewSandboxCategory(undefined)).toMatchObject({
      sandbox: false,
      categoryDecision: { allowed: false, reason: 'category_sandbox' },
    });
  });
});
