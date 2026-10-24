import { ProductApplicationService } from '../ProductApplicationService';
import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import { ConflictError, NotFoundError } from '../../../domain/shared/DomainError';
import {
  InMemoryListingRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../domain/testkit/support';
import type { ListingStatus } from '../../../../shared/types';
import type { IProductImageStorage } from '../../ports/IProductImageStorage';
import type { CreateProductUseCase } from '../../usecases/CreateProductUseCase';
import type { UpdateProductUseCase } from '../../usecases/UpdateProductUseCase';

describe('ProductApplicationService catalogue search', () => {
  it('searches tags before pagination and returns the real total', async () => {
    const repo = new InMemoryProductRepository();
    const tagged = unwrap(
      Product.create({
        id: 'p-tagged',
        workspaceId: 'ws-1',
        sku: 'SKU-1',
        name: 'Headphones',
        description: 'Wireless headphones model',
        costPrice: money(100),
        sellingPrice: money(200),
        condition: 'new',
        category: 'Audio',
        tags: ['featured'],
      })
    );
    const other = unwrap(
      Product.create({
        id: 'p-other',
        workspaceId: 'ws-1',
        sku: 'SKU-2',
        name: 'Keyboard',
        description: 'Mechanical keyboard model',
        costPrice: money(100),
        sellingPrice: money(200),
        condition: 'new',
        category: 'Computers',
        tags: ['office'],
      })
    );
    repo.items.set(tagged.id, tagged);
    repo.items.set(other.id, other);
    const service = new ProductApplicationService(
      repo,
      {} as CreateProductUseCase,
      {} as UpdateProductUseCase,
      new InMemoryListingRepository()
    );

    const result = await service.listProducts({
      workspaceId: 'ws-1',
      search: 'FEATURED',
      limit: 1,
      offset: 0,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.total).toBe(1);
    expect(result.value.items.map((item) => item.id)).toEqual(['p-tagged']);
  });
});

describe('ProductApplicationService.deleteProduct', () => {
  const OWN_UPLOAD = '11111111-1111-4111-8111-111111111111';
  const SHARED_UPLOAD = '22222222-2222-4222-8222-222222222222';
  const LIVE_LISTING_MESSAGE = 'This product is still live on OLX. Unpublish it first.';

  const uploadUrl = (id: string, extension: string) =>
    `/uploads/workspaces/0123456789abcdef01234567/products/${id}.${extension}`;

  function product(id: string, images: string[]): Product {
    return unwrap(
      Product.create({
        id,
        workspaceId: 'ws-1',
        sku: `SKU-${id}`,
        name: `Product ${id}`,
        description: 'A product used to exercise product deletion.',
        costPrice: money(10),
        sellingPrice: money(20),
        condition: 'new',
        category: 'Audio',
        images,
      })
    );
  }

  function setup(
    options: {
      listing?: { status: ListingStatus; marketplaceListingId: string | null };
      failingStorage?: boolean;
    } = {}
  ) {
    const products = new InMemoryProductRepository();
    const listings = new InMemoryListingRepository();
    const unlinked: Array<[string, string]> = [];
    const storage: IProductImageStorage = {
      store: async () => {
        throw new Error('store is not used by product deletion');
      },
      delete: async (workspaceId, imageId) => {
        if (options.failingStorage) throw new Error('EACCES: permission denied');
        unlinked.push([workspaceId, imageId]);
        return true;
      },
    };
    const target = product('p-target', [
      uploadUrl(OWN_UPLOAD, 'jpg'),
      uploadUrl(SHARED_UPLOAD, 'png'),
      'https://ireland.apollo.olxcdn.com/v1/files/photo/image',
    ]);
    const sibling = product('p-sibling', [uploadUrl(SHARED_UPLOAD, 'png')]);
    products.items.set(target.id, target);
    products.items.set(sibling.id, sibling);
    if (options.listing) {
      const listing = unwrap(
        Listing.create({
          id: 'l-target',
          productId: target.id,
          marketplaceId: 'm-1',
          price: money(20),
          ...options.listing,
        })
      );
      listings.items.set(listing.id, listing);
    }
    const logger = { error: jest.fn() };
    const service = new ProductApplicationService(
      products,
      {} as CreateProductUseCase,
      {} as UpdateProductUseCase,
      listings,
      storage,
      logger
    );
    return { service, products, unlinked, logger };
  }

  it('refuses to delete a product while its listing is live on OLX', async () => {
    const { service, products, unlinked } = setup({
      listing: { status: 'live', marketplaceListingId: 'olx-1' },
    });

    const result = await service.deleteProduct('p-target', 'ws-1');

    if (result.isOk()) throw new Error('expected the delete to be refused');
    expect(result.error).toBeInstanceOf(ConflictError);
    expect(result.error.message).toBe(LIVE_LISTING_MESSAGE);
    expect(products.items.has('p-target')).toBe(true);
    expect(unlinked).toEqual([]);
  });

  it.each<[ListingStatus, string | null]>([
    ['draft', null],
    ['draft', 'olx-1'],
    ['expired', 'olx-1'],
    ['error', 'olx-1'],
  ])('deletes a product whose listing is %s with marketplace listing id %p', async (status, marketplaceListingId) => {
    const { service, products } = setup({ listing: { status, marketplaceListingId } });

    const result = await service.deleteProduct('p-target', 'ws-1');

    expect(result.isOk()).toBe(true);
    expect(products.items.has('p-target')).toBe(false);
  });

  it('deletes a product with a draft listing and unlinks uploads no other product uses', async () => {
    const { service, products, unlinked } = setup({
      listing: { status: 'draft', marketplaceListingId: null },
    });

    const result = await service.deleteProduct('p-target', 'ws-1');

    expect(result.isOk() && result.value).toEqual({
      id: 'p-target',
      deleted: true,
      imageCleanup: { removed: [OWN_UPLOAD], failed: [] },
    });
    expect(products.items.has('p-target')).toBe(false);
    expect(unlinked).toEqual([['ws-1', OWN_UPLOAD]]);
  });

  it('keeps the delete, reports an upload that could not be unlinked and logs the cause', async () => {
    const { service, products, logger } = setup({ failingStorage: true });

    const result = await service.deleteProduct('p-target', 'ws-1');

    expect(result.isOk() && result.value).toEqual({
      id: 'p-target',
      deleted: true,
      imageCleanup: { removed: [], failed: [OWN_UPLOAD] },
    });
    expect(products.items.has('p-target')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      {
        productId: 'p-target',
        imageId: OWN_UPLOAD,
        err: expect.objectContaining({ message: 'EACCES: permission denied' }),
      },
      'Product image cleanup failed after the product delete'
    );
  });

  it('reads a product of another workspace as not found and deletes nothing', async () => {
    const { service, products } = setup();

    const result = await service.deleteProduct('p-target', 'ws-other');

    if (result.isOk()) throw new Error('expected a not-found error');
    expect(result.error).toBeInstanceOf(NotFoundError);
    expect(products.items.has('p-target')).toBe(true);
  });
});
