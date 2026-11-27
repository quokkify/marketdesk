import { CategoryMismatchProposals } from './CategoryMismatchProposals';
import type { HermesEvent } from '../../domain/entities/HermesEvent';
import type { Listing } from '../../domain/entities/Listing';
import type { Product } from '../../domain/entities/Product';
import type { MarketplaceCategoryMetadata } from '../../../shared/types';

const category = (id: string): MarketplaceCategoryMetadata =>
  ({ providerCategoryId: id, path: ['Root', id] }) as unknown as MarketplaceCategoryMetadata;

describe('CategoryMismatchProposals.raise', () => {
  it('saves one olx_category_mismatch event for a decided call and nothing new on a repeat', async () => {
    const saved = new Map<string, HermesEvent>();
    const eventRepo = {
      saveRecommendationIfAbsent: jest.fn(async (event: HermesEvent, key: string) => {
        if (saved.has(key)) return false;
        saved.set(key, event);
        return true;
      }),
    };
    const correctionOperations = { createPair: jest.fn(async () => undefined) };
    let n = 0;
    const proposals = new CategoryMismatchProposals(() => `id-${++n}`, {
      eventRepo: eventRepo as never,
      correctionOperations: correctionOperations as never,
      accounts: {
        findByMarketplaceId: async () => ({ id: 'acc-1', revision: 3, status: 'connected' }) as never,
      },
    });
    const input = {
      workspaceId: 'ws-1',
      product: { id: 'prod-1' } as Product,
      listing: {
        id: 'lst-1',
        marketplaceId: 'mkt-1',
        marketplaceListingId: 'ext-1',
        externalUrl: null,
        updatedAt: new Date('2026-11-27T00:00:00Z'),
      } as unknown as Listing,
      currentCategory: category('100'),
      proposedCategory: category('200'),
    };

    const first = await proposals.raise(input);
    const second = await proposals.raise(input);

    expect(first?.type).toBe('olx_category_mismatch');
    expect(second).toBeNull();
    expect([...saved.keys()]).toEqual(['olx-category-mismatch:lst-1:100:200']);
    expect(correctionOperations.createPair).toHaveBeenCalledTimes(1);
  });
});
