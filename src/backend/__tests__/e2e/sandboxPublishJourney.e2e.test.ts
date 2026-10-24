// End-to-end sandbox publish journey (Task B4). Real services, use cases and domain
// services run over in-memory repositories, and the publish queue runs the real
// PublishListingHandler synchronously. OLX runs in sandbox mode: the sandbox OAuth
// connection, the stub taxonomy, the sandbox quota and the stub OLX transport. The
// journey goes through HTTP only and must never reach the network.

import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { buildApp, type AppDeps } from '../../presentation/http/app';
import { InMemoryAuthStore } from '../../presentation/testkit/support';
import {
  AtomicInMemoryQuotaRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  RecordingEventPublisher,
} from '../../domain/testkit/support';
import {
  InMemoryActivityLogRepository,
  InMemoryWorkspaceRepository,
  RecordingJobQueue,
  idFactory,
} from '../../application/testkit/support';
import { InMemorySettingsRepository } from '../../infrastructure/persistence/repositories/InMemorySettingsRepository';

import { ProductService } from '../../domain/services/ProductService';
import { ListingService } from '../../domain/services/ListingService';
import { CreateProductUseCase } from '../../application/usecases/CreateProductUseCase';
import { UpdateProductUseCase } from '../../application/usecases/UpdateProductUseCase';
import { PublishListingUseCase } from '../../application/usecases/PublishListingUseCase';
import { SyncMarketplaceUseCase } from '../../application/usecases/SyncMarketplaceUseCase';
import { ProductApplicationService } from '../../application/services/ProductApplicationService';
import { ListingApplicationService } from '../../application/services/ListingApplicationService';
import { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';
import type { HermesApplicationService } from '../../application/services/HermesApplicationService';
import type { MarketplaceImportService } from '../../application/services/MarketplaceImportService';
import {
  MarketplaceOAuthService,
  type MarketplaceAccountRecord,
  type MarketplaceAccountRepository,
} from '../../application/services/MarketplaceOAuthService';
import { MarketplaceSyncScheduler } from '../../application/services/MarketplaceSyncScheduler';
import { OlxPublicationQuotaService } from '../../application/services/OlxPublicationQuotaService';

import { MarketplaceAdapterFactory } from '../../infrastructure/adapters/MarketplaceAdapterFactory';
import { StubMarketplaceHttpClient } from '../../infrastructure/adapters/MarketplaceHttpClient';
import { StubOlxTaxonomyResolver } from '../../infrastructure/adapters/StubOlxTaxonomyResolver';
import { AesGcmCredentialVault } from '../../infrastructure/security/AesGcmCredentialVault';
import { PublishListingHandler } from '../../infrastructure/jobQueue/JobHandlers/PublishListingHandler';
import { SyncPublishQueue, inMemoryPublishAttempts } from '../../infrastructure/testkit/support';

const SUCCESS_URL = 'http://localhost:5173/marketplaces';
const PUBLIC_BASE_URL = 'http://localhost:3000';

const UPLOADED_PHOTO =
  '/uploads/workspaces/0123456789abcdef01234567/products/5f0c2a4e-8d1b-4c3a-9e2f-1a2b3c4d5e6f.jpg';

// Marketplace accounts keyed by marketplace id, shared by the OAuth service, the
// publish use case and the quota service, as the Postgres repository is.
function inMemoryAccounts(): MarketplaceAccountRepository {
  const accounts = new Map<string, MarketplaceAccountRecord>();
  return {
    findByMarketplaceId: async (marketplaceId) => accounts.get(marketplaceId) ?? null,
    upsert: async (account) => {
      const current = accounts.get(account.marketplaceId);
      const saved: MarketplaceAccountRecord = {
        ...account,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      accounts.set(account.marketplaceId, saved);
      return saved;
    },
    updateConnectedIfUnchanged: async () => {
      throw new Error('The sandbox journey never refreshes OLX tokens');
    },
  };
}

function buildSandboxApp() {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  const activityLog = new InMemoryActivityLogRepository();
  const events = new RecordingEventPublisher();
  const idGenerator = idFactory('id');
  const accountRepo = inMemoryAccounts();

  const marketplaceOAuthService = new MarketplaceOAuthService({
    marketplaceRepo,
    accountRepo,
    appCredentialRepo: {
      findByMarketplaceId: async () => null,
      upsert: async () => {
        throw new Error('OLX application credentials are not used in sandbox mode');
      },
      deleteByMarketplaceId: async () => undefined,
    },
    stateStore: {
      save: async () => {
        throw new Error('The OLX OAuth state is not used in sandbox mode');
      },
      consume: async () => null,
    },
    oauthClientFactory: () => {
      throw new Error('The OLX OAuth client must not be built in sandbox mode');
    },
    credentialVault: new AesGcmCredentialVault(randomBytes(32).toString('base64')),
    idGenerator,
    stateGenerator: () => 'unused-oauth-state',
    sandbox: { enabled: true, successUrl: SUCCESS_URL },
  });
  const quotaService = new OlxPublicationQuotaService(
    marketplaceRepo,
    accountRepo,
    new AtomicInMemoryQuotaRepository(),
    activityLog,
    idGenerator,
    { resolve: () => null },
    undefined,
    { sandboxMode: true }
  );

  // Without an injected transport the factory builds the OLX adapter on its stub transport.
  const publishHandler = new PublishListingHandler(
    new MarketplaceAdapterFactory({ olx: { publicBaseUrl: PUBLIC_BASE_URL } }),
    events,
    new ListingService(listingRepo, productRepo, marketplaceRepo, events),
    undefined,
    undefined,
    inMemoryPublishAttempts(),
    quotaService
  );
  const publishListingUC = new PublishListingUseCase(
    listingRepo,
    productRepo,
    marketplaceRepo,
    new SyncPublishQueue(publishHandler),
    activityLog,
    idGenerator,
    accountRepo,
    quotaService,
    { sandboxMode: true }
  );
  const productService = new ProductApplicationService(
    productRepo,
    new CreateProductUseCase(new ProductService(productRepo, events), workspaceRepo, idGenerator),
    new UpdateProductUseCase(productRepo, events),
    listingRepo
  );

  const deps: AppDeps = {
    productService,
    listingService: new ListingApplicationService(
      listingRepo,
      publishListingUC,
      new SyncMarketplaceUseCase(marketplaceRepo, listingRepo, new RecordingJobQueue()),
      productRepo
    ),
    // Hermes and marketplace import are not part of the journey.
    hermesService: {} as unknown as HermesApplicationService,
    analyticsService: new AnalyticsApplicationService(productRepo, listingRepo, marketplaceRepo),
    productRepo,
    listingRepo,
    marketplaceRepo,
    marketplaceOAuthService,
    marketplaceSyncScheduler: new MarketplaceSyncScheduler({
      scheduleRepeat: async () => undefined,
      removeRepeat: async () => undefined,
    }),
    marketplaceImportService: {} as unknown as MarketplaceImportService,
    olxPublicationQuotaService: quotaService,
    olxTaxonomyResolver: async () => new StubOlxTaxonomyResolver(),
    marketplaceOAuthReturnUrl: SUCCESS_URL,
    olxAdapterMode: 'stub',
    workspaceRepo,
    settingsRepo: new InMemorySettingsRepository(),
    authUserStore: new InMemoryAuthStore(),
    idGenerator,
  };
  return buildApp(deps, { enableRateLimit: false });
}

describe('sandbox publish journey (OLX stub mode)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers, connects the OLX sandbox and publishes a live listing without calling OLX', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('The sandbox journey must not reach the network'));
    const olxTransport = jest.spyOn(StubMarketplaceHttpClient.prototype, 'request');
    const app = buildSandboxApp();

    const register = await request(app)
      .post('/api/auth/register')
      .send({ email: 'tester@example.com', password: 'sandbox-pass-1' });
    expect(register.status).toBe(201);
    const token = register.body.data.token as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const marketplaces = await auth(request(app).get('/api/marketplaces'));
    const olx = marketplaces.body.data.find((marketplace: { key: string }) => marketplace.key === 'olx');
    expect(olx).toMatchObject({ connected: false, sandbox: true });

    const connect = await auth(request(app).post(`/api/marketplaces/${olx.id}/connect`)).send({});
    expect(connect.status).toBe(200);
    expect(connect.body.data).toMatchObject({
      authorizationUrl: `${SUCCESS_URL}?oauth=success&marketplaceId=${olx.id}&sandbox=1`,
      sandbox: true,
    });
    const connected = await auth(request(app).get(`/api/marketplaces/${olx.id}`));
    expect(connected.body.data).toMatchObject({ connected: true, sandbox: true });

    const product = await auth(request(app).post('/api/products')).send({
      sku: 'SANDBOX-CAM-1',
      name: 'Vintage film camera',
      description: 'A well-kept vintage film camera with a working light meter.',
      costPrice: 120,
      sellingPrice: 349,
      condition: 'good',
      category: 'electronics',
      images: [UPLOADED_PHOTO],
    });
    expect(product.status).toBe(201);
    expect(product.body.data.status).toBe('draft');
    const productId = product.body.data.id as string;

    const listing = await auth(request(app).post(`/api/products/${productId}/listings`)).send({
      marketplaceKey: 'olx',
    });
    expect(listing.status).toBe(201);
    const listingId = listing.body.data.id as string;

    const category = await auth(
      request(app).put(`/api/listings/${listingId}/marketplace-category`)
    ).send({ providerCategoryId: '1001' });
    expect(category.status).toBe(200);
    expect(category.body.data.marketplaceCategory).toMatchObject({
      providerCategoryId: '1001',
      name: 'Cameras',
      sandbox: true,
    });

    const preview = await auth(request(app).post(`/api/listings/${listingId}/publish-preview`)).send(
      {}
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      canPublish: true,
      sandbox: true,
      warnings: [],
      quotaDecision: { decision: 'allow', reason: 'sandbox_unlimited' },
    });

    const publish = await auth(request(app).post(`/api/listings/${listingId}/publish`)).send({});
    expect(publish.status).toBe(200);

    const live = await auth(request(app).get(`/api/listings/${listingId}`));
    expect(live.body.data.status).toBe('live');
    expect(live.body.data.marketplaceListingId).toMatch(/^olx-/);
    // A sandbox advert has no OLX page, so the API returns no public link for it.
    expect(live.body.data.externalUrl).toBeUndefined();

    const published = await auth(request(app).get(`/api/products/${productId}`));
    expect(published.body.data).toMatchObject({ status: 'active', images: [UPLOADED_PHOTO] });

    // The stub OLX transport received the advert with the photo as an absolute URL.
    const advertRequests = olxTransport.mock.calls
      .map(([config]) => config)
      .filter((config) => config.method === 'POST');
    expect(advertRequests).toHaveLength(1);
    expect(advertRequests[0].body).toMatchObject({
      category_id: 1001,
      images: [{ url: `${PUBLIC_BASE_URL}${UPLOADED_PHOTO}` }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
