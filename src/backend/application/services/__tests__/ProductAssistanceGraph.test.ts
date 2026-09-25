import { Ok } from '../../../domain/shared/Result';
import type { IAIProvider } from '../../../domain/ports/IAIProvider';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import { ProductAssistanceGraph } from '../ProductAssistanceGraph';
import type { ProductAIDraftService } from '../ProductAIDraftService';
import type { ProductRecheckService } from '../ProductRecheckService';

const draft = { mode: 'title' as const, fields: { name: 'Camera' }, confidence: 0.7,
  uncertainFields: [], missingInfoQuestions: [], notes: [] };

function setup() {
  const generateDraft = jest.fn(async () => Ok(draft));
  const recheck = jest.fn(async () => ({ productId: 'p1', canPublish: false }));
  const product = {
    id: 'p1', name: 'Camera', description: 'Camera with lens and accessories.',
    category: 'Cameras', condition: 'good', tags: [], imageCount: 1,
    updatedAt: new Date('2026-09-25T10:00:00.000Z'),
  };
  const listing = {
    id: 'l1', productId: 'p1', marketplaceId: 'm1', views: 10,
    updatedAt: new Date('2026-09-25T10:00:00.000Z'),
    price: { amount: 100, currency: 'PLN' },
  };
  const findProduct = jest.fn(async () => product);
  const findListing = jest.fn(async () => listing);
  const findMarketplace = jest.fn(async () => ({ id: 'm1', key: 'olx' }));
  const analyzeListingSeo = jest.fn(async () => ({
    recommendations: [{ field: 'description', proposedValue: 'Camera with lens and bag.', rationale: 'More detail.' }],
    disclaimer: 'Review before applying.',
  }));
  const suggestPrice = jest.fn(async () => ({ suggestedPrice: 95, reasoning: 'Current views', confidence: 'medium' }));
  const graph = new ProductAssistanceGraph(
    { generateDraft } as unknown as ProductAIDraftService,
    { recheck } as unknown as ProductRecheckService,
    { findByIdForWorkspace: findProduct } as unknown as IProductRepository,
    { findByIdForWorkspace: findListing } as unknown as IListingRepository,
    { findByIdForWorkspace: findMarketplace } as unknown as IMarketplaceRepository,
    { analyzeListingSeo, suggestPrice } as unknown as IAIProvider,
  );
  return { graph, generateDraft, recheck, findProduct, findListing,
    analyzeListingSeo, suggestPrice };
}

describe('ProductAssistanceGraph', () => {
  it('routes pre-creation drafting through the injected Hermes provider service', async () => {
    const s = setup();
    expect(await s.graph.generateDraft('w1', { mode: 'title', title: 'Camera' })).toEqual(draft);
    expect(s.generateDraft).toHaveBeenCalledWith({ mode: 'title', title: 'Camera', workspaceId: 'w1' });
  });

  it('routes publication help through the existing guarded recheck', async () => {
    const s = setup();
    await s.graph.publicationReview({ productId: 'p1', listingId: 'l1', workspaceId: 'w1' });
    expect(s.recheck).toHaveBeenCalledWith({ productId: 'p1', listingId: 'l1', workspaceId: 'w1' });
  });

  it('returns scoped, review-only copy and price proposals without applying them', async () => {
    const s = setup();
    const result = await s.graph.proposeImprovements({ workspaceId: 'w1', productId: 'p1', listingId: 'l1' });
    expect(s.findProduct).toHaveBeenCalledWith('p1', 'w1');
    expect(s.findListing).toHaveBeenCalledWith('l1', 'w1');
    expect(s.analyzeListingSeo).toHaveBeenCalledTimes(1);
    expect(s.suggestPrice).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ graphVersion: 'product-assistance@1', productId: 'p1', reviewOnly: true,
      copy: [{ field: 'description' }], price: { suggestedPrice: 95 } });
  });

  it('rejects a listing that does not belong to the scoped product before calling Hermes', async () => {
    const s = setup();
    s.findListing.mockResolvedValueOnce({ id: 'l1', productId: 'other', marketplaceId: 'm1',
      views: 0, updatedAt: new Date(), price: { amount: 100, currency: 'PLN' } });
    await expect(s.graph.proposeImprovements({ workspaceId: 'w1', productId: 'p1', listingId: 'l1' }))
      .rejects.toThrow('Listing not found for product');
    expect(s.analyzeListingSeo).not.toHaveBeenCalled();
  });
});
