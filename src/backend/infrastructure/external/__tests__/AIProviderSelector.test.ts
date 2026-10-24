// AIProviderSelector routes every AI call to Hermes or to the offline heuristics
// according to HERMES_PROVIDER_MODE and the Hermes health probe.

import { AIProviderSelector } from '../AIProviderSelector';
import { HermesHealthProbe } from '../HermesHealthProbe';
import type { IAIProvider } from '../../../domain/ports/IAIProvider';
import type { ListingSeoInput } from '../../../domain/agents/MarketDeskAgentCatalog';
import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import { StubAIProvider, money, unwrap } from '../../../domain/testkit/support';

const originalFetch = globalThis.fetch;

const product = unwrap(
  Product.create({
    id: 'p1',
    workspaceId: 'w1',
    sku: 'SKU-1',
    name: 'Leather sneaker',
    description: 'Classic leather sneakers in size 42, lightly worn.',
    costPrice: money(80),
    sellingPrice: money(120),
    condition: 'good',
    category: 'clothing',
  }),
);

const listing = unwrap(
  Listing.create({ id: 'l1', productId: 'p1', marketplaceId: 'm1', price: money(120) }),
);

const seoInput: ListingSeoInput = {
  product: {
    id: 'p1',
    name: 'Leather sneaker',
    description: 'Classic leather sneakers in size 42, lightly worn.',
    category: 'clothing',
    condition: 'good',
    tags: [],
    imageCount: 0,
  },
  listing: null,
};

const hermes = new StubAIProvider(undefined, 'Title from Hermes');
const offline = new StubAIProvider(undefined, 'Title from offline heuristics');

const hermesTimeout = async (): Promise<never> => {
  throw new Error('Hermes API request timed out after 120000ms');
};
const timingOutHermes: IAIProvider = {
  suggestPrice: hermesTimeout,
  generateTitle: hermesTimeout,
  analyzeListing: hermesTimeout,
  analyzeListingSeo: hermesTimeout,
};

function probe(configured: boolean, reachable: boolean) {
  return { isConfigured: () => configured, isReachable: async () => reachable };
}

const isoTimestamp = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

describe('AIProviderSelector', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('selector in auto mode uses offline when Hermes is not configured', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>();
    globalThis.fetch = fetchMock as typeof fetch;
    const selector = new AIProviderSelector({
      hermes,
      offline,
      mode: 'auto',
      probe: new HermesHealthProbe({ apiUrl: 'http://127.0.0.1:8642/v1', apiKey: '' }),
    });

    const title = await selector.generateTitle(product, null);

    expect(title).toBe('Title from offline heuristics');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('selector in auto mode uses Hermes when it is configured and reachable', async () => {
    const selector = new AIProviderSelector({ hermes, offline, mode: 'auto', probe: probe(true, true) });

    await expect(selector.generateTitle(product, null)).resolves.toBe('Title from Hermes');
  });

  it('selector in auto mode uses offline when configured Hermes is unreachable', async () => {
    const selector = new AIProviderSelector({ hermes, offline, mode: 'auto', probe: probe(true, false) });

    await expect(selector.generateTitle(product, null)).resolves.toBe('Title from offline heuristics');
  });

  it('selector in auto mode re-checks Hermes on every call', async () => {
    let reachable = false;
    const selector = new AIProviderSelector({
      hermes,
      offline,
      mode: 'auto',
      probe: { isConfigured: () => true, isReachable: async () => reachable },
    });

    const whileDown = await selector.generateTitle(product, null);
    reachable = true;
    const afterRecovery = await selector.generateTitle(product, null);

    expect(whileDown).toBe('Title from offline heuristics');
    expect(afterRecovery).toBe('Title from Hermes');
  });

  it('selector in hermes mode never falls back', async () => {
    const selector = new AIProviderSelector({
      hermes: timingOutHermes,
      offline,
      mode: 'hermes',
      probe: probe(false, false),
    });
    const priceContext = { listing, recentViews: 0, conversionRate: 0 };

    await expect(selector.suggestPrice(priceContext)).rejects.toThrow('Hermes API request timed out');
    await expect(selector.generateTitle(product, null)).rejects.toThrow('Hermes API request timed out');
    await expect(selector.analyzeListing(product)).rejects.toThrow('Hermes API request timed out');
    await expect(selector.analyzeListingSeo(seoInput, 'balanced')).rejects.toThrow(
      'Hermes API request timed out',
    );
  });

  it('selector in offline mode never routes to Hermes', async () => {
    const selector = new AIProviderSelector({
      hermes: timingOutHermes,
      offline,
      mode: 'offline',
      probe: probe(true, true),
    });

    await expect(selector.generateTitle(product, null)).resolves.toBe('Title from offline heuristics');
    await expect(selector.analyzeListing(product)).resolves.toEqual({ score: 100, suggestions: [] });
  });

  it.each([
    { mode: 'offline', configured: true, reachable: true, source: 'offline' },
    { mode: 'hermes', configured: false, reachable: false, source: 'hermes' },
    { mode: 'auto', configured: true, reachable: true, source: 'hermes' },
    { mode: 'auto', configured: true, reachable: false, source: 'offline' },
    { mode: 'auto', configured: false, reachable: true, source: 'offline' },
  ] as const)(
    'activeProvider in $mode mode with configured=$configured and reachable=$reachable is $source',
    async ({ mode, configured, reachable, source }) => {
      const selector = new AIProviderSelector({
        hermes,
        offline,
        mode,
        probe: probe(configured, reachable),
      });

      await expect(selector.activeProvider()).resolves.toBe(source);
    },
  );

  it.each([
    { mode: 'auto', configured: false, probeAnswer: true, activeProvider: 'offline', hermesReachable: null },
    { mode: 'auto', configured: true, probeAnswer: true, activeProvider: 'hermes', hermesReachable: true },
    { mode: 'auto', configured: true, probeAnswer: false, activeProvider: 'offline', hermesReachable: false },
    { mode: 'hermes', configured: true, probeAnswer: false, activeProvider: 'hermes', hermesReachable: false },
    { mode: 'hermes', configured: false, probeAnswer: true, activeProvider: 'hermes', hermesReachable: null },
    { mode: 'offline', configured: true, probeAnswer: true, activeProvider: 'offline', hermesReachable: null },
  ] as const)(
    'status in $mode mode with configured=$configured and probe=$probeAnswer reports $activeProvider',
    async ({ mode, configured, probeAnswer, activeProvider, hermesReachable }) => {
      const selector = new AIProviderSelector({
        hermes,
        offline,
        mode,
        probe: probe(configured, probeAnswer),
      });

      await expect(selector.status()).resolves.toEqual({
        mode,
        activeProvider,
        hermesConfigured: configured,
        hermesReachable,
        checkedAt: isoTimestamp,
      });
    },
  );
});
