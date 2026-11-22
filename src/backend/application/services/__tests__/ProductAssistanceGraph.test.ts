import { Ok } from '../../../domain/shared/Result';
import { OFFLINE_AI_NOTICE, type IAIProvider } from '../../../domain/ports/IAIProvider';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IPriceResearchRepository } from '../../../domain/repositories/interfaces/IPriceResearchRepository';
import { ProductAssistanceGraph } from '../ProductAssistanceGraph';
import type { ProductAIDraftService } from '../ProductAIDraftService';

const draft = { mode: 'title' as const, fields: { name: 'Camera' }, confidence: 0.7,
  uncertainFields: [], missingInfoQuestions: [], notes: [] };

const storedEstimate = (reasoning = 'Comparable used offers', hiddenReason: string | null = null) => ({
  lastEstimate: { hiddenReason, estimate: { startPrice: 95, floorPrice: 80, reasoning, confidence: 'medium' } },
});

function setup(options: {
  listing?: object;
  stored?: object | null;
  researchError?: Error;
  analyzeListingSeo?: IAIProvider['analyzeListingSeo'];
} = {}) {
  const generateDraft = jest.fn(async () => Ok(draft));
  const product = {
    id: 'p1', workspaceId: 'w1', name: 'Camera', description: 'Camera with lens and accessories.',
    category: 'Cameras', condition: 'good', tags: [], imageCount: 1,
    costPrice: { amount: 60, currency: 'PLN' }, sellingPrice: { amount: 100, currency: 'PLN' },
    updatedAt: new Date('2026-09-25T10:00:00.000Z'),
  };
  const listing = options.listing ?? {
    id: 'l1', productId: 'p1', marketplaceId: 'm1', status: 'expired', marketplaceListingId: 'olx-1',
    updatedAt: new Date('2026-09-25T10:00:00.000Z'),
    price: { amount: 100, currency: 'PLN' },
  };
  const findProduct = jest.fn(async () => product);
  const findListing = jest.fn(async () => listing);
  const findMarketplace = jest.fn(async () => ({ id: 'm1', key: 'olx' }));
  const findResearch = jest.fn(async () => {
    if (options.researchError) throw options.researchError;
    return options.stored === undefined ? storedEstimate() : options.stored;
  });
  const analyzeListingSeo = jest.fn(options.analyzeListingSeo ?? (async () => ({
    recommendations: [{ field: 'description' as const, proposedValue: 'Camera with lens and bag.', rationale: 'More detail.' }],
    disclaimer: 'Review before applying.',
  })));
  const graph = new ProductAssistanceGraph(
    { generateDraft } as unknown as ProductAIDraftService,
    { findByIdForWorkspace: findProduct } as unknown as IProductRepository,
    { findByIdForWorkspace: findListing } as unknown as IListingRepository,
    { findByIdForWorkspace: findMarketplace } as unknown as IMarketplaceRepository,
    { findByProduct: findResearch } as unknown as IPriceResearchRepository,
    { analyzeListingSeo } as unknown as IAIProvider,
  );
  return { graph, generateDraft, findResearch, analyzeListingSeo };
}

describe('ProductAssistanceGraph', () => {
  it('routes pre-creation drafting through the injected Hermes provider service', async () => {
    const s = setup();
    expect(await s.graph.generateDraft('w1', { mode: 'title', title: 'Camera' })).toEqual(draft);
    expect(s.generateDraft).toHaveBeenCalledWith({ mode: 'title', title: 'Camera', workspaceId: 'w1' });
  });

  it('revives with the stored research estimate as the price and asks no price model', async () => {
    const s = setup();
    const result = await s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' });
    expect(s.findResearch).toHaveBeenCalledWith('w1', 'p1');
    expect(s.analyzeListingSeo).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      aiIssues: [],
      price: { current: 100, proposed: 95, currency: 'PLN', rationale: 'Comparable used offers' },
      description: { proposed: 'Camera with lens and bag.' },
    });
  });

  it('names the price as an issue and proposes none when no estimate is stored', async () => {
    const s = setup({ stored: null });
    const result = await s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' });
    expect(result.aiIssues).toEqual(['price']);
    expect(result.price).toBeUndefined();
  });

  it('names the price as an issue when the research holds no estimate yet', async () => {
    const s = setup({ stored: { lastEstimate: null } });
    const result = await s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' });
    expect(result.aiIssues).toEqual(['price']);
  });

  it('offers no price from an estimate the price check hides', async () => {
    const s = setup({ stored: storedEstimate('Comparable used offers', 'low_confidence') });
    const result = await s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' });
    expect(result.aiIssues).toEqual(['price']);
    expect(result.price).toBeUndefined();
  });

  it('names the price as an issue when the research cannot be read, and still proposes', async () => {
    const s = setup({ researchError: new Error('db down') });
    const result = await s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' });
    expect(result.aiIssues).toEqual(['price']);
    expect(result.price).toBeUndefined();
    expect(result.description).toMatchObject({ proposed: 'Camera with lens and bag.' });
  });

  it('offers no price built from offline heuristics', async () => {
    const s = setup({ stored: storedEstimate(`${OFFLINE_AI_NOTICE} The current price is kept.`) });
    const result = await s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' });
    expect(result.price).toBeUndefined();
  });

  it('survives a failed copy step and names it', async () => {
    const s = setup({ analyzeListingSeo: async () => { throw new Error('Hermes down'); } });
    const result = await s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' });
    expect(result.aiIssues).toEqual(['copy']);
    expect(result.price).toMatchObject({ proposed: 95 });
  });

  it('refuses a listing that is not expired before calling Hermes', async () => {
    const s = setup({ listing: { id: 'l1', productId: 'p1', marketplaceId: 'm1', status: 'live',
      marketplaceListingId: 'olx-1', updatedAt: new Date(), price: { amount: 100, currency: 'PLN' } } });
    await expect(s.graph.proposeRevival({ workspaceId: 'w1', listingId: 'l1' })).rejects.toThrow();
    expect(s.analyzeListingSeo).not.toHaveBeenCalled();
    expect(s.findResearch).not.toHaveBeenCalled();
  });
});
