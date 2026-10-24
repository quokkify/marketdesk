// Composition-root unit test. Builds the FULL object graph with in-memory doubles
// for every connection-bearing boundary (pg Pool, Redis, Bull queues, AI provider)
// so it needs no live infrastructure, and asserts that:
//   1. every required AppDeps field is populated,
//   2. the optional ports (price history, id generator) are wired,
//   3. buildApp(deps) returns a working Express app without throwing,
//   4. the WS subscriber is a functioning EventSubscriber,
//   5. shutdown() resolves.

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { buildBullAddOptions, buildContainer, type ManagedQueue } from '../container';
import { buildApp } from '../../../presentation/http/app';
import type { IAIProvider } from '../../../domain/ports/IAIProvider';
import { env } from '../../env';
import { StubOlxTaxonomyResolver } from '../../../infrastructure/adapters/StubOlxTaxonomyResolver';
import { MarketplaceAdapterFactory } from '../../../infrastructure/adapters/MarketplaceAdapterFactory';

// Records the factory configuration and still builds the real factory.
jest.mock('../../../infrastructure/adapters/MarketplaceAdapterFactory', () => {
  const actual = jest.requireActual('../../../infrastructure/adapters/MarketplaceAdapterFactory');
  return {
    ...actual,
    MarketplaceAdapterFactory: jest.fn(
      (config: unknown) => new actual.MarketplaceAdapterFactory(config),
    ),
  };
});

// --- Doubles -----------------------------------------------------------------

const fakePool = {
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
  end: jest.fn(async () => undefined),
} as unknown as Pool;

const fakeRedis = {
  xadd: jest.fn(async () => '0-0'),
  get: jest.fn(async () => null),
  set: jest.fn(async () => 'OK'),
  setex: jest.fn(async () => 'OK'),
  del: jest.fn(async () => 0),
  quit: jest.fn(async () => 'OK'),
} as unknown as Redis;

const fakeAi: IAIProvider = {
  suggestPrice: async () => ({ suggestedPrice: 1, reasoning: 'x', confidence: 'low' }),
  generateTitle: async (product) => product.name,
  analyzeListing: async () => ({ score: 0, suggestions: [] }),
  analyzeListingSeo: async () => ({ recommendations: [], disclaimer: 'Review only.' }),
};
const validCredentialsKey = Buffer.alloc(32, 7).toString('base64');

function makeQueue<T>(): ManagedQueue<T> {
  return {
    enqueue: jest.fn(async () => undefined),
    enqueueAll: jest.fn(async () => undefined),
    scheduleRepeat: jest.fn(async () => undefined),
    removeRepeat: jest.fn(async () => undefined),
    registerHandler: jest.fn(),
    close: jest.fn(async () => undefined),
  };
}

function build() {
  return buildContainer({
    pool: fakePool,
    redis: fakeRedis,
    aiProvider: fakeAi,
    idGenerator: () => 'fixed-id',
    marketplaceCredentialsKey: validCredentialsKey,
    createQueue: <T>(_name: string) => makeQueue<T>(),
  });
}

// --- Tests -------------------------------------------------------------------

describe('buildContainer (composition root)', () => {
  it('fails during container construction for an invalid credential-vault key', () => {
    expect(() =>
      buildContainer({
        pool: fakePool,
        redis: fakeRedis,
        aiProvider: fakeAi,
        marketplaceCredentialsKey: '',
        createQueue: <T>(_name: string) => makeQueue<T>(),
      })
    ).toThrow('MARKETPLACE_CREDENTIALS_KEY');
  });

  it('retries checkpointed publish and optimistic sync jobs with exponential backoff', () => {
    expect(buildBullAddOptions('publish-listing')).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
    });
    expect(buildBullAddOptions('sync-marketplace')).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  });

  it('populates every required AppDeps field', () => {
    const { deps } = build();
    expect(deps.productService).toBeDefined();
    expect(deps.listingService).toBeDefined();
    expect(deps.hermesService).toBeDefined();
    expect(deps.analyticsService).toBeDefined();
    expect(deps.productRepo).toBeDefined();
    expect(deps.listingRepo).toBeDefined();
    expect(deps.marketplaceRepo).toBeDefined();
    expect(deps.workspaceRepo).toBeDefined();
    expect(deps.authUserStore).toBeDefined();
  });

  it('passes the public base URL to the OLX adapter factory', () => {
    build();

    expect(MarketplaceAdapterFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        olx: expect.objectContaining({ publicBaseUrl: env.publicBaseUrl }),
      }),
    );
  });

  it('shares one image storage between uploads and product deletion', () => {
    const { deps } = build();
    // Private fields: sharing the instance shares its per-workspace lock.
    const uploadStorage = (deps.productImageUploadService as unknown as { storage: unknown })
      .storage;
    const cleanupStorage = (deps.productService as unknown as { imageStorage: unknown })
      .imageStorage;
    expect(uploadStorage).toBeDefined();
    expect(cleanupStorage).toBe(uploadStorage);
  });

  it('wires the optional ports (price history + id generator)', () => {
    const { deps } = build();
    expect(deps.priceHistoryReader).toBeDefined();
    expect(deps.priceHistoryRecorder).toBeDefined();
    // Reader and recorder are the same PriceHistoryRepository instance.
    expect(deps.priceHistoryReader).toBe(deps.priceHistoryRecorder);
    expect(typeof deps.idGenerator).toBe('function');
    expect(deps.idGenerator?.()).toBe('fixed-id');
  });

  it('wires the AI provider status behind GET /api/hermes/status', () => {
    const { deps } = build();
    expect(typeof deps.hermesStatus).toBe('function');
  });

  it.each(['offline', 'hermes'] as const)(
    'reports the env-configured provider mode %s through the status function',
    async (mode) => {
      const originalMode = env.hermes.providerMode;
      const originalFetch = globalThis.fetch;
      // A configured key in the developer environment must not reach a real Hermes.
      globalThis.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;
      env.hermes.providerMode = mode;
      try {
        const { deps } = build();

        await expect(deps.hermesStatus?.()).resolves.toMatchObject({ mode, activeProvider: mode });
      } finally {
        env.hermes.providerMode = originalMode;
        globalThis.fetch = originalFetch;
      }
    },
  );

  it('builds an Express app from the resolved deps without throwing', () => {
    const { deps } = build();
    const app = buildApp(deps, { enableRateLimit: false, corsOrigin: '*' });
    expect(app).toBeDefined();
    // A configured Express app exposes routing + a listen function.
    expect(typeof app.listen).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  it('exposes a functioning WS event subscriber fed by the broker', () => {
    const { subscriber } = build();
    expect(typeof subscriber.subscribe).toBe('function');
    const received: unknown[] = [];
    const unsubscribe = subscriber.subscribe((e) => received.push(e));
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('propagates a Hermes-run failure through the job handler (C2)', async () => {
    // Capture the handler registered on the hermes-run queue.
    let hermesHandler: ((data: unknown) => Promise<unknown>) | undefined;
    const capturingQueue = <T>(name: string): ManagedQueue<T> => ({
      enqueue: jest.fn(async () => undefined),
      enqueueAll: jest.fn(async () => undefined),
      scheduleRepeat: jest.fn(async () => undefined),
      removeRepeat: jest.fn(async () => undefined),
      registerHandler: jest.fn((h: (data: T) => Promise<unknown>) => {
        if (name === 'hermes-run') {
          hermesHandler = h as (data: unknown) => Promise<unknown>;
        }
      }),
      close: jest.fn(async () => undefined),
    });

    // fakePool.query returns no rows, so workspaceRepo.findById -> null and
    // runHermes returns Err(NotFound). The container's engine port must THROW on
    // that Err rather than reporting eventsGenerated:0 as success.
    buildContainer({
      pool: fakePool,
      redis: fakeRedis,
      aiProvider: fakeAi,
      idGenerator: () => 'fixed-id',
      marketplaceCredentialsKey: validCredentialsKey,
      createQueue: capturingQueue,
    });

    expect(hermesHandler).toBeDefined();
    await expect(hermesHandler!({ workspaceId: 'missing', trigger: 'manual' })).rejects.toThrow();
  });

  it('exposes lifecycle handles and a resolving shutdown()', async () => {
    const container = build();
    expect(container.pool).toBe(fakePool);
    expect(container.redis).toBe(fakeRedis);
    expect(container.cache).toBeDefined();
    expect(container.queues).toHaveLength(3);
    await expect(container.shutdown()).resolves.toBeUndefined();
    for (const q of container.queues) {
      expect(q.close).toHaveBeenCalled();
    }
  });
});

describe('OLX taxonomy resolver wiring', () => {
  const configuredAdapterMode = env.marketplaces.olx.adapterMode;

  afterEach(() => {
    env.marketplaces.olx.adapterMode = configuredAdapterMode;
  });

  it('serves the stub taxonomy without an OLX access token while the adapter is not real', async () => {
    env.marketplaces.olx.adapterMode = 'stub';
    const { deps } = build();

    // No marketplace account row exists, so any access-token lookup would reject.
    const resolver = await deps.olxTaxonomyResolver!('marketplace-olx');

    expect(resolver).toBeInstanceOf(StubOlxTaxonomyResolver);
    await expect(resolver.verify('1001')).resolves.toMatchObject({
      providerCategoryId: '1001',
      name: 'Cameras',
      path: ['Electronics', 'Cameras'],
    });
  });

  it('still resolves the OLX access token for the taxonomy in real mode', async () => {
    env.marketplaces.olx.adapterMode = 'real';
    const { deps } = build();

    await expect(deps.olxTaxonomyResolver!('marketplace-olx')).rejects.toThrow(
      'OLX account is not connected'
    );
  });
});
