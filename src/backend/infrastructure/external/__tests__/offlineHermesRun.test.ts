// Regression guard from the C1 re-review: the production provider graph in auto mode,
// with Hermes configured but unreachable, answers from the offline heuristics. The
// decision engine must then auto-apply nothing those heuristics produced, even in a
// full_auto workspace with every guardrail open, and must label each such event.

import { AIProviderSelector } from '../AIProviderSelector';
import { HermesAI } from '../HermesAI';
import { HermesCompletionClient } from '../HermesCompletionClient';
import { HermesHealthProbe } from '../HermesHealthProbe';
import { OfflineHeuristicAIProvider } from '../OfflineHeuristicAIProvider';
import { HermesDecisionEngine } from '../../../domain/services/HermesDecisionEngine';
import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import { Workspace } from '../../../domain/entities/Workspace';
import type { HermesGuardrails } from '../../../../shared/types';
import {
  InMemoryEventRepository,
  InMemoryListingRepository,
  InMemoryProductRepository,
  RecordingEventPublisher,
  money,
  sequentialIdFactory,
  unwrap,
} from '../../../domain/testkit/support';

const OFFLINE_NOTICE = 'Heuristic offline suggestion; Hermes was not consulted.';
const originalFetch = globalThis.fetch;

const OPEN_GUARDRAILS: HermesGuardrails = {
  maxAutoPriceChangePct: 50,
  minMarginFloor: 0,
  autoCreateListings: true,
  autoAdjustPricing: true,
  autoRelist: true,
  smartTitleAndSEO: true,
};

function setup() {
  const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () => {
    throw new TypeError('fetch failed');
  });
  globalThis.fetch = fetchMock as typeof fetch;
  const config = {
    apiUrl: 'http://127.0.0.1:8642/v1',
    apiKey: 'local-hermes-key',
    model: 'hermes-agent',
    maxTokens: 256,
    timeoutMs: 1_000,
  };
  const selector = new AIProviderSelector({
    hermes: new HermesAI(new HermesCompletionClient(config), config),
    offline: new OfflineHeuristicAIProvider(),
    mode: 'auto',
    probe: new HermesHealthProbe(config),
  });

  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const product = unwrap(
    Product.create({
      id: 'p1',
      workspaceId: 'w1',
      sku: 'SKU-1',
      name: 'retro   camera',
      description: '  classic film camera.   Lightly used, with the original strap.  ',
      costPrice: money(50),
      sellingPrice: money(100),
      condition: 'good',
      category: 'electronics',
      images: ['a.jpg'],
    }),
  );
  productRepo.items.set(product.id, product);
  const listing = unwrap(
    Listing.create({
      id: 'l1',
      productId: 'p1',
      marketplaceId: 'm1',
      price: money(100),
      status: 'live',
    }),
  );
  listingRepo.items.set(listing.id, listing);

  const engine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    new InMemoryEventRepository(),
    new RecordingEventPublisher(),
    selector,
    sequentialIdFactory('offline-run'),
  );
  const workspace = unwrap(
    Workspace.create({
      id: 'w1',
      name: 'WS',
      autonomyLevel: 'full_auto',
      guardrails: OPEN_GUARDRAILS,
    }),
  );
  return { engine, workspace, product, productRepo, fetchMock };
}

function requestedUrls(fetchMock: jest.Mock<Promise<Response>, [string | URL, RequestInit?]>) {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

describe('auto mode with Hermes unreachable (real selector, probe and offline provider)', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('full_auto workspace auto-applies no offline title and labels it offline', async () => {
    const { engine, workspace, product, productRepo, fetchMock } = setup();
    const saveProduct = jest.spyOn(productRepo, 'save');

    const events = await engine.run(workspace);

    const titleEvent = events.find((event) => event.type === 'suggested_better_title');
    expect(titleEvent).toMatchObject({
      status: 'pending_review',
      autonomyDecision: 'pending_review',
      source: 'offline',
      proposedChange: { kind: 'title', to: 'Retro camera - Good condition' },
    });
    expect(titleEvent?.detail).toContain(OFFLINE_NOTICE);
    expect(product.name).toBe('retro   camera');
    expect(saveProduct).not.toHaveBeenCalled();
    expect(requestedUrls(fetchMock)).toEqual(['http://127.0.0.1:8642/v1/models']);
  });

  it('labels listing SEO events offline and keeps them review-only', async () => {
    const { engine, workspace, product, fetchMock } = setup();

    const events = await engine.runProductSeo(workspace, 'p1');

    expect(events.map((event) => event.type)).toEqual([
      'suggested_better_title',
      'update_description',
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ status: 'pending_review', source: 'offline' });
      expect(event.detail).toContain(OFFLINE_NOTICE);
    }
    expect(product.description).toBe(
      '  classic film camera.   Lightly used, with the original strap.  ',
    );
    expect(requestedUrls(fetchMock)).toEqual(['http://127.0.0.1:8642/v1/models']);
  });
});
