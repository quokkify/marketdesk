// Integration tests for the presentation layer, exercised with supertest against
// buildApp(deps). Application services are stubbed for deterministic Results; the
// focus is the HTTP contract: envelope shape (§18), auth, validation and error->status
// mapping (§5/§19).

import type { MarketplaceImportService } from '../../application/services/MarketplaceImportService';
import { createHmac } from 'node:crypto';
import express from 'express';
import type { OlxAdapterMode } from '../../config/env';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { buildApp, type AppDeps } from '../http/app';
import { validateBody } from '../http/middleware/ValidationMiddleware';
import { signToken } from '../http/middleware/AuthMiddleware';
import { env } from '../../config/env';
import { meRateLimiter } from '../http/middleware/RateLimitMiddleware';
import { createAuthRoutes } from '../http/routes/auth';
import type { AuthController } from '../http/controllers/AuthController';
import { InMemoryAuthStore } from '../testkit/support';
import { RecordingJobQueue } from '../../application/testkit/support';
import { SyncMarketplaceUseCase } from '../../application/usecases/SyncMarketplaceUseCase';
import type { ListingResponseJob, SyncMarketplaceJob } from '../../application/ports/IJobQueue';
import type { SyncMarketplaceDTO } from '../../application/dto/HermesDTO';
import { Ok, Err } from '../../domain/shared/Result';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';
import { Product } from '../../domain/entities/Product';
import { Marketplace } from '../../domain/entities/Marketplace';
import { Workspace } from '../../domain/entities/Workspace';
import { Listing } from '../../domain/entities/Listing';
import { Money } from '../../domain/valueObjects/Money';
import type { ProductApplicationService } from '../../application/services/ProductApplicationService';
import type { ProductRecheckService } from '../../application/services/ProductRecheckService';
import type { ListingApplicationService } from '../../application/services/ListingApplicationService';
import type { HermesApplicationService } from '../../application/services/HermesApplicationService';
import type { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';
import {
  MarketplaceOAuthService,
  type MarketplaceAccountRecord,
  type OlxOAuthAppCredentials,
  type OlxOAuthTokens,
} from '../../application/services/MarketplaceOAuthService';
import type { OlxPublicationQuotaService } from '../../application/services/OlxPublicationQuotaService';
import type { CategoryCorrectionOperationService } from '../../application/services/CategoryCorrectionOperationService';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type { ProductView, HermesEventView } from '../../application/dto/presenters';
import { HERMES_EVENT_STATUSES, type MarketplaceCategoryMetadata } from '../../../shared/types';
import type { ListingStatus } from '../../domain/valueObjects/ListingStatus';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryListingResponseRunRepository,
} from '../../domain/testkit/support';
import { ListingResponseRuns } from '../../application/services/response/ListingResponseRuns';
import { InMemoryWorkspaceRepository } from '../../application/testkit/support';
import { InMemorySettingsRepository } from '../../infrastructure/persistence/repositories/InMemorySettingsRepository';
import { AIProviderSelector } from '../../infrastructure/external/AIProviderSelector';
import { HermesHealthProbe } from '../../infrastructure/external/HermesHealthProbe';
import { OfflineHeuristicAIProvider } from '../../infrastructure/external/OfflineHeuristicAIProvider';
import { HermesAI } from '../../infrastructure/external/HermesAI';
import { HermesCompletionClient } from '../../infrastructure/external/HermesCompletionClient';
import { StubOlxTaxonomyResolver } from '../../infrastructure/adapters/StubOlxTaxonomyResolver';

const iso = new Date().toISOString();

const productView: ProductView = {
  id: 'p1',
  workspaceId: 'ws-1',
  sku: 'S1',
  name: 'Widget',
  description: 'A widget',
  costPrice: 10,
  sellingPrice: 20,
  condition: 'good',
  category: 'misc',
  status: 'active',
  tags: [],
  images: [],
  createdAt: iso,
  updatedAt: iso,
};

const appliedEvent: HermesEventView = {
  id: 'applied',
  workspaceId: 'ws-1',
  type: 'suggested_lower_price',
  severity: 'info',
  status: 'applied',
  title: 'Applied change',
  proposedChange: null,
  createdAt: iso,
};

function stubProductService(): ProductApplicationService {
  return {
    async listProducts() {
      return Ok({ items: [productView], total: 1, page: 1, limit: 20, totalPages: 1 });
    },
    async getProduct(id: string) {
      return id === 'p1' ? productView : null;
    },
    async createProduct(dto: unknown) {
      return Ok({ ...productView, ...(dto as object) });
    },
    async updateProduct() {
      return Ok(productView);
    },
  } as unknown as ProductApplicationService;
}

function stubHermesService(): HermesApplicationService {
  return {
    async listEvents(query: { productId?: string }) {
      const items = query.productId
        ? query.productId === 'p1'
          ? [{ ...appliedEvent, productId: 'p1' }]
          : []
        : HERMES_EVENT_STATUSES.map((status) => ({
            ...appliedEvent,
            id: status,
            status,
          }));
      return { items, total: items.length, page: 1, limit: 20, totalPages: items.length ? 1 : 0 };
    },
    async getEvent(id: string) {
      return id === 'e1' ? appliedEvent : null;
    },
    async approveEvent({ eventId }: { eventId: string }) {
      if (eventId === 'pending') {
        return Ok({ ...appliedEvent, id: 'pending', status: 'applied' as const });
      }
      if (eventId === 'applied') {
        return Err(new InvalidStateError('Event is not pending review'));
      }
      return Err(new NotFoundError(`Hermes event not found: ${eventId}`));
    },
    async dismissEvent() {
      return Ok(appliedEvent);
    },
  } as unknown as HermesApplicationService;
}

function stubListingService(syncMarketplaceUseCase: SyncMarketplaceUseCase): ListingApplicationService {
  return {
    async listByWorkspace() {
      return { items: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    },
    async listByProduct() {
      return [];
    },
    async getListing() {
      return null;
    },
    async publishListing() {
      return Ok({});
    },
    async relistListing() {
      return Err(new InvalidStateError('Only expired or error listings may be relisted'));
    },
    async syncMarketplace(dto: SyncMarketplaceDTO) {
      return syncMarketplaceUseCase.execute(dto);
    },
  } as unknown as ListingApplicationService;
}

function stubAnalyticsService(): AnalyticsApplicationService {
  return {
    async getDashboardMetrics() {
      return { workspaceId: 'ws-1' };
    },
  } as unknown as AnalyticsApplicationService;
}

function stubMarketplaceOAuthService(): MarketplaceOAuthService {
  const status = {
    connected: true,
    marketplaceId: 'marketplace-olx',
    providerKey: 'olx' as const,
    account: {
      id: 'account-1',
      handle: 'OLX account',
      status: 'connected' as const,
      scopes: ['basic'],
    },
    tokenExpiresAt: '2026-07-14T13:00:00.000Z',
    refreshable: true,
  };
  return {
    async start() {
      return {
        authorizationUrl: 'https://www.olx.pl/oauth/authorize?state=oauth-state',
        state: 'oauth-state',
        expiresAt: '2026-07-14T12:10:00.000Z',
      };
    },
    async complete() {
      return status;
    },
    async check() {
      return status;
    },
    async getAppCredentialStatus() {
      return {
        configured: true,
        marketplaceId: 'marketplace-olx',
        providerKey: 'olx' as const,
      };
    },
    async disconnect() {},
  } as unknown as MarketplaceOAuthService;
}

// Real OAuth service in sandbox mode over in-memory collaborators. The OAuth client
// factory throws so any attempt to reach OLX fails the test.
function sandboxMarketplaceOAuthService(
  marketplaceRepo: InMemoryMarketplaceRepository,
  accounts = new Map<string, MarketplaceAccountRecord>()
): MarketplaceOAuthService {
  return new MarketplaceOAuthService({
    marketplaceRepo,
    accountRepo: {
      async findByMarketplaceId(marketplaceId) {
        return accounts.get(marketplaceId) ?? null;
      },
      async upsert(account) {
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
      async updateConnectedIfUnchanged() {
        return null;
      },
    },
    appCredentialRepo: {
      async findByMarketplaceId() {
        return null;
      },
      async upsert() {
        throw new Error('OLX application credentials are not used in sandbox mode');
      },
      async deleteByMarketplaceId() {},
    },
    stateStore: {
      async save() {},
      async consume() {
        return null;
      },
    },
    oauthClientFactory: () => {
      throw new Error('OLX OAuth client must not be built in sandbox mode');
    },
    credentialVault: {
      encrypt: (tokens: OlxOAuthTokens) => ({ payload: tokens }),
      decrypt: (envelope: Record<string, unknown>) => envelope.payload as OlxOAuthTokens,
      encryptAppCredentials: (credentials: OlxOAuthAppCredentials) => ({ appPayload: credentials }),
      decryptAppCredentials: (envelope: Record<string, unknown>) =>
        envelope.appPayload as OlxOAuthAppCredentials,
    },
    idGenerator: () => 'account-sandbox',
    stateGenerator: () => 'unused-oauth-state',
    sandbox: { enabled: true, successUrl: 'http://localhost:5173/marketplaces' },
  });
}

function stubOlxPublicationQuotaService(): OlxPublicationQuotaService {
  const quota = {
    id: 'quota-1',
    workspaceId: 'ws-1',
    marketplaceId: 'marketplace-olx',
    marketplaceAccountId: 'account-1',
    subcategoryId: '2000',
    cycleStartedAt: '2026-07-01T00:00:00.000Z',
    cycleEndsAt: '2026-08-01T00:00:00.000Z',
    publicationLimit: 2,
    consumed: 1,
    remaining: 1,
    source: 'operator' as const,
    confidence: 'verified' as const,
    verifiedAt: '2026-07-14T00:00:00.000Z',
    staleAt: '2026-07-20T00:00:00.000Z',
    isStale: false,
    status: 'available' as const,
  };
  return {
    async list() {
      return [quota];
    },
    async set(input) {
      return {
        ...quota,
        workspaceId: input.workspaceId,
        marketplaceId: input.marketplaceId,
        actorId: input.actorId,
      };
    },
    async preview() {
      return {
        applicable: true,
        marketplaceKey: 'olx' as const,
        marketplaceAccountId: 'account-1',
        subcategoryId: '2000',
        status: 'available' as const,
        decision: 'allow' as const,
        reason: 'free_unit_available',
        requiresOverride: false,
        quota,
      };
    },
  } as unknown as OlxPublicationQuotaService;
}

function stubUnknownOlxPublicationQuotaService(): OlxPublicationQuotaService {
  return {
    async preview() {
      return {
        applicable: true,
        marketplaceKey: 'olx' as const,
        marketplaceAccountId: 'account-1',
        subcategoryId: '2000',
        status: 'unknown' as const,
        decision: 'block' as const,
        reason: 'quota_unknown',
        requiresOverride: true,
      };
    },
  } as unknown as OlxPublicationQuotaService;
}

function stubCategoryCorrectionOperationService(): CategoryCorrectionOperationService {
  let current: any = {
    id: 'recreate-1',
    workspaceId: 'ws-1',
    recommendationEventId: 'e1',
    listingId: 'listing-1',
    marketplaceId: 'marketplace-olx',
    kind: 'recreate' as const,
    state: 'requested' as const,
    targetCategory: null,
    paidOverrideReason: null,
    requestedBy: null,
    approvedBy: null,
    result: null,
    requestedAt: new Date(),
    approvedAt: null,
    executedAt: null,
    failedAt: null,
    updatedAt: new Date(),
  };
  return {
    async requestStandaloneDelist(input: {
      operationId: string;
      listingId: string;
      workspaceId: string;
      actorId: string;
    }) {
      current = {
        ...current,
        id: input.operationId,
        listingId: input.listingId,
        workspaceId: input.workspaceId,
        recommendationEventId: null,
        kind: 'delist' as const,
        requestedBy: input.actorId,
      };
      return current;
    },
    async list(_eventId: string, workspaceId: string) {
      return [{ ...current, workspaceId }];
    },
    async approve(input: {
      operationId: string;
      workspaceId: string;
      actorId: string;
      paidOverrideReason?: string;
    }) {
      current = {
        ...current,
        id: input.operationId,
        workspaceId: input.workspaceId,
        state: 'approved' as const,
        approvedBy: input.actorId,
        paidOverrideReason: input.paidOverrideReason ?? null,
        approvedAt: new Date(),
      };
      return current;
    },
    async execute(input: { operationId: string; workspaceId: string }) {
      current = {
        ...current,
        id: input.operationId,
        workspaceId: input.workspaceId,
        state: 'executed' as const,
        result: { externalListingId: 'new-advert' },
        approvedAt: new Date(),
        executedAt: new Date(),
      };
      return current;
    },
  } as unknown as CategoryCorrectionOperationService;
}

// The production provider graph, configured the way CI runs it: no Hermes API key.
function unconfiguredHermesStatus(): NonNullable<AppDeps['hermesStatus']> {
  const config = {
    apiUrl: 'http://127.0.0.1:8642/v1',
    apiKey: '',
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
  return () => selector.status();
}

async function buildTestApp(
  options: {
    olxPublicationQuotaService?: OlxPublicationQuotaService;
    disableOlxPublicationQuotaService?: boolean;
    applicationVersion?: string;
    seedWorkspace?: boolean;
    categoryCorrectionOperationService?: CategoryCorrectionOperationService;
    productRecheckService?: ProductRecheckService;
    hermesService?: HermesApplicationService;
    saleVerdictRuns?: AppDeps['saleVerdictRuns'];
    listingResponseRuns?: boolean;
    olxTaxonomyResolver?: AppDeps['olxTaxonomyResolver'];
    marketplaceOAuthService?: (
      marketplaceRepo: InMemoryMarketplaceRepository
    ) => MarketplaceOAuthService;
    olxAdapterMode?: OlxAdapterMode;
    hermesStatus?: AppDeps['hermesStatus'];
    productAssistanceGraph?: AppDeps['productAssistanceGraph'];
    enableRateLimit?: boolean;
    aiRateLimit?: number;
    registrationEnabled?: boolean;
  } = {}
) {
  const authUserStore = new InMemoryAuthStore();
  let responseRunCount = 0;
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  const passwordHash = await bcrypt.hash('secret123', 4);
  authUserStore.users.push({
    id: 'u-1',
    email: 'demo@example.com',
    passwordHash,
    workspaceId: 'ws-1',
    tokenVersion: 0,
    createdAt: new Date(),
  });

  const deps: AppDeps = {
    productService: stubProductService(),
    productRecheckService: options.productRecheckService,
    listingService: stubListingService(
      new SyncMarketplaceUseCase(
        marketplaceRepo as IMarketplaceRepository,
        listingRepo as IListingRepository,
        new RecordingJobQueue<SyncMarketplaceJob>()
      )
    ),
    hermesService: options.hermesService ?? stubHermesService(),
    saleVerdictRuns: options.saleVerdictRuns,
    listingResponseRuns: options.listingResponseRuns
      ? new ListingResponseRuns({
          products: productRepo,
          listings: listingRepo,
          marketplaces: marketplaceRepo,
          runs: new InMemoryListingResponseRunRepository(),
          queue: new RecordingJobQueue<ListingResponseJob>(),
          newId: () => `resp-${++responseRunCount}`,
          now: () => new Date(),
        })
      : undefined,
    hermesStatus: options.hermesStatus,
    productAssistanceGraph: options.productAssistanceGraph,
    analyticsService: stubAnalyticsService(),
    productRepo: productRepo as IProductRepository,
    listingRepo: listingRepo as IListingRepository,
    marketplaceRepo: marketplaceRepo as IMarketplaceRepository,
    marketplaceOAuthService:
      options.marketplaceOAuthService?.(marketplaceRepo) ?? stubMarketplaceOAuthService(),
    marketplaceImportService: {} as unknown as MarketplaceImportService,
    marketplaceSyncScheduler: { reconcile: async () => ({ mode: 'manual', scheduled: false }) },
    olxPublicationQuotaService: options.disableOlxPublicationQuotaService
      ? undefined
      : (options.olxPublicationQuotaService ?? stubOlxPublicationQuotaService()),
    categoryCorrectionOperationService:
      options.categoryCorrectionOperationService ?? stubCategoryCorrectionOperationService(),
    olxTaxonomyResolver: options.olxTaxonomyResolver,
    marketplaceOAuthReturnUrl: 'http://localhost:5173/marketplaces',
    olxAdapterMode: options.olxAdapterMode ?? 'stub',
    workspaceRepo: workspaceRepo as IWorkspaceRepository,
    settingsRepo: new InMemorySettingsRepository(),
    authUserStore,
    idGenerator: () => 'listing-1',
  };

  const cost = Money.of(10, 'PLN');
  const price = Money.of(20, 'PLN');
  if (cost.isErr() || price.isErr()) throw new Error('money fixture failed');
  const product = Product.create({
    id: 'p-real',
    workspaceId: 'ws-1',
    sku: 'S-REAL',
    name: 'Real widget',
    description: 'A real widget for listing and publish preview tests',
    costPrice: cost.value,
    sellingPrice: price.value,
    condition: 'good',
    category: 'misc',
    status: 'active',
  });
  if (product.isErr()) throw product.error;
  await productRepo.save(product.value);
  const marketplace = Marketplace.create({
    id: 'marketplace-olx',
    workspaceId: 'ws-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
  });
  if (marketplace.isErr()) throw marketplace.error;
  await marketplaceRepo.save(marketplace.value);
  if (options.seedWorkspace) {
    const workspace = Workspace.create({ id: 'ws-1', name: 'Demo workspace' });
    if (workspace.isErr()) throw workspace.error;
    await workspaceRepo.save(workspace.value);
  }
  return {
    app: buildApp(deps, {
      enableRateLimit: options.enableRateLimit ?? false,
      applicationVersion: options.applicationVersion,
      aiRateLimit: options.aiRateLimit,
      registrationEnabled: options.registrationEnabled,
    }),
    authUserStore,
    marketplaceRepo,
    workspaceRepo,
    listingRepo,
    productRepo,
  };
}

async function seedPreviewListing(
  listingRepo: InMemoryListingRepository,
  category?: MarketplaceCategoryMetadata | null,
  status?: ListingStatus
): Promise<void> {
  const price = Money.of(20, 'PLN');
  if (price.isErr()) throw new Error('money fixture failed');
  const listing = Listing.create({
    id: 'listing-preview',
    productId: 'p-real',
    marketplaceId: 'marketplace-olx',
    price: price.value,
    status,
    marketplaceCategory:
      category === undefined
        ? {
            providerCategoryId: '2000',
            name: 'Widgets',
            path: ['Home', 'Tools', 'Widgets'],
            source: 'provider_taxonomy',
            confidence: 1,
            isLeaf: true,
            taxonomyVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
            taxonomyStaleAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
          }
        : category,
  });
  if (listing.isErr()) throw listing.error;
  await listingRepo.save(listing.value);
}

const token = signToken({ userId: 'u-1', workspaceId: 'ws-1', tokenVersion: 0 });
const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

describe('Presentation API', () => {
  describe('application information', () => {
    it('returns the running artifact version publicly without Git metadata', async () => {
      const { app } = await buildTestApp({ applicationVersion: 'v0.10.0' });

      const res = await request(app).get('/api/application-info');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { version: 'v0.10.0' } });
      expect(JSON.stringify(res.body)).not.toMatch(/commit|sha|branch|dirty/i);
    });

    it('returns an honest development fallback when release metadata is absent', async () => {
      const { app } = await buildTestApp();

      const res = await request(app).get('/api/application-info');

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe('Development');
    });
  });

  describe('auth', () => {
    it('logs in with valid credentials and returns a token', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: 'secret123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.user.workspaceId).toBe('ws-1');
    });

    it('rejects invalid credentials with a 401 error envelope', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an unknown email with the same 401 envelope (S6 constant-time path)', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      // Same uniform message as the wrong-password path (no user enumeration).
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('provisions a disconnected OLX marketplace pending OAuth on register', async () => {
      const { app, marketplaceRepo } = await buildTestApp();
      const res = await request(app).post('/api/auth/register').send({
        email: 'seller@example.com',
        password: 'secret123',
        workspaceName: 'Seller Workspace',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const workspaceId = res.body.data.user.workspaceId;
      expect(workspaceId).toBeDefined();

      const olx = await marketplaceRepo.findByKey(workspaceId, 'olx');
      expect(olx).not.toBeNull();
      expect(olx?.name).toBe('OLX');
      expect(olx?.isConnected()).toBe(false);
      expect(olx?.syncMode).toBe('manual');
    });

    it('register without workspaceName provisions a default workspace and OLX row', async () => {
      const { app, workspaceRepo } = await buildTestApp();

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'kamil@x.pl', password: 'secret123' });

      expect(res.status).toBe(201);
      const { token, user } = res.body.data;
      expect(user.workspaceId).toEqual(expect.any(String));
      expect(jwt.decode(token)).toMatchObject({ userId: user.id, workspaceId: user.workspaceId });
      const workspace = await workspaceRepo.findById(user.workspaceId);
      expect(workspace?.name).toBe("kamil's workspace");

      const marketplaces = await request(app)
        .get('/api/marketplaces')
        .set('Authorization', `Bearer ${token}`);
      expect(marketplaces.status).toBe(200);
      expect(marketplaces.body.data).toHaveLength(1);
      expect(marketplaces.body.data[0]).toMatchObject({
        workspaceId: user.workspaceId,
        key: 'olx',
        name: 'OLX',
        connected: false,
        syncMode: 'manual',
      });
    });

    it.each(['', '   ', null])(
      'register falls back to the default workspace name when workspaceName is %p',
      async (workspaceName) => {
        const { app, workspaceRepo } = await buildTestApp();

        const res = await request(app)
          .post('/api/auth/register')
          .send({ email: 'blank@example.com', password: 'secret123', workspaceName });

        expect(res.status).toBe(201);
        const { token, user } = res.body.data;
        const workspace = await workspaceRepo.findById(user.workspaceId);
        expect(workspace?.name).toBe("blank's workspace");

        const marketplaces = await request(app)
          .get('/api/marketplaces')
          .set('Authorization', `Bearer ${token}`);
        expect(marketplaces.status).toBe(200);
        expect(marketplaces.body.data).toEqual([
          expect.objectContaining({ workspaceId: user.workspaceId, key: 'olx' }),
        ]);
      }
    );

    it('register accepts a 120-character workspaceName and rejects 121 characters', async () => {
      const { app } = await buildTestApp();

      const atLimit = await request(app)
        .post('/api/auth/register')
        .send({ email: 'limit@example.com', password: 'secret123', workspaceName: 'w'.repeat(120) });
      const overLimit = await request(app)
        .post('/api/auth/register')
        .send({ email: 'over@example.com', password: 'secret123', workspaceName: 'w'.repeat(121) });

      expect(atLimit.status).toBe(201);
      expect(overLimit.status).toBe(400);
      expect(overLimit.body.error.code).toBe('VALIDATION_ERROR');
      expect(overLimit.body.error.details).toEqual([
        expect.objectContaining({ field: 'workspaceName' }),
      ]);
    });

    it('register maps a concurrent duplicate email (pg 23505) to 409 and removes the provisioned workspace', async () => {
      const { app, authUserStore, marketplaceRepo, workspaceRepo } = await buildTestApp();
      // The findByEmail pre-check passed; the INSERT then loses the race to users.email UNIQUE.
      authUserStore.create = jest.fn(async () => {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "users_email_key"'),
          {
            code: '23505',
            constraint: 'users_email_key',
            detail: 'Key (email)=(race@example.com) already exists.',
          }
        );
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'race@example.com', password: 'secret123' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(JSON.stringify(res.body)).not.toMatch(/duplicate key|users_email_key|Key \(email\)/);
      expect(await workspaceRepo.findAll()).toHaveLength(0);
      expect(marketplaceRepo.items.size).toBe(1);
    });

    it('cleans up provisioned workspace and marketplace if user creation fails', async () => {
      const { app, authUserStore, marketplaceRepo, workspaceRepo } = await buildTestApp();
      authUserStore.create = jest.fn(async () => {
        throw new Error('user create failed');
      });

      const res = await request(app).post('/api/auth/register').send({
        email: 'seller-fail@example.com',
        password: 'secret123',
        workspaceName: 'Failing Seller Workspace',
      });

      expect(res.status).toBe(500);
      expect(await workspaceRepo.findAll()).toHaveLength(0);
      expect(marketplaceRepo.items.size).toBe(1);
    });

    // Regression guard: the /me limiter used to run before authentication and key by IP, so
    // everyone behind one proxy shared one 15-minute allowance, and the 429 that followed logged
    // users out. The public per-IP flood guard (100/min) still fronts the whole /auth prefix
    // (routes/index.ts), but the per-user allowance is spent only after authentication.
    describe('GET /me', () => {
      const bearer = (userId: string) => `Bearer ${signToken({ userId, workspaceId: 'ws-1', tokenVersion: 0 })}`;
      const me = (app: express.Express, authorization?: string) => {
        const req = request(app).get('/api/auth/me');
        return authorization ? req.set('Authorization', authorization) : req;
      };

      it('returns the current user for a valid token', async () => {
        const { app } = await buildTestApp();

        const res = await me(app, bearer('u-1'));

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          success: true,
          data: { id: 'u-1', email: 'demo@example.com', workspaceId: 'ws-1' },
        });
      });

      it('gives each user their own rate limit allowance, even from one IP', async () => {
        const { app, authUserStore } = await buildTestApp({ enableRateLimit: true });
        authUserStore.users.push({
          id: 'u-2',
          email: 'second@example.com',
          passwordHash: 'unused',
          workspaceId: 'ws-1',
          tokenVersion: 0,
          createdAt: new Date(),
        });

        const firstOfA = await me(app, bearer('u-1'));
        const secondOfA = await me(app, bearer('u-1'));
        const firstOfB = await me(app, bearer('u-2'));

        // The per-user limiter answers last, so its headers are the ones on the response.
        expect(firstOfB.headers['ratelimit-policy']).toBe('100;w=900');
        expect(firstOfA.headers['ratelimit-remaining']).toBe('99');
        expect(secondOfA.headers['ratelimit-remaining']).toBe('98');
        expect(firstOfB.headers['ratelimit-remaining']).toBe('99');
      });

      it('guards the /auth prefix per IP first and spends the per-user allowance only after authentication', async () => {
        const { app } = await buildTestApp({ enableRateLimit: true });

        const missing = await me(app);
        const forged = await me(app, 'Bearer not-a-jwt');
        const login = await request(app)
          .post('/api/auth/login')
          .send({ email: 'demo@example.com', password: 'wrong' });
        const valid = await me(app, bearer('u-1'));

        expect(missing.status).toBe(401);
        expect(forged.status).toBe(401);
        expect(login.status).toBe(401);
        // One public bucket (100/min per IP) sits in front of every /auth route, token check
        // included...
        expect(missing.headers['ratelimit-policy']).toBe('100;w=60');
        expect(missing.headers['ratelimit-remaining']).toBe('99');
        expect(forged.headers['ratelimit-remaining']).toBe('98');
        expect(login.headers['ratelimit-policy']).toBe('100;w=60');
        expect(login.headers['ratelimit-remaining']).toBe('97');
        // ...and the per-user allowance (100/15 min) is spent only by authenticated requests.
        expect(valid.headers['ratelimit-policy']).toBe('100;w=900');
        expect(valid.headers['ratelimit-remaining']).toBe('99');
      });

      it('answers a user over the allowance with a 429 envelope and leaves other users alone', async () => {
        const controller = {
          me: async (req: express.Request, res: express.Response) => {
            res.json({ userId: req.user?.userId });
          },
        } as unknown as AuthController;
        const userStore = new InMemoryAuthStore();
        for (const id of ['u-1', 'u-2']) {
          userStore.users.push({
            id,
            email: `${id}@example.com`,
            passwordHash: 'unused',
            workspaceId: 'ws-1',
            tokenVersion: 0,
            createdAt: new Date(),
          });
        }
        const app = express();
        app.use('/api/auth', createAuthRoutes(controller, meRateLimiter(2), {
          currentUserStore: userStore,
        }));

        const first = await me(app, bearer('u-1'));
        const second = await me(app, bearer('u-1'));
        const rejected = await me(app, bearer('u-1'));
        const other = await me(app, bearer('u-2'));

        expect([first.status, second.status]).toEqual([200, 200]);
        expect(rejected.status).toBe(429);
        expect(rejected.body).toEqual({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' },
        });
        expect(other.status).toBe(200);
      });
    });

    describe('audit hardening (regression guards)', () => {
      it('does not echo the e-mail back when it is already registered', async () => {
        const { app } = await buildTestApp();

        const res = await request(app)
          .post('/api/auth/register')
          .send({ email: 'demo@example.com', password: 'secret123', workspaceName: 'Again' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
        expect(res.body.error.message).toBe(
          'An account with this e-mail already exists. Sign in instead.'
        );
        expect(JSON.stringify(res.body)).not.toContain('demo@example.com');
      });

      // A valid-shaped address (64-character local part, 63-character labels) of a given length,
      // so only the length cap decides.
      const emailOfLength = (length: number) =>
        `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(length - 197)}.com`;

      it.each(['/api/auth/login', '/api/auth/register'])(
        'rejects an e-mail longer than 254 characters on %s',
        async (path) => {
          const { app } = await buildTestApp();
          const email = emailOfLength(255);

          const res = await request(app)
            .post(path)
            .send({ email, password: 'secret123', workspaceName: 'Long' });

          expect(email).toHaveLength(255);
          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe('VALIDATION_ERROR');
        }
      );

      it('still accepts a 254-character e-mail at sign-in', async () => {
        const { app } = await buildTestApp();
        const email = emailOfLength(254);

        const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong' });

        expect(email).toHaveLength(254);
        expect(res.status).toBe(401);
      });

      it('refuses registration with 403 when it is switched off', async () => {
        const { app, authUserStore } = await buildTestApp({ registrationEnabled: false });

        const res = await request(app)
          .post('/api/auth/register')
          .send({ email: 'new@example.com', password: 'secret123', workspaceName: 'New' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(authUserStore.users.map((user) => user.email)).toEqual(['demo@example.com']);
      });

      it('limits failed logins per account on the mounted API', async () => {
        const { app } = await buildTestApp({ enableRateLimit: true });
        const statuses: number[] = [];
        for (let i = 0; i < 11; i += 1) {
          const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'demo@example.com', password: 'wrong' });
          statuses.push(res.status);
        }

        expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
        expect(statuses[10]).toBe(429);
      });

      it('applies the configured AI limit per workspace on the mounted API', async () => {
        const { app } = await buildTestApp({ enableRateLimit: true, aiRateLimit: 1 });
        const token = `Bearer ${signToken({ userId: 'u-1', workspaceId: 'ws-1', tokenVersion: 0 })}`;
        const draft = () =>
          request(app)
            .post('/api/products/ai-draft')
            .set('Authorization', token)
            .send({ imageUrls: ['/uploads/a.jpg'] });

        const first = await draft();
        const second = await draft();

        expect(first.status).not.toBe(429);
        expect(second.status).toBe(429);
      });
    });
  });

  describe('token revocation', () => {
    const legacyToken = () => jwt.sign({ userId: 'u-1', workspaceId: 'ws-1' }, env.jwt.secret);
    const bearerOf = (t: string) => ({ Authorization: `Bearer ${t}` });

    it('accepts a token issued before token versions existed while the user is at version 0', async () => {
      const { app } = await buildTestApp();

      const products = await request(app).get('/api/products').set(bearerOf(legacyToken()));
      const me = await request(app).get('/api/auth/me').set(bearerOf(legacyToken()));

      expect(products.status).toBe(200);
      expect(me.status).toBe(200);
    });

    it('refuses every token of a user after the version is bumped', async () => {
      const { app, authUserStore } = await buildTestApp();
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: 'secret123' });
      const issued = login.body.data.token as string;

      await authUserStore.bumpTokenVersion('u-1');

      for (const t of [issued, legacyToken()]) {
        const products = await request(app).get('/api/products').set(bearerOf(t));
        const me = await request(app).get('/api/auth/me').set(bearerOf(t));
        for (const res of [products, me]) {
          expect(res.status).toBe(401);
          expect(res.body.error).toEqual({
            code: 'UNAUTHORIZED',
            message: 'Session has been revoked',
          });
        }
      }
    });

    it.each([['"0"', '0'], ['-1', -1], ['0.5', 0.5], ['null', null]])(
      'refuses a token whose version claim is malformed (%s)',
      async (_label, tv) => {
        const { app } = await buildTestApp();
        const bad = jwt.sign({ userId: 'u-1', workspaceId: 'ws-1', tv }, env.jwt.secret);

        for (const path of ['/api/products', '/api/auth/me']) {
          const res = await request(app).get(path).set(bearerOf(bad));
          expect(res.status).toBe(401);
          expect(res.body.error.message).toBe('Invalid token payload');
        }
      }
    );

    it('issues tokens that carry the current version', async () => {
      const { app, authUserStore } = await buildTestApp();
      await authUserStore.bumpTokenVersion('u-1');

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: 'secret123' });
      const issued = login.body.data.token as string;

      expect(jwt.decode(issued)).toMatchObject({ tv: 1 });
      const me = await request(app).get('/api/auth/me').set(bearerOf(issued));
      expect(me.status).toBe(200);
    });
  });

  describe('sign out', () => {
    const bearerOf = (t: string) => ({ Authorization: `Bearer ${t}` });
    const loginToken = async (app: Parameters<typeof request>[0]) => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: 'secret123' });
      return login.body.data.token as string;
    };

    it('signs out every device', async () => {
      const { app } = await buildTestApp();
      const a = await loginToken(app);
      const b = await loginToken(app);

      const out = await request(app).post('/api/auth/logout').set(bearerOf(a));

      expect(out.status).toBe(204);
      expect(out.text).toBe('');
      for (const t of [a, b]) {
        const res = await request(app).get('/api/products').set(bearerOf(t));
        expect(res.status).toBe(401);
        expect(res.body.error.message).toBe('Session has been revoked');
      }
      expect((await request(app).get('/api/products').set(bearerOf(await loginToken(app)))).status).toBe(200);
    });

    it('refuses sign-out with a revoked token', async () => {
      const { app, authUserStore } = await buildTestApp();
      const a = await loginToken(app);
      await authUserStore.bumpTokenVersion('u-1');

      const out = await request(app).post('/api/auth/logout').set(bearerOf(a));

      expect(out.status).toBe(401);
    });

    it('signs out with an old token without handing out a renewed one', async () => {
      const { app } = await buildTestApp();
      const old = jwt.sign(
        { userId: 'u-1', workspaceId: 'ws-1', tv: 0, iat: Math.floor(Date.now() / 1000) - 13 * 3600 },
        env.jwt.secret,
        { expiresIn: '24h' },
      );

      const out = await request(app).post('/api/auth/logout').set(bearerOf(old));

      expect(out.status).toBe(204);
      expect(out.headers['x-renewed-token']).toBeUndefined();
    });
  });

  describe('change password', () => {
    const bearerOf = (t: string) => ({ Authorization: `Bearer ${t}` });
    const current = 'secret123';
    const changed = `${current}-changed`;
    const loginToken = async (app: Parameters<typeof request>[0], password = current) => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password });
      return login.body.data.token as string;
    };
    const change = (
      app: Parameters<typeof request>[0],
      token: string,
      body: { currentPassword: string; newPassword: string }
    ) => request(app).post('/api/auth/password').set(bearerOf(token)).send(body);

    it('changes the password, keeps this device and signs out the others', async () => {
      const { app } = await buildTestApp();
      const a = await loginToken(app);
      const b = await loginToken(app);

      const res = await change(app, a, { currentPassword: current, newPassword: changed });

      expect(res.status).toBe(200);
      const c = res.body.data.token as string;
      for (const t of [a, b]) {
        expect((await request(app).get('/api/products').set(bearerOf(t))).status).toBe(401);
      }
      expect((await request(app).get('/api/products').set(bearerOf(c))).status).toBe(200);
      const oldLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: current });
      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: changed });
      expect(oldLogin.status).toBe(401);
      expect(newLogin.status).toBe(200);
    });

    it('answers an old token without a renewed one next to the returned token', async () => {
      const { app } = await buildTestApp();
      const old = jwt.sign(
        { userId: 'u-1', workspaceId: 'ws-1', tv: 0, iat: Math.floor(Date.now() / 1000) - 13 * 3600 },
        env.jwt.secret,
        { expiresIn: '24h' }
      );

      const res = await change(app, old, { currentPassword: current, newPassword: changed });

      expect(res.status).toBe(200);
      expect(typeof res.body.data.token).toBe('string');
      expect(res.headers['x-renewed-token']).toBeUndefined();
    });

    it('refuses a wrong current password without revoking anything', async () => {
      const { app } = await buildTestApp();
      const a = await loginToken(app);

      const res = await change(app, a, { currentPassword: `${current}-wrong`, newPassword: changed });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Current password is incorrect');
      expect((await request(app).get('/api/products').set(bearerOf(a))).status).toBe(200);
    });

    it('refuses the change when the session was revoked after it was checked', async () => {
      const { app, authUserStore } = await buildTestApp();
      const a = await loginToken(app);
      const original = authUserStore.updatePassword.bind(authUserStore);
      authUserStore.updatePassword = jest.fn(async (userId, hash, expectedVersion) => {
        await authUserStore.bumpTokenVersion(userId);
        return original(userId, hash, expectedVersion);
      });

      const res = await change(app, a, { currentPassword: current, newPassword: changed });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Session has been revoked');
      expect(authUserStore.users[0].passwordHash).not.toBe(changed);
    });

    it('validates the new password', async () => {
      const { app } = await buildTestApp();
      const a = await loginToken(app);

      const short = await change(app, a, { currentPassword: current, newPassword: 'a'.repeat(7) });
      const same = await change(app, a, { currentPassword: current, newPassword: current });

      for (const res of [short, same]) {
        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'newPassword' })]);
      }
    });

    it('limits failed password changes per user', async () => {
      const { app } = await buildTestApp({ enableRateLimit: true });
      const a = await loginToken(app);
      const wrong = { currentPassword: `${current}-wrong`, newPassword: changed };

      for (let i = 0; i < 5; i += 1) {
        expect((await change(app, a, wrong)).status).toBe(401);
      }
      const blocked = await change(app, a, wrong);

      expect(blocked.status).toBe(429);
    });

    it('does not count a successful change against the allowance', async () => {
      const { app } = await buildTestApp({ enableRateLimit: true });
      const a = await loginToken(app);
      const ok = await change(app, a, { currentPassword: current, newPassword: changed });
      const c = ok.body.data.token as string;

      for (let i = 0; i < 5; i += 1) {
        const res = await change(app, c, { currentPassword: current, newPassword: `${changed}-2` });
        expect(res.status).toBe(401);
      }
    });
  });

  describe('token renewal', () => {
    const tokenAged = (hours: number, tv = 0) =>
      jwt.sign(
        { userId: 'u-1', workspaceId: 'ws-1', tv, iat: Math.floor(Date.now() / 1000) - hours * 3600 },
        env.jwt.secret,
        { expiresIn: '24h' },
      );
    const bearerOf = (t: string) => ({ Authorization: `Bearer ${t}` });

    it.each(['/api/products', '/api/auth/me'])(
      'hands an active session on %s a fresh token once the old one is past the renewal age',
      async (path) => {
        const { app, authUserStore } = await buildTestApp();
        await authUserStore.bumpTokenVersion('u-1');

        const res = await request(app).get(path).set(bearerOf(tokenAged(13, 1)));

        expect(res.status).toBe(200);
        const renewed = res.headers['x-renewed-token'];
        expect(jwt.decode(renewed)).toMatchObject({ userId: 'u-1', workspaceId: 'ws-1', tv: 1 });
        const followUp = await request(app).get(path).set(bearerOf(renewed));
        expect(followUp.status).toBe(200);
        expect(followUp.headers['x-renewed-token']).toBeUndefined();
      },
    );

    it.each(['/api/products', '/api/auth/me'])('keeps a young token on %s as it is', async (path) => {
      const { app } = await buildTestApp();

      const res = await request(app).get(path).set(bearerOf(tokenAged(1)));

      expect(res.status).toBe(200);
      expect(res.headers['x-renewed-token']).toBeUndefined();
    });

    // Regression guard: renewal used to sign the user's current workspace into the new token,
    // so a token for a workspace the user had left was swapped for one of the new workspace.
    it.each([['/api/products', 403], ['/api/auth/me', 200]])(
      'never renews a token whose workspace no longer matches on %s',
      async (path, status) => {
        const { app, authUserStore } = await buildTestApp();
        authUserStore.users.find((u) => u.id === 'u-1')!.workspaceId = 'ws-2';

        const res = await request(app).get(path).set(bearerOf(tokenAged(13)));

        expect(res.status).toBe(status);
        expect(res.headers['x-renewed-token']).toBeUndefined();
      },
    );

    it('rejects a token without a usable issue time instead of renewing it on every request', async () => {
      const { app } = await buildTestApp();
      const noIat = jwt.sign({ userId: 'u-1', workspaceId: 'ws-1', tv: 0 }, env.jwt.secret, {
        noTimestamp: true,
      });
      // jsonwebtoken refuses to sign a non-numeric iat, so the token is assembled by hand.
      const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({
        userId: 'u-1',
        workspaceId: 'ws-1',
        tv: 0,
        iat: 'yesterday',
      })}`;
      const badIat = `${unsigned}.${createHmac('sha256', env.jwt.secret).update(unsigned).digest('base64url')}`;

      const withoutIat = await request(app).get('/api/products').set(bearerOf(noIat));
      const withBadIat = await request(app).get('/api/products').set(bearerOf(badIat));

      expect(withoutIat.status).toBe(200);
      expect(withoutIat.headers['x-renewed-token']).toBeUndefined();
      expect(withBadIat.status).toBe(401);
      expect(withBadIat.body.error.message).toBe('Invalid token payload');
    });

    it.each(['/api/products', '/api/auth/me'])('never renews a revoked token on %s', async (path) => {
      const { app, authUserStore } = await buildTestApp();
      await authUserStore.bumpTokenVersion('u-1');

      const res = await request(app).get(path).set(bearerOf(tokenAged(13, 0)));

      expect(res.status).toBe(401);
      expect(res.headers['x-renewed-token']).toBeUndefined();
    });
  });

  describe('products', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = await buildTestApp();
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('authenticates and binds recheck to the requested product, listing and workspace', async () => {
      const result = {
        productId: 'p-real', listingId: 'listing-preview', marketplaceId: 'marketplace-olx',
        workspaceId: 'ws-1', productUpdatedAt: iso, listingUpdatedAt: iso, accountRevision: 7,
        checkedAt: iso, status: 'ready', canPublish: true, autoApplied: false, items: [],
        category: {
          providerCategoryId: '2000', path: ['Home', 'Tools', 'Widgets'], confidence: 1,
          isLeaf: true, taxonomyVerifiedAt: iso, taxonomyStaleAt: iso,
          reason: null, suggestion: null, confirmationRequired: false,
        },
      } as const;
      const recheck = jest.fn(async () => result);
      const { app } = await buildTestApp({ productRecheckService: { recheck } as unknown as ProductRecheckService });

      const unauthenticated = await request(app)
        .post('/api/products/p-real/recheck')
        .send({ listingId: 'listing-preview' });
      expect(unauthenticated.status).toBe(401);
      expect(recheck).not.toHaveBeenCalled();

      const invalid = await auth(request(app).post('/api/products/p-real/recheck')).send({});
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
      expect(recheck).not.toHaveBeenCalled();

      const response = await auth(request(app).post('/api/products/p-real/recheck'))
        .send({ listingId: 'listing-preview' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: result });
      expect(recheck).toHaveBeenCalledWith({
        productId: 'p-real', listingId: 'listing-preview', workspaceId: 'ws-1', actorId: 'u-1',
      });
    });

    it('returns the §18 paginated envelope on list', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/products'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('returns a VALIDATION_ERROR envelope with field details on invalid create', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products')).send({
        name: 'x',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBeGreaterThan(0);
      expect(res.body.error.details[0]).toHaveProperty('field');
      expect(res.body.error.details[0]).toHaveProperty('message');
    });

    it('creates a product and returns 201 with the success envelope', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products')).send({
        sku: 'S1',
        name: 'Widget',
        description: 'A nice widget for testing',
        costPrice: 10,
        sellingPrice: 20,
        condition: 'good',
        category: 'misc',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
    });

    it('create accepts costPrice null for a product whose cost is unknown', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products')).send({
        sku: 'UNKNOWN-COST-1',
        name: 'Widget with unknown cost',
        description: 'A widget whose purchase cost is not known yet',
        costPrice: null,
        sellingPrice: 20,
        condition: 'good',
        category: 'misc',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.costPrice).toBeNull();
    });

    it('requires explicit API confirmation before creating below-cost pricing', async () => {
      const { app } = await buildTestApp();
      const body = {
        sku: 'BELOW-1',
        name: 'Below-cost widget',
        description: 'A deliberately discounted widget for boundary testing',
        costPrice: 20,
        sellingPrice: 10,
        condition: 'good',
        category: 'misc',
      };

      const rejected = await auth(request(app).post('/api/products')).send(body);
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
      expect(rejected.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'allowBelowCost',
            message: expect.stringContaining('must be true'),
          }),
        ])
      );

      const accepted = await auth(request(app).post('/api/products')).send({
        ...body,
        allowBelowCost: true,
      });
      expect(accepted.status).toBe(201);
      expect(accepted.body.data.sellingPrice).toBe(10);
    });

    it('generates a review-only AI product draft from a title', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/ai-draft')).send({
        mode: 'title',
        title: 'Vintage Canon camera',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe('title');
      expect(res.body.data).toMatchObject({ source: 'offline', confidence: null });
      expect(res.body.data.fields.name).toBe('Vintage Canon camera');
      expect(res.body.data.fields.status).toBe('draft');
      expect(res.body.data.uncertainFields).toContain('sellingPrice');
      expect(res.body.data.notes.join(' ')).toContain('normal confirmation flow');
    });

    it('validates empty photo-first AI product draft requests', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/ai-draft')).send({
        mode: 'photos',
        imageUrls: [],
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('falls back to existing product images for photo-first AI draft requests', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/ai-draft')).send({
        mode: 'photos',
        imageUrls: [],
        existingFields: {
          name: 'Vintage camera',
          images: ['https://example.test/camera.jpg'],
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fields.images).toEqual(['https://example.test/camera.jpg']);
    });

    it('creates a draft OLX listing for a product', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('listing-1');
      expect(res.body.data.productId).toBe('p-real');
      expect(res.body.data.marketplaceId).toBe('marketplace-olx');
      expect(res.body.data.price).toBe(20);
      expect(res.body.data.status).toBe('draft');
    });

    it('rejects duplicate listing creation for the same marketplace', async () => {
      const { app } = await buildTestApp();
      await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });
      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rejects draft listing creation for a disconnected marketplace', async () => {
      const { app, marketplaceRepo } = await buildTestApp();
      const marketplace = await marketplaceRepo.findByKey('ws-1', 'olx');
      marketplace?.disconnect();

      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('maps concurrent duplicate listing persistence to a conflict response', async () => {
      const { app, listingRepo } = await buildTestApp();
      jest.spyOn(listingRepo, 'save').mockRejectedValueOnce({
        code: '23505',
        constraint: 'unique_listing',
      });

      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('marketplace OAuth', () => {
    it('starts OLX OAuth from an authenticated workspace without marking local success', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/marketplaces/marketplace-olx/connect')).send(
        {}
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.authorizationUrl).toContain('https://www.olx.pl/oauth/authorize');
      expect(res.body.data.state).toBe('oauth-state');
    });

    it('refuses to connect a marketplace other than OLX', async () => {
      const { app, marketplaceRepo } = await buildTestApp();
      const allegro = Marketplace.create({
        id: 'marketplace-allegro',
        workspaceId: 'ws-1',
        key: 'allegro',
        name: 'Allegro',
        connected: false,
        syncMode: 'manual',
      });
      if (allegro.isErr()) throw allegro.error;
      await marketplaceRepo.save(allegro.value);

      const res = await auth(request(app).patch('/api/marketplaces/marketplace-allegro')).send({
        connected: true,
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_STATE');
      expect(res.body.error.message).toBe('Only OLX can be connected');
      expect((await marketplaceRepo.findById('marketplace-allegro'))?.isConnected()).toBe(false);
    });

    it('refuses to sync a marketplace other than OLX', async () => {
      const { app, marketplaceRepo } = await buildTestApp();
      const allegro = Marketplace.create({
        id: 'marketplace-allegro',
        workspaceId: 'ws-1',
        key: 'allegro',
        name: 'Allegro',
        connected: true,
        syncMode: 'manual',
      });
      if (allegro.isErr()) throw allegro.error;
      await marketplaceRepo.save(allegro.value);

      const res = await auth(request(app).post('/api/marketplaces/marketplace-allegro/sync')).send({});

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_STATE');
      expect(res.body.error.message).toBe('Only OLX can be synced');
    });

    it('accepts the provider callback without a bearer token and returns the API envelope', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .get('/api/marketplaces/olx/oauth/callback')
        .query({ code: 'authorization-code', state: 'oauth-state', response: 'json' })
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.account.status).toBe('connected');
    });

    it('returns app-authoritative OLX account status from the protected check endpoint', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/marketplaces/marketplace-olx/check'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.connected).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('access-token');
      expect(JSON.stringify(res.body)).not.toContain('refresh-token');
    });

    it('POST /api/marketplaces/:id/connect in stub mode marks OLX connected and GET /api/marketplaces reports sandbox:true', async () => {
      const { app, marketplaceRepo } = await buildTestApp({
        marketplaceOAuthService: sandboxMarketplaceOAuthService,
      });
      (await marketplaceRepo.findByKey('ws-1', 'olx'))?.disconnect();

      const connect = await auth(
        request(app).post('/api/marketplaces/marketplace-olx/connect')
      ).send({});

      expect(connect.status).toBe(200);
      expect(connect.body.data).toMatchObject({
        authorizationUrl:
          'http://localhost:5173/marketplaces?oauth=success&marketplaceId=marketplace-olx&sandbox=1',
        state: 'sandbox',
        sandbox: true,
      });
      const list = await auth(request(app).get('/api/marketplaces'));
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({
          id: 'marketplace-olx',
          key: 'olx',
          connected: true,
          sandbox: true,
        }),
      ]);
      const detail = await auth(request(app).get('/api/marketplaces/marketplace-olx'));
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ connected: true, sandbox: true });
      const check = await auth(request(app).get('/api/marketplaces/marketplace-olx/check'));
      expect(check.status).toBe(200);
      expect(check.body.data).toMatchObject({
        connected: true,
        sandbox: true,
        account: { handle: 'OLX sandbox account', status: 'connected' },
      });
    });

    // One rule on every page: an OLX row counts as connected only with an account in status
    // connected whose credentials can be read.
    it.each([
      { state: 'no stored account', account: undefined },
      { state: 'an account in status error', account: { status: 'error' as const } },
      {
        state: 'credentials that cannot be read',
        account: { status: 'connected' as const, credentials: { payload: null } },
      },
    ])('reports a connected OLX row with $state as not connected on every page', async ({ account }) => {
      const accounts = new Map<string, MarketplaceAccountRecord>();
      if (account) {
        accounts.set('marketplace-olx', {
          id: 'account-1',
          marketplaceId: 'marketplace-olx',
          handle: 'OLX account',
          credentials: {},
          scopes: ['v2'],
          revision: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...account,
        });
      }
      const { app } = await buildTestApp({
        seedWorkspace: true,
        marketplaceOAuthService: (marketplaceRepo) =>
          sandboxMarketplaceOAuthService(marketplaceRepo, accounts),
      });

      const list = await auth(request(app).get('/api/marketplaces'));
      const detail = await auth(request(app).get('/api/marketplaces/marketplace-olx'));
      const settings = await auth(request(app).get('/api/settings/integrations'));

      expect(list.body.data).toEqual([
        expect.objectContaining({ id: 'marketplace-olx', connected: false }),
      ]);
      expect(detail.body.data).toMatchObject({ id: 'marketplace-olx', connected: false });
      expect(settings.body.data.items).toContainEqual(
        expect.objectContaining({ id: 'marketplace-olx', connected: false })
      );
    });

    it('GET /api/marketplaces reports sandbox:false when the OLX adapter runs in real mode', async () => {
      const { app } = await buildTestApp({ olxAdapterMode: 'real' });

      const list = await auth(request(app).get('/api/marketplaces'));

      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ key: 'olx', connected: true, sandbox: false }),
      ]);
    });

    it('reads and validates authenticated OLX quota operator contracts', async () => {
      const { app } = await buildTestApp();
      const read = await auth(request(app).get('/api/marketplaces/marketplace-olx/quotas'));
      const update = await auth(request(app).put('/api/marketplaces/marketplace-olx/quotas')).send({
        workspaceId: 'ws-attacker',
        marketplaceId: 'marketplace-attacker',
        actorId: 'user-attacker',
        subcategoryId: '2000',
        cycleStartedAt: '2026-07-01T00:00:00.000Z',
        cycleEndsAt: '2026-08-01T00:00:00.000Z',
        publicationLimit: 2,
        consumed: 1,
        source: 'operator',
        confidence: 'verified',
        verifiedAt: '2026-07-14T00:00:00.000Z',
        staleAt: '2026-07-20T00:00:00.000Z',
      });

      expect(read.status).toBe(200);
      expect(read.body.data[0]).toMatchObject({ subcategoryId: '2000', remaining: 1 });
      expect(update.status).toBe(200);
      expect(update.body.data).toMatchObject({
        publicationLimit: 2,
        consumed: 1,
        source: 'operator',
        confidence: 'verified',
        workspaceId: 'ws-1',
        marketplaceId: 'marketplace-olx',
        actorId: 'u-1',
      });
    });
  });

  describe('listings', () => {
    it('searches scoped OLX leaf categories without changing the listing', async () => {
      const search = jest.fn(async () => [
        { providerCategoryId: '2000', name: 'Widgets', path: ['Home', 'Tools', 'Widgets'] },
      ]);
      const { app, listingRepo } = await buildTestApp({
        olxTaxonomyResolver: async () => ({
          verify: async () => { throw new Error('not used'); },
          search,
        }),
      });
      await seedPreviewListing(listingRepo);
      const res = await auth(request(app).get('/api/listings/listing-preview/marketplace-categories?query=widgets'));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { providerCategoryId: '2000', name: 'Widgets', path: ['Home', 'Tools', 'Widgets'] },
      ]);
      expect(search).toHaveBeenCalledWith('widgets');
      expect((await listingRepo.findById('listing-preview'))?.status).toBe('draft');
    });

    it('reports a temporary OLX category search failure as service unavailable', async () => {
      const { app, listingRepo } = await buildTestApp({
        olxTaxonomyResolver: async () => ({
          verify: async () => { throw new Error('not used'); },
          search: async () => { throw new Error('OLX API unavailable'); },
        }),
      });
      await seedPreviewListing(listingRepo);
      const res = await auth(request(app).get('/api/listings/listing-preview/marketplace-categories?query=widgets'));
      expect(res.status).toBe(503);
      expect(res.body.error.message).toBe('OLX category search is temporarily unavailable');
    });

    it('searches and records a sandbox OLX category through the listing endpoints in stub mode', async () => {
      const { app, listingRepo } = await buildTestApp({
        olxTaxonomyResolver: async () => new StubOlxTaxonomyResolver(),
      });
      await seedPreviewListing(listingRepo, null);

      const search = await auth(
        request(app).get('/api/listings/listing-preview/marketplace-categories?query=cam')
      );
      const recorded = await auth(
        request(app).put('/api/listings/listing-preview/marketplace-category')
      ).send({ providerCategoryId: '1001' });
      const preview = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(search.status).toBe(200);
      expect(search.body.data).toEqual([
        { providerCategoryId: '1001', name: 'Cameras', path: ['Electronics', 'Cameras'] },
      ]);
      expect(recorded.status).toBe(200);
      expect(recorded.body.data.marketplaceCategory).toMatchObject({
        providerCategoryId: '1001',
        name: 'Cameras',
        path: ['Electronics', 'Cameras'],
        source: 'provider_taxonomy',
        isLeaf: true,
        sandbox: true,
      });
      expect(preview.status).toBe(200);
      expect(preview.body.data.warnings).toEqual([]);
      expect(preview.body.data.canPublish).toBe(true);
      expect(preview.body.data.sandbox).toBe(true);
      expect(preview.body.data.categoryDecision).toEqual({ allowed: true, requiresReview: false });
    });

    it('blocks a stored sandbox category in the publish preview while OLX runs in real mode', async () => {
      const { app, listingRepo } = await buildTestApp({ olxAdapterMode: 'real' });
      await seedPreviewListing(listingRepo, {
        providerCategoryId: '1001',
        name: 'Cameras',
        path: ['Electronics', 'Cameras'],
        source: 'provider_taxonomy',
        confidence: 1,
        isLeaf: true,
        taxonomyVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
        taxonomyStaleAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
        sandbox: true,
      });

      const preview = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(preview.status).toBe(200);
      expect(preview.body.data).toMatchObject({
        canPublish: false,
        sandbox: false,
        categoryDecision: { allowed: false, requiresReview: true, reason: 'category_sandbox' },
        quotaOverrideEligibility: { eligible: false },
      });
    });

    it('returns publish preview without publishing or enqueueing', async () => {
      const { app, listingRepo } = await buildTestApp();
      await seedPreviewListing(listingRepo);
      const before = await listingRepo.findById('listing-preview');
      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.canPublish).toBe(true);
      expect(res.body.data.quotaOverrideEligibility).toEqual({ eligible: false, reason: null });
      expect(res.body.data.quotaDecision).toMatchObject({
        status: 'available',
        decision: 'allow',
        subcategoryId: '2000',
        quota: {
          publicationLimit: 2,
          consumed: 1,
          remaining: 1,
          source: 'operator',
          confidence: 'verified',
          isStale: false,
        },
      });
      expect(res.body.data.payload.productName).toBe('Real widget');
      expect(res.body.data.payload.price).toBe(20);
      expect(res.body.data.marketplaceCategory).toEqual(
        expect.objectContaining({
          providerCategoryId: '2000',
          path: ['Home', 'Tools', 'Widgets'],
        })
      );
      expect(res.body.data.payload.marketplaceCategory).toEqual(res.body.data.marketplaceCategory);
      expect(before?.status).toBe('draft');
      expect(after?.status).toBe('draft');
      expect(after?.marketplaceListingId).toBeNull();
    });

    it('supports dryRun on the publish endpoint without publishing', async () => {
      const { app, listingRepo } = await buildTestApp();
      await seedPreviewListing(listingRepo);
      const res = await auth(request(app).post('/api/listings/listing-preview/publish')).send({
        dryRun: true,
      });
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.canPublish).toBe(true);
      expect(after?.status).toBe('draft');
      expect(after?.marketplaceListingId).toBeNull();
    });

    it('returns publish preview warnings without publishing invalid listings', async () => {
      const { app, listingRepo, marketplaceRepo } = await buildTestApp();
      await seedPreviewListing(listingRepo);
      const marketplace = await marketplaceRepo.findById('marketplace-olx');
      marketplace?.disconnect();

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings.length).toBeGreaterThan(0);
      expect(res.body.data.warnings[0]).toContain('not connected');
      expect(after?.status).toBe('draft');
      expect(after?.marketplaceListingId).toBeNull();
    });

    it('exposes quota override eligibility only when quota is the sole blocker', async () => {
      const { app, listingRepo } = await buildTestApp({
        olxPublicationQuotaService: stubUnknownOlxPublicationQuotaService(),
      });
      await seedPreviewListing(listingRepo);

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings).toEqual(['OLX quota blocks publication: quota_unknown']);
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: true,
        reason: 'quota_unknown',
      });
    });

    it('does not expose quota override eligibility when another publish blocker exists', async () => {
      const { app, listingRepo, marketplaceRepo } = await buildTestApp({
        olxPublicationQuotaService: stubUnknownOlxPublicationQuotaService(),
      });
      await seedPreviewListing(listingRepo);
      const marketplace = await marketplaceRepo.findById('marketplace-olx');
      marketplace?.disconnect();

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('not connected'),
          'OLX quota blocks publication: quota_unknown',
        ])
      );
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: false,
        reason: 'quota_unknown',
      });
    });

    it('does not expose quota override eligibility when exact category metadata is missing', async () => {
      const { app, listingRepo } = await buildTestApp({
        olxPublicationQuotaService: stubUnknownOlxPublicationQuotaService(),
      });
      await seedPreviewListing(listingRepo, null);

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining([
          'Select an exact OLX leaf category before publishing',
          'OLX quota blocks publication: quota_unknown',
        ])
      );
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: false,
        reason: 'quota_unknown',
      });
    });

    it('does not expose an override when the quota guard itself is unavailable', async () => {
      const { app, listingRepo } = await buildTestApp({ disableOlxPublicationQuotaService: true });
      await seedPreviewListing(listingRepo);

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: false,
        reason: 'quota_guard_unavailable',
      });
    });

    it.each([
      [
        'confirmation is false',
        { confirmed: false, reason: 'This must not bypass the quota guard' },
      ],
      ['reason is missing', { confirmed: true }],
      ['reason is blank', { confirmed: true, reason: '   ' }],
      ['reason is too short', { confirmed: true, reason: 'too short' }],
      ['reason is too long', { confirmed: true, reason: 'x'.repeat(501) }],
    ])('rejects quota override when %s', async (_case, quotaOverride) => {
      const { app, listingRepo } = await buildTestApp();
      await seedPreviewListing(listingRepo);

      const res = await auth(request(app).post('/api/listings/listing-preview/publish')).send({
        quotaOverride,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it.each(['draft', 'live'] as const)(
      'rejects direct relist for a %s listing even with an explicit quota override',
      async (status) => {
        const { app, listingRepo } = await buildTestApp();
        await seedPreviewListing(listingRepo, undefined, status);

        const res = await auth(request(app).post('/api/listings/listing-preview/relist')).send({
          quotaOverride: {
            confirmed: true,
            reason: 'Accept possible OLX publication fee',
          },
        });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('INVALID_STATE');
      }
    );
  });

  describe('hermes', () => {
    it('GET /api/hermes/status returns activeProvider offline in tests', async () => {
      const { app } = await buildTestApp({ hermesStatus: unconfiguredHermesStatus() });

      const res = await auth(request(app).get('/api/hermes/status'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          mode: 'auto',
          activeProvider: 'offline',
          hermesConfigured: false,
          hermesReachable: null,
          hermesToolsSafe: null,
          hermesEnabledToolsets: [],
          checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        },
      });
    });

    it('returns 401 for the Hermes status without a token', async () => {
      const { app } = await buildTestApp({ hermesStatus: unconfiguredHermesStatus() });

      const res = await request(app).get('/api/hermes/status');

      expect(res.status).toBe(401);
    });

    it('returns a 404 envelope when no Hermes status source is wired', async () => {
      const { app } = await buildTestApp();

      const res = await auth(request(app).get('/api/hermes/status'));

      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Hermes status is unavailable',
      });
    });

    it('serializes every canonical lifecycle status without label translation', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/hermes/events'));

      expect(res.status).toBe(200);
      expect(res.body.data.map((event: HermesEventView) => event.status)).toEqual(
        HERMES_EVENT_STATUSES
      );
    });

    it('passes the product filter to the Hermes event query', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/hermes/events?productId=p1'));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ productId: 'p1' });
    });

    it('queues a sale verdict run from the explicit route product only', async () => {
      const calls: unknown[][] = [];
      const queued = { id: 'run-1', productId: 'p-real', status: 'queued' };
      const saleVerdictRuns = {
        async request(...args: unknown[]) {
          calls.push(args);
          return { run: queued, enqueued: true };
        },
      } as unknown as AppDeps['saleVerdictRuns'];
      const { app } = await buildTestApp({ saleVerdictRuns });

      const accepted = await auth(request(app).post('/api/hermes/products/p-real/run')).send({
        scope: ['price'],
      });
      const rejected = await auth(request(app).post('/api/hermes/products/p-real/run')).send({
        productId: '0a0d3ba3-bc5b-4579-82e3-955d7968f5a4',
      });
      const badScope = await auth(request(app).post('/api/hermes/products/p-real/run')).send({
        scope: ['seo'],
      });

      expect(accepted.status).toBe(202);
      expect(accepted.body.data).toEqual(queued);
      const scheduled = await auth(request(app).post('/api/hermes/products/p-real/run')).send({
        trigger: 'scheduled',
      });

      expect(rejected.status).toBe(400);
      expect(badScope.status).toBe(400);
      expect(scheduled.status).toBe(400);
      expect(calls).toEqual([['ws-1', 'p-real', ['price'], 'manual']]);
    });

    describe('listing response', () => {
      async function appWithLiveListing() {
        const built = await buildTestApp({ listingResponseRuns: true });
        const price = Money.of(20, 'PLN');
        if (price.isErr()) throw price.error;
        const listing = Listing.create({
          id: 'listing-live', productId: 'p-real', marketplaceId: 'marketplace-olx', price: price.value,
          marketplaceListingId: '900100', status: 'live',
        });
        if (listing.isErr()) throw listing.error;
        await built.listingRepo.save(listing.value);
        const cost = Money.of(10, 'PLN');
        if (cost.isErr()) throw cost.error;
        const foreign = Product.create({
          id: 'p-foreign', workspaceId: 'ws-2', sku: 'S-FOREIGN', name: 'Foreign widget',
          description: 'A widget of another workspace', costPrice: cost.value, sellingPrice: price.value,
          condition: 'good', category: 'misc', status: 'active',
        });
        if (foreign.isErr()) throw foreign.error;
        await built.productRepo.save(foreign.value);
        return built.app;
      }

      it('answers 404 for an unknown product and for another workspace product', async () => {
        const app = await appWithLiveListing();

        const unknown = await auth(request(app).post('/api/hermes/products/p-missing/response-run'));
        const foreign = await auth(request(app).post('/api/hermes/products/p-foreign/response-run'));
        const foreignView = await auth(request(app).get('/api/hermes/products/p-foreign/response'));

        expect(unknown.status).toBe(404);
        expect(foreign.status).toBe(404);
        expect(foreignView.status).toBe(404);
      });

      it('answers 401 without a token', async () => {
        const app = await appWithLiveListing();

        expect((await request(app).post('/api/hermes/products/p-real/response-run')).status).toBe(401);
        expect((await request(app).get('/api/hermes/products/p-real/response')).status).toBe(401);
      });

      it('queues one run and answers the same run again', async () => {
        const app = await appWithLiveListing();

        const first = await auth(request(app).post('/api/hermes/products/p-real/response-run'));
        const second = await auth(request(app).post('/api/hermes/products/p-real/response-run'));
        const view = await auth(request(app).get('/api/hermes/products/p-real/response'));

        expect(first.status).toBe(202);
        expect(first.body.data).toMatchObject({ reused: false, run: { status: 'queued' } });
        expect(second.status).toBe(200);
        expect(second.body.data.run.id).toBe(first.body.data.run.id);
        expect(view.status).toBe(200);
        expect(view.body.data).toMatchObject({ latest: null, active: { id: first.body.data.run.id }, lastFailed: false });
      });

      it('answers 503 when the service is not wired', async () => {
        const { app } = await buildTestApp();

        const res = await auth(request(app).post('/api/hermes/products/p-real/response-run'));

        expect(res.status).toBe(503);
      });
    });

    it('approves a pending event (happy path)', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/hermes/events/pending/approve')).send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('applied');
    });

    it('returns 422 when approving a non-pending event', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/hermes/events/applied/approve')).send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('dismisses a pending event without requiring an explicit JSON body', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/hermes/events/pending/dismiss'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('preserves explicit null bodies as validation failures', () => {
      const schema = z.object({ actorId: z.string().optional() });
      const req = { body: null } as any;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      const next = jest.fn();

      validateBody(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('exposes separate authenticated list, approve, and execute operation workflows', async () => {
      const { app } = await buildTestApp();
      const unauthenticated = await request(app).get(
        '/api/hermes/events/e1/category-correction-operations'
      );
      expect(unauthenticated.status).toBe(401);

      const listed = await auth(
        request(app).get('/api/hermes/events/e1/category-correction-operations')
      );
      expect(listed.status).toBe(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({ id: 'recreate-1', kind: 'recreate', state: 'requested' }),
      ]);

      const approved = await auth(
        request(app).post('/api/hermes/category-correction-operations/recreate-1/approve')
      ).send({ paidOverrideReason: 'Operator accepts possible paid placement' });
      expect(approved.status).toBe(200);
      expect(approved.body.data).toMatchObject({ state: 'approved', approvedBy: 'u-1' });

      const executed = await auth(
        request(app).post('/api/hermes/category-correction-operations/recreate-1/execute')
      ).send({});
      expect(executed.status).toBe(200);
      expect(executed.body.data).toMatchObject({
        state: 'executed',
        result: { externalListingId: 'new-advert' },
      });
    });

    it('requires authentication and literal destructive confirmation for standalone listing delist', async () => {
      const { app } = await buildTestApp();
      const operationId = '8f620660-cafe-4f08-9f7f-60ea44c4ad58';

      const unauthenticated = await request(app)
        .post('/api/listings/listing-1/delist-to-draft')
        .send({ operationId, confirmed: true });
      expect(unauthenticated.status).toBe(401);

      const unconfirmed = await auth(
        request(app).post('/api/listings/listing-1/delist-to-draft'),
      ).send({ operationId, confirmed: false });
      expect(unconfirmed.status).toBe(400);

      const executed = await auth(
        request(app).post('/api/listings/listing-1/delist-to-draft'),
      ).send({ operationId, confirmed: true });
      expect(executed.status).toBe(200);
      expect(executed.body.data).toMatchObject({
        id: operationId,
        state: 'executed',
        kind: 'delist',
        recommendationEventId: null,
      });
    });

    it('preserves standalone delist identity through request, approve, and execute stubs', async () => {
      const service = stubCategoryCorrectionOperationService();
      const requested = await service.requestStandaloneDelist({
        operationId: 'standalone-contract',
        listingId: 'listing-1',
        workspaceId: 'ws-1',
        actorId: 'u-1',
      });
      expect(requested).toMatchObject({ kind: 'delist', recommendationEventId: null });

      const approved = await service.approve({
        operationId: requested.id,
        workspaceId: 'ws-1',
        actorId: 'u-1',
      });
      expect(approved).toMatchObject({ kind: 'delist', recommendationEventId: null });

      const executed = await service.execute({
        operationId: approved.id,
        workspaceId: 'ws-1',
        actorId: 'u-1',
      });
      expect(executed).toMatchObject({ kind: 'delist', recommendationEventId: null });
    });

    it('returns typed standalone delist failure metadata to the API client', async () => {
      const service = stubCategoryCorrectionOperationService();
      service.execute = jest.fn(async (input) => ({
        id: input.operationId,
        workspaceId: input.workspaceId,
        recommendationEventId: null,
        listingId: 'listing-1',
        marketplaceId: 'marketplace-olx',
        kind: 'delist' as const,
        state: 'failed' as const,
        targetCategory: null,
        paidOverrideReason: null,
        requestedBy: 'u-1',
        approvedBy: 'u-1',
        result: {
          failureKind: 'authentication',
          errorCode: 'AUTHENTICATION',
          message: 'OLX credentials expired',
          retrySafe: false,
          manualReconciliationRequired: false,
        },
        requestedAt: new Date(),
        approvedAt: new Date(),
        executedAt: null,
        failedAt: new Date(),
        updatedAt: new Date(),
      }));
      const { app } = await buildTestApp({ categoryCorrectionOperationService: service });

      const response = await auth(
        request(app).post('/api/listings/listing-1/delist-to-draft'),
      ).send({
        operationId: '7e132d48-bdac-4d5f-8c72-cb02ce4442d1',
        confirmed: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        kind: 'delist',
        recommendationEventId: null,
        state: 'failed',
        result: {
          failureKind: 'authentication',
          errorCode: 'AUTHENTICATION',
          manualReconciliationRequired: false,
        },
      });
    });

    it('returns a 404 error envelope for an unknown event', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/hermes/events/nope'));

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('persistent settings contracts', () => {
    it('round-trips principal-scoped workspace, preferences, and Hermes settings', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });

      const workspace = await auth(request(app).patch('/api/settings/workspace')).send({
        name: 'Polish shop',
        currency: 'EUR',
        timezone: 'Europe/Warsaw',
        language: 'pl',
      });
      expect(workspace.status).toBe(200);
      expect(workspace.body.data).toMatchObject({
        name: 'Polish shop',
        currency: 'EUR',
        language: 'pl',
      });

      const preferences = await auth(request(app).patch('/api/settings/preferences')).send({
        themeMode: 'dark',
        density: 'compact',
      });
      expect(preferences.body.data).toMatchObject({
        themeMode: 'dark',
        density: 'compact',
        revision: 1,
      });

      const hermes = await auth(request(app).patch('/api/settings/hermes')).send({
        autonomyLevel: 'balanced',
        creativityPreset: 'creative',
        agents: { listingSeo: { enabled: false } },
        guardrails: { maxAutoPriceChangePct: 5 },
      });
      expect(hermes.status).toBe(200);
      expect(hermes.body.data).toMatchObject({
        autonomyLevel: 'balanced',
        creativityPreset: 'creative',
        agents: { listingSeo: { enabled: false } },
        guardrails: { maxAutoPriceChangePct: 5 },
      });
    });

    it('rejects empty and unknown patches with structured validation details', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });
      for (const body of [{}, { token: 'must-not-be-accepted' }]) {
        const response = await auth(request(app).patch('/api/settings/preferences')).send(body);
        expect(response.status).toBe(400);
        expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(response.body.error.details).toEqual(expect.any(Array));
      }
    });

    it('preserves independent workspace and Hermes fields across concurrent PATCH requests', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });

      const [profile, hermes] = await Promise.all([
        auth(request(app).patch('/api/settings/workspace')).send({ name: 'Concurrent name' }),
        auth(request(app).patch('/api/settings/hermes')).send({
          guardrails: { autoRelist: true },
        }),
      ]);

      expect(profile.status).toBe(200);
      expect(hermes.status).toBe(200);
      const [savedProfile, savedHermes] = await Promise.all([
        auth(request(app).get('/api/settings/workspace')),
        auth(request(app).get('/api/settings/hermes')),
      ]);
      expect(savedProfile.body.data.name).toBe('Concurrent name');
      expect(savedHermes.body.data.guardrails.autoRelist).toBe(true);
    });

    it('preserves Hermes creativity and listing-seo enabled state across profile updates', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });
      expect(
        (await auth(request(app).patch('/api/settings/hermes')).send({
          creativityPreset: 'precise',
          agents: { listingSeo: { enabled: false } },
        })).status
      ).toBe(200);

      const profile = await auth(request(app).patch('/api/settings/workspace')).send({
        name: 'SEO preserved',
      });
      const hermes = await auth(request(app).get('/api/settings/hermes'));

      expect(profile.status).toBe(200);
      expect(hermes.body.data).toMatchObject({
        creativityPreset: 'precise',
        agents: { listingSeo: { enabled: false } },
      });
    });

    it.each([
      ['deleted', 401],
      ['reassigned', 403],
    ] as const)(
      'rejects stale JWT authority when the current user is %s',
      async (state, expectedStatus) => {
        const { app, authUserStore } = await buildTestApp({ seedWorkspace: true });
        if (state === 'deleted') authUserStore.users.splice(0);
        else authUserStore.users[0]!.workspaceId = 'ws-other';

        const requests = [
          auth(request(app).get('/api/settings/preferences')),
          auth(request(app).patch('/api/settings/workspace')).send({ name: 'blocked' }),
          auth(request(app).patch('/api/settings/hermes')).send({ autonomyLevel: 'balanced' }),
          auth(request(app).get('/api/settings/integrations')),
          auth(request(app).patch('/api/workspaces/foreign-id')).send({ name: 'blocked' }),
        ];
        const responses = await Promise.all(requests);
        expect(responses.map((response) => response.status)).toEqual(
          Array(requests.length).fill(expectedStatus)
        );
      }
    );

    it('legacy workspace PATCH preserves settings fields omitted from its body', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });
      expect(
        (await auth(request(app).patch('/api/settings/workspace')).send({ currency: 'EUR' })).status
      ).toBe(200);

      const legacy = await auth(request(app).patch('/api/workspaces/ignored')).send({
        name: 'Legacy rename',
      });

      expect(legacy.status).toBe(200);
      expect(legacy.body.data).toMatchObject({ name: 'Legacy rename', currency: 'EUR' });
    });

    it('returns marketplace connection state without credential fields', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });
      const response = await auth(request(app).get('/api/settings/integrations'));
      expect(response.status).toBe(200);
      expect(response.body.data.items).toEqual(
        expect.arrayContaining([
          {
            category: 'marketplace',
            id: 'marketplace-olx',
            providerKey: 'olx',
            name: 'OLX',
            available: true,
            configured: true,
            connected: true,
            account: { handle: 'OLX account', status: 'connected' },
            sandbox: true,
          },
        ])
      );
      expect(
        response.body.data.items.map((item: { category: string }) => item.category).sort()
      ).toEqual(['marketplace']);
      expect(JSON.stringify(response.body)).not.toMatch(
        /token|secret|hash|credentials|scopes|access[_-]?key|private[_-]?key/i
      );
    });

    it.each([
      ['get', '/api/settings/notifications'],
      ['patch', '/api/settings/notifications'],
    ] as const)('no longer serves %s %s', async (method, path) => {
      const { app } = await buildTestApp();
      const res = await auth(request(app)[method](path)).send({});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('lists only marketplace integrations', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/settings/integrations'));
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((item: { category: string }) => item.category)).toEqual([
        'marketplace',
      ]);
    });
  });

  describe('analytics', () => {
    it.each(['/api/analytics/revenue', '/api/analytics/listings'])('no longer serves %s', async (path) => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get(path));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('still serves the overview', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/analytics/overview'));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('unmatched routes', () => {
    it('returns a 404 envelope for unknown /api routes', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/does-not-exist'));
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
