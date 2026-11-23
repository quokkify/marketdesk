// Composition root (DI container) — ARCHITECTURE.md §5.
//
// This is the ONE place permitted to import concrete implementations from every
// layer (config, infrastructure, domain, application, presentation) and wire the
// full object graph in dependency order. No other module crosses layers.
//
// The graph is constructed with plain factory functions (no heavy DI framework):
// each dependency is instantiated once, in order, and passed explicitly to its
// consumers. Connection-bearing boundaries (pg Pool, Redis, the Bull queues, the
// AI completion client and the event broker) are injectable via ContainerOverrides
// so the graph can be built and asserted without any live infrastructure (see the
// container unit test). Absent overrides, the real config-backed clients are used.

import { activateDraftWithLiveListing } from '../../domain/services/productSaleStatus';
import type { RequestLogger } from '../../presentation/http/middleware/RequestLoggingMiddleware';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { Redis } from 'ioredis';

import { createPool } from '../database';
import { createRedisClient } from '../redis';

// --- Infrastructure: persistence ---
import { ProductRepository } from '../../infrastructure/persistence/repositories/ProductRepository';
import { ConversationRepository } from '../../infrastructure/persistence/repositories/ConversationRepository';
import { ListingRepository } from '../../infrastructure/persistence/repositories/ListingRepository';
import { MarketplaceRepository } from '../../infrastructure/persistence/repositories/MarketplaceRepository';
import { MarketplaceAccountRepository } from '../../infrastructure/persistence/repositories/MarketplaceAccountRepository';
import { MarketplaceAppCredentialRepository } from '../../infrastructure/persistence/repositories/MarketplaceAppCredentialRepository';
import { PublishAttemptRepository } from '../../infrastructure/persistence/repositories/PublishAttemptRepository';
import { EventRepository } from '../../infrastructure/persistence/repositories/EventRepository';
import { WorkspaceRepository } from '../../infrastructure/persistence/repositories/WorkspaceRepository';
import { SettingsRepository } from '../../infrastructure/persistence/repositories/SettingsRepository';
import { ActivityLogRepository } from '../../infrastructure/persistence/repositories/ActivityLogRepository';
import { AnalyticsEventRepository } from '../../infrastructure/persistence/repositories/AnalyticsEventRepository';
import { AuthUserRepository } from '../../infrastructure/persistence/repositories/AuthUserRepository';
import { PriceHistoryRepository } from '../../infrastructure/persistence/repositories/PriceHistoryRepository';
import { OlxPublicationQuotaRepository } from '../../infrastructure/persistence/repositories/OlxPublicationQuotaRepository';
import { CategoryCorrectionOperationRepository } from '../../infrastructure/persistence/repositories/CategoryCorrectionOperationRepository';

async function withPoolTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Preserve the original transaction failure; rollback failure is secondary.
      releaseError =
        rollbackError instanceof Error ? rollbackError : new Error('Transaction rollback failed');
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

// --- Infrastructure: events, cache, jobs, adapters, external ---
import {
  createRedisEventBroker,
  createEventPublisher,
} from '../../infrastructure/eventBroker/RedisWiring';
import type { EventBroker } from '../../infrastructure/eventBroker/RedisEventBroker';
import { BullJobQueue } from '../../infrastructure/jobQueue/BullJobQueue';
import { MarketplaceAdapterFactory } from '../../infrastructure/adapters/MarketplaceAdapterFactory';
import { FetchMarketplaceHttpClient } from '../../infrastructure/adapters/FetchMarketplaceHttpClient';
import { OlxTaxonomyResolver } from '../../infrastructure/adapters/OlxTaxonomyResolver';
import { StubOlxTaxonomyResolver } from '../../infrastructure/adapters/StubOlxTaxonomyResolver';
import { RedisMarketplaceOAuthStateStore } from '../../infrastructure/cache/RedisMarketplaceOAuthStateStore';
import { RedisMarketplaceOAuthRefreshLock } from '../../infrastructure/cache/RedisMarketplaceOAuthRefreshLock';
import { AesGcmCredentialVault } from '../../infrastructure/security/AesGcmCredentialVault';
import { FilesystemProductImageStorage } from '../../infrastructure/storage/FilesystemProductImageStorage';
import { OlxOAuthClient } from '../../infrastructure/external/OlxOAuthClient';
import { env } from '../env';
import {
  HermesAI,
  loadHermesConfig,
  loadHermesResearchConfig,
  loadHermesResearchMaxConcurrency,
} from '../../infrastructure/external/HermesAI';
import { HermesCompletionClient } from '../../infrastructure/external/HermesCompletionClient';
import { HermesHealthProbe } from '../../infrastructure/external/HermesHealthProbe';
import { HermesLimitsReader } from '../../infrastructure/external/HermesLimitsReader';
import { OfflineHeuristicAIProvider } from '../../infrastructure/external/OfflineHeuristicAIProvider';
import { AIProviderSelector } from '../../infrastructure/external/AIProviderSelector';
import { HermesReplyDraftAI } from '../../infrastructure/external/HermesReplyDraftAI';
import { OfflineReplyDraftAI } from '../../infrastructure/external/OfflineReplyDraftAI';
import { ReplyDraftAISelector } from '../../infrastructure/external/ReplyDraftAISelector';
import { fanOutAiUsageSink, loggingAiUsageSink, storingAiUsageSink } from '../../application/ai/AiCallRecord';
import { PriceResearchRepository } from '../../infrastructure/persistence/repositories/PriceResearchRepository';
import { PriceResearchRuns } from '../../application/services/PriceResearchRuns';
import { PriceResearchRunRepository } from '../../infrastructure/persistence/repositories/PriceResearchRunRepository';
import { PriceResearchGraph } from '../../application/services/PriceResearchGraph';
import { createResearchCallLimiter } from '../../application/services/researchCallLimiter';
import { AiUsageRepository } from '../../infrastructure/persistence/repositories/AiUsageRepository';
import { PublishListingHandler } from '../../infrastructure/jobQueue/JobHandlers/PublishListingHandler';
import { SyncMarketplaceHandler } from '../../infrastructure/jobQueue/JobHandlers/SyncMarketplaceHandler';
import { ConversationReplyHandler } from '../../infrastructure/jobQueue/JobHandlers/ConversationReplyHandler';

// --- Domain: services + ports ---
import { ProductService } from '../../domain/services/ProductService';
import { ListingService } from '../../domain/services/ListingService';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';
import { PriceProposals } from '../../application/services/verdict/PriceProposals';
import { ListingSeoProposals } from '../../application/services/verdict/ListingSeoProposals';
import { SaleVerdictGraph } from '../../application/services/verdict/SaleVerdictGraph';
import { SaleVerdictRuns } from '../../application/services/verdict/SaleVerdictRuns';
import { buildInfoCheck } from '../../application/services/verdict/infoCheckGraph';
import { buildPriceCheck } from '../../application/services/verdict/priceCheckGraph';
import { buildPhotosCheck } from '../../application/services/verdict/photosCheckGraph';
import { RecordedResearchRun } from '../../application/services/recordedResearchRun';
import { SaleVerdictRepository } from '../../infrastructure/persistence/repositories/SaleVerdictRepository';
import { SaleVerdictHandler } from '../../infrastructure/jobQueue/JobHandlers/SaleVerdictHandler';
import { ListingResponseGraph } from '../../application/services/response/ListingResponseGraph';
import { ListingResponseRuns } from '../../application/services/response/ListingResponseRuns';
import { ListingResponseRunRepository } from '../../infrastructure/persistence/repositories/ListingResponseRunRepository';
import { ListingResponseHandler } from '../../infrastructure/jobQueue/JobHandlers/ListingResponseHandler';
import { MAX_PAGES, OlxSearchPageClient, loadOlxSearchBaseUrl } from '../../infrastructure/external/OlxSearchPageClient';
import { PriceEstimateService } from '../../domain/services/PriceEstimateService';
import type { IAIProvider } from '../../domain/ports/IAIProvider';

// --- Application: use cases + services + ports ---
import { CreateProductUseCase } from '../../application/usecases/CreateProductUseCase';
import { UpdateProductUseCase } from '../../application/usecases/UpdateProductUseCase';
import { PublishListingUseCase } from '../../application/usecases/PublishListingUseCase';
import { SyncMarketplaceUseCase } from '../../application/usecases/SyncMarketplaceUseCase';
import { MarketplaceUpdateEnqueuer } from '../../application/services/MarketplaceUpdateEnqueuer';
import { PriceChangeService } from '../../application/services/PriceChangeService';
import { ApproveHermesEventUseCase } from '../../application/usecases/ApproveHermesEventUseCase';
import { DismissHermesEventUseCase } from '../../application/usecases/DismissHermesEventUseCase';
import { ProductApplicationService } from '../../application/services/ProductApplicationService';
import {
  ProductAIDraftService,
  type ProductDraftLogger,
} from '../../application/services/ProductAIDraftService';
import { ProductImageUploadService } from '../../application/services/ProductImageUploadService';
import {
  ProductRecheckService,
  type OlxTaxonomyResolverFactory,
} from '../../application/services/ProductRecheckService';
import { ProductAssistanceGraph } from '../../application/services/ProductAssistanceGraph';
import { ListingApplicationService } from '../../application/services/ListingApplicationService';
import { HermesApplicationService } from '../../application/services/HermesApplicationService';
import { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';
import { ProductStatsService } from '../../application/services/ProductStatsService';
import { MarketplaceOAuthService } from '../../application/services/MarketplaceOAuthService';
import { ConversationRetentionService } from '../../application/services/ConversationRetentionService';
import { ConversationSyncService } from '../../application/services/ConversationSyncService';
import { ConversationReplyGraph } from '../../application/services/ConversationReplyGraph';
import { ReplySendService, sendingInFlightWindowMs } from '../../application/services/ReplySendService';
import { MarketplaceSyncScheduler } from '../../application/services/MarketplaceSyncScheduler';
import { MarketplaceImportService } from '../../application/services/MarketplaceImportService';
import {
  ProductCategorySyncService,
  selectProductCategoryTriggerListings,
} from '../../application/services/ProductCategorySyncService';
import { OlxPublicationQuotaService } from '../../application/services/OlxPublicationQuotaService';
import { ListingReactivationService } from '../../application/services/ListingReactivationService';
import { ListingRevivalService } from '../../application/services/ListingRevivalService';
import type { Marketplace } from '../../domain/entities/Marketplace';
import { CategoryCorrectionOperationService } from '../../application/services/CategoryCorrectionOperationService';
import type { IdGenerator } from '../../application/ports/IdGenerator';
import { noopRunRecorder, type IRunRecorder } from '../../application/ports/IRunRecorder';
import { recordedProcessor, stampRun } from './recordedQueue';
import type {
  ConversationReplyJob,
  IJobQueue,
  JobEnqueueOptions,
  SaleVerdictJob,
  ListingResponseJob,
  PublishListingJob,
  SyncMarketplaceJob,
} from '../../application/ports/IJobQueue';

// --- Presentation ---
import type { AppDeps } from '../../presentation/http/app';
import type { ErrorLogger } from '../../presentation/http/middleware/ErrorHandlingMiddleware';

// A queue the container owns end-to-end: enqueue (the application IJobQueue port),
// handler registration (wiring the concrete JobHandler) and lifecycle (close).
export interface ManagedQueue<T> extends IJobQueue<T> {
  scheduleRepeat(data: T, options: { jobId: string; everyMs: number }): Promise<void>;
  removeRepeat(jobId: string): Promise<void>;
  registerHandler(handler: (data: T) => Promise<unknown>): void;
  close(): Promise<void>;
}

// The reply graph reads outside a transaction (its AI calls must not hold one open) and writes
// each change in its own transaction on the container pool: replacePendingDraft needs a caller
// transaction, never the module-level pool.
class ReplyGraphConversationRepository extends ConversationRepository {
  constructor(private readonly writePool: Pool) {
    super(writePool);
  }

  override upsertThread(
    ...args: Parameters<ConversationRepository['upsertThread']>
  ): ReturnType<ConversationRepository['upsertThread']> {
    return withPoolTransaction(this.writePool, (client) =>
      new ConversationRepository(this.writePool, client).upsertThread(...args)
    );
  }

  override replacePendingDraft(
    ...args: Parameters<ConversationRepository['replacePendingDraft']>
  ): ReturnType<ConversationRepository['replacePendingDraft']> {
    return withPoolTransaction(this.writePool, (client) =>
      new ConversationRepository(this.writePool, client).replacePendingDraft(...args)
    );
  }
}

const CONVERSATION_SYNC_FAILURE_MESSAGE = 'Conversation sync failed';
const CONVERSATION_REPLY_DROPPED_MESSAGE = 'Conversation reply run dropped';
const CONVERSATION_REPLY_ENQUEUE_FAILED_MESSAGE = 'Conversation reply run not queued';

const CONVERSATION_RETENTION_JOB_ID = 'conversation-retention';
const CONVERSATION_RETENTION_EVERY_MS = 24 * 60 * 60 * 1000;

const SALE_VERDICT_QUEUE = 'sale-verdict';
const LISTING_RESPONSE_QUEUE = 'listing-response';

export function buildBullAddOptions(name: string, options?: JobEnqueueOptions) {
  // A failed run is recorded on the run and retried by its schedule or a new request, never by the queue.
  if (name === SALE_VERDICT_QUEUE || name === LISTING_RESPONSE_QUEUE) return { delay: options?.delayMs, jobId: options?.jobId, attempts: 1 };
  return {
    delay: options?.delayMs,
    jobId: options?.jobId,
    // Publish retries resume from the durable checkpoint and never repeat an
    // ambiguous external POST. Backoff gives transient finalization failures time
    // to recover without hot-looping the queue.
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
  };
}

// Default managed queue backed by Bull. Maps the application-owned enqueue
// options onto Bull's job options and adapts the processor callback shape.
class BullManagedQueue<T> implements ManagedQueue<T> {
  private readonly queue: BullJobQueue<T>;

  constructor(
    private readonly name: string,
    private readonly recorder: IRunRecorder
  ) {
    this.queue = new BullJobQueue<T>(name);
  }

  async enqueue(data: T, options?: JobEnqueueOptions): Promise<void> {
    await this.queue.add(
      stampRun(data, this.name, options?.jobId, this.recorder),
      buildBullAddOptions(this.name, options)
    );
  }

  async enqueueAll(items: Array<{ data: T; options?: JobEnqueueOptions }>): Promise<void> {
    if (items.length === 0) return;
    await this.queue.addBulk(
      items.map((item) => ({
        data: stampRun(item.data, this.name, item.options?.jobId, this.recorder),
        opts: buildBullAddOptions(this.name, item.options),
      }))
    );
  }

  async scheduleRepeat(data: T, options: { jobId: string; everyMs: number }): Promise<void> {
    await this.queue.add(data, {
      ...buildBullAddOptions(this.name, { jobId: options.jobId }),
      repeat: { every: options.everyMs },
    });
  }

  async removeRepeat(jobId: string): Promise<void> {
    const jobs = await this.queue.raw.getRepeatableJobs();
    await Promise.all(
      jobs
        .filter((job) => job.id === jobId)
        .map((job) => this.queue.raw.removeRepeatableByKey(job.key))
    );
  }

  registerHandler(handler: (data: T) => Promise<unknown>): void {
    this.queue.processAsync(recordedProcessor(this.name, this.recorder, handler));
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

export interface ContainerOverrides {
  pool?: Pool;
  redis?: Redis;
  eventBroker?: EventBroker;
  aiProvider?: IAIProvider;
  idGenerator?: IdGenerator;
  logger?: ErrorLogger & ProductDraftLogger & RequestLogger;
  marketplaceCredentialsKey?: string;
  runRecorder?: IRunRecorder;
  // Factory for background job queues. Overridable so tests avoid a live Bull/Redis.
  createQueue?: <T>(name: string) => ManagedQueue<T>;
}

export interface AppContainer {
  deps: AppDeps;
  // Lifecycle handles for graceful shutdown / health checks.
  pool: Pool;
  redis: Redis;
  queues: ManagedQueue<unknown>[];
  shutdown(): Promise<void>;
}

// Build the entire object graph and return an AppDeps-compatible container.
export function buildContainer(overrides: ContainerOverrides = {}): AppContainer {
  // 1. Connection-bearing clients.
  const pool = overrides.pool ?? createPool();
  const redis = overrides.redis ?? createRedisClient();

  // 2. Event broker and publisher.
  const broker: EventBroker =
    overrides.eventBroker ?? createRedisEventBroker(redis);
  const eventPublisher = createEventPublisher(broker);

  // 3. Cross-cutting ports.
  const idGenerator: IdGenerator = overrides.idGenerator ?? randomUUID;
  // GET /api/hermes/status always reports this env-configured selector, even when a
  // test swaps the provider that services call through overrides.aiProvider.
  // Every AI call is logged and, when attributed to a workspace, stored in ai_usage.
  const aiUsageRepo = new AiUsageRepository(pool);
  const loggingSink = overrides.logger ? loggingAiUsageSink(overrides.logger) : undefined;
  const aiUsageSink = fanOutAiUsageSink([
    ...(loggingSink ? [loggingSink] : []),
    storingAiUsageSink(aiUsageRepo, (error) => {
      if (loggingSink?.reportFailure) return loggingSink.reportFailure(error);
      // Without a logger a failed write must still leave a trace.
      console.warn('AI usage could not be recorded', error instanceof Error ? error.message : String(error));
    }),
  ]);
  const aiProviderSelector = new AIProviderSelector({
    hermes: new HermesAI(new HermesCompletionClient(loadHermesConfig(), aiUsageSink)),
    offline: new OfflineHeuristicAIProvider(),
    mode: env.hermes.providerMode,
    probe: new HermesHealthProbe(loadHermesConfig()),
    usageSink: aiUsageSink,
  });
  const aiProvider: IAIProvider = overrides.aiProvider ?? aiProviderSelector;
  const replyDraftAI = new ReplyDraftAISelector({
    hermes: new HermesReplyDraftAI(new HermesCompletionClient(loadHermesConfig(), aiUsageSink)),
    offline: new OfflineReplyDraftAI(),
    mode: env.hermes.providerMode,
    probe: new HermesHealthProbe(loadHermesConfig()),
    usageSink: aiUsageSink,
  });
  const buildOlxHeaders = (accessToken?: string): Record<string, string> => ({
    Accept: 'application/json',
    Version: '2.0',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  });
  const olxHttpClient =
    env.marketplaces.olx.adapterMode === 'real'
      ? new FetchMarketplaceHttpClient({
          logger: overrides.logger,
          defaultHeaders: buildOlxHeaders(env.marketplaces.olx.accessToken),
          timeoutMs: env.marketplaces.olx.requestTimeoutMs,
          livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
        })
      : undefined;
  const adapterFactory = new MarketplaceAdapterFactory({
    httpClients: olxHttpClient ? { olx: olxHttpClient } : undefined,
    olx: {
      baseUrl: env.marketplaces.olx.apiBaseUrl,
      publicBaseUrl: env.publicBaseUrl,
      requirePublishDetails: env.marketplaces.olx.adapterMode === 'real',
      categoryIds: env.marketplaces.olx.categoryIds,
      cityId: env.marketplaces.olx.cityId,
      districtId: env.marketplaces.olx.districtId,
      contactName: env.marketplaces.olx.contactName,
      contactPhone: env.marketplaces.olx.contactPhone,
      advertiserType: env.marketplaces.olx.advertiserType,
      priceNegotiable: env.marketplaces.olx.priceNegotiable,
      conditionAttributeCode: env.marketplaces.olx.conditionAttributeCode,
      deliveryAttributeCode: env.marketplaces.olx.deliveryAttributeCode,
      deliveryOptionCode: env.marketplaces.olx.deliveryOptionCode,
    },
  });
  const createQueue =
    overrides.createQueue ??
    (<T>(name: string) => new BullManagedQueue<T>(name, overrides.runRecorder ?? noopRunRecorder));

  // 4. Repositories. They use the injected pool (or the module-level default if
  //    not overridden). An optional PoolClient can enlist them in an outer transaction.
  const productRepo = new ProductRepository(pool);
  const listingRepo = new ListingRepository(pool);
  const marketplaceRepo = new MarketplaceRepository(pool);
  const marketplaceAccountRepo = new MarketplaceAccountRepository(pool);
  const marketplaceAppCredentialRepo = new MarketplaceAppCredentialRepository(pool);
  const publishAttemptRepo = new PublishAttemptRepository(pool);
  const eventRepo = new EventRepository(pool);
  const workspaceRepo = new WorkspaceRepository(pool);
  const settingsRepo = new SettingsRepository(pool);
  const activityLogRepo = new ActivityLogRepository(pool);
  const authUserStore = new AuthUserRepository(pool);
  const priceHistoryRepo = new PriceHistoryRepository(pool);
  const olxPublicationQuotaRepo = new OlxPublicationQuotaRepository(pool);
  const categoryCorrectionOperationRepo = new CategoryCorrectionOperationRepository(pool);
  const marketplaceOAuthService = new MarketplaceOAuthService({
    marketplaceRepo,
    accountRepo: marketplaceAccountRepo,
    appCredentialRepo: marketplaceAppCredentialRepo,
    stateStore: new RedisMarketplaceOAuthStateStore(redis),
    oauthClientFactory: ({ clientId, clientSecret }) =>
      new OlxOAuthClient({
        authorizationUrl: env.marketplaces.olx.authUrl,
        tokenUrl: env.marketplaces.olx.tokenUrl,
        clientId,
        clientSecret,
        redirectUri: env.marketplaces.olx.redirectUri,
        scopes: env.marketplaces.olx.requiredScopes
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter(Boolean),
        timeoutMs: env.marketplaces.olx.requestTimeoutMs,
      }),
    credentialVault: new AesGcmCredentialVault(
      overrides.marketplaceCredentialsKey ?? env.marketplaceCredentialsKey
    ),
    refreshLock: new RedisMarketplaceOAuthRefreshLock(redis, overrides.logger),
    idGenerator,
    stateGenerator: () => randomBytes(32).toString('base64url'),
    sandbox: {
      enabled: env.marketplaces.olx.adapterMode !== 'real',
      successUrl: env.marketplaces.olx.oauthSuccessUrl,
    },
  });
  // While the OLX adapter is not real, category search and verification use the fixed
  // sandbox taxonomy, which needs no OLX access token and never calls OLX.
  const olxTaxonomyResolver: OlxTaxonomyResolverFactory =
    env.marketplaces.olx.adapterMode === 'real'
      ? async (marketplaceId) => {
          const accessToken = await marketplaceOAuthService.getValidAccessToken(marketplaceId);
          const http = new FetchMarketplaceHttpClient({
            logger: overrides.logger,
            defaultHeaders: buildOlxHeaders(accessToken),
            timeoutMs: env.marketplaces.olx.requestTimeoutMs,
            livePublishEnabled: false,
          });
          return new OlxTaxonomyResolver(http, env.marketplaces.olx.apiBaseUrl);
        }
      : async () => new StubOlxTaxonomyResolver();
  const olxPublicationQuotaService = new OlxPublicationQuotaService(
    marketplaceRepo,
    marketplaceAccountRepo,
    olxPublicationQuotaRepo,
    activityLogRepo,
    idGenerator,
    {
      resolve: (domainCategory) => {
        const normalized = domainCategory.trim().toLowerCase();
        const categoryId = env.marketplaces.olx.categoryIds[normalized];
        return categoryId === undefined ? null : String(categoryId);
      },
    },
    undefined,
    { sandboxMode: env.marketplaces.olx.adapterMode !== 'real' }
  );

  // 5. Job queues (application IJobQueue ports). Handlers are registered below,
  //    once the services they depend on exist.
  const publishQueue = createQueue<PublishListingJob>('publish-listing');
  const syncQueue = createQueue<SyncMarketplaceJob>('sync-marketplace');
  const marketplaceSyncScheduler = new MarketplaceSyncScheduler(syncQueue);
  const conversationRetentionQueue = createQueue<Record<string, never>>('conversation-retention');
  const conversationReplyQueue = createQueue<ConversationReplyJob>('conversation-reply');
  const saleVerdictQueue = createQueue<SaleVerdictJob>(SALE_VERDICT_QUEUE);
  const listingResponseQueue = createQueue<ListingResponseJob>(LISTING_RESPONSE_QUEUE);

  // 6. Domain services.
  const productDomainService = new ProductService(productRepo, eventPublisher);
  const listingDomainService = new ListingService(
    listingRepo,
    productRepo,
    marketplaceRepo,
    eventPublisher,
    (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          listingRepo: new ListingRepository(pool, client),
          productRepo: new ProductRepository(pool, client),
        })
      )
  );
  const priceResearchRepo = new PriceResearchRepository(pool);
  // The web-enabled research profile serves only the market search; a new probe per search keeps
  // its toolset guard from acting on a cached answer.
  const researchConfig = loadHermesResearchConfig();
  const priceResearchGraph = new PriceResearchGraph({
    products: productRepo,
    listings: listingRepo,
    research: priceResearchRepo,
    profile: researchConfig
      ? {
          client: new HermesCompletionClient(researchConfig, aiUsageSink),
          checkProfile: () => new HermesHealthProbe(researchConfig).reachability(),
        }
      : null,
    // One limiter for the process: every research run shares its slots.
    limiter: createResearchCallLimiter(loadHermesResearchMaxConcurrency()),
    now: () => new Date(),
    logger: overrides.logger,
  });
  const priceResearchRunRepo = new PriceResearchRunRepository(pool);
  const priceResearchRuns = new PriceResearchRuns({
    runs: priceResearchRunRepo,
    now: () => new Date(),
  });
  const priceEstimateService = new PriceEstimateService({
    ai: aiProvider,
    research: priceResearchRepo,
    runs: priceResearchRuns,
    logger: overrides.logger,
  });
  const priceProposals = new PriceProposals({
    events: eventRepo,
    estimates: priceEstimateService,
    ai: aiProvider,
    idFactory: idGenerator,
  });

  // 7. Application use cases.
  const createProductUC = new CreateProductUseCase(
    productDomainService,
    workspaceRepo,
    idGenerator
  );
  const publishListingUC = new PublishListingUseCase(
    listingRepo,
    productRepo,
    marketplaceRepo,
    publishQueue,
    activityLogRepo,
    idGenerator,
    marketplaceAccountRepo,
    olxPublicationQuotaService,
    { sandboxMode: env.marketplaces.olx.adapterMode !== 'real' }
  );
  const syncMarketplaceUC = new SyncMarketplaceUseCase(marketplaceRepo, listingRepo, syncQueue);
  const marketplaceUpdateEnqueuer = new MarketplaceUpdateEnqueuer(
    listingRepo,
    marketplaceRepo,
    publishQueue,
    idGenerator,
    marketplaceAccountRepo
  );
  const priceChangeService = new PriceChangeService(
    productRepo,
    listingRepo,
    priceHistoryRepo,
    marketplaceUpdateEnqueuer,
    idGenerator
  );
  const updateProductUC = new UpdateProductUseCase(productRepo, eventPublisher, (work) =>
    withPoolTransaction(pool, (client) => work(new ProductRepository(pool, client))),
    undefined,
    priceChangeService
  );
  const approveEventUC = new ApproveHermesEventUseCase(
    eventRepo,
    productRepo,
    listingRepo,
    marketplaceRepo,
    activityLogRepo,
    priceHistoryRepo,
    publishQueue,
    eventPublisher,
    idGenerator,
    priceChangeService,
    marketplaceUpdateEnqueuer,
    marketplaceAccountRepo,
    olxPublicationQuotaService
  );
  const dismissEventUC = new DismissHermesEventUseCase(
    eventRepo,
    activityLogRepo,
    eventPublisher,
    idGenerator
  );

  // 8. Application services (the facades buildApp consumes). One image storage
  //    serves uploads and the cleanup after a product delete, so both share its
  //    per-workspace lock.
  const productImageStorage = new FilesystemProductImageStorage(
    path.resolve(process.cwd(), env.upload.uploadDir),
    randomUUID,
    {
      maxWorkspaceBytes: env.upload.maxWorkspaceBytes,
      maxWorkspaceFiles: env.upload.maxWorkspaceFiles,
    }
  );
  const productService = new ProductApplicationService(
    productRepo,
    createProductUC,
    updateProductUC,
    listingRepo,
    productImageStorage,
    overrides.logger
  );
  const productAIDraftService = new ProductAIDraftService(aiProvider, overrides.logger);
  const productRecheckService = new ProductRecheckService(
    productRepo,
    listingRepo,
    marketplaceRepo,
    marketplaceAccountRepo,
    activityLogRepo,
    olxTaxonomyResolver,
    idGenerator
  );
  const productAssistanceGraph = new ProductAssistanceGraph(
    productAIDraftService,
    productRepo,
    listingRepo,
    marketplaceRepo,
    priceResearchRepo,
    aiProvider,
    undefined,
    { logger: overrides.logger }
  );
  const saleVerdictRepo = new SaleVerdictRepository(pool);
  const listingSeoProposals = new ListingSeoProposals({
    events: eventRepo,
    ai: aiProvider,
    idFactory: idGenerator,
  });
  const saleVerdictGraph = new SaleVerdictGraph({
    products: productRepo,
    listings: listingRepo,
    marketplaces: marketplaceRepo,
    workspaces: workspaceRepo,
    verdicts: saleVerdictRepo,
    checks: {
      info: buildInfoCheck({ recheck: productRecheckService, seo: listingSeoProposals, logger: overrides.logger }),
      price: buildPriceCheck({
        proposals: priceProposals,
        research: priceResearchRepo,
        runs: priceResearchRuns,
        recorded: new RecordedResearchRun({
          runs: priceResearchRunRepo,
          graph: priceResearchGraph,
          events: eventPublisher,
          now: () => new Date(),
          logger: overrides.logger,
        }),
        verdicts: saleVerdictRepo,
        configured: researchConfig !== null,
        newId: idGenerator,
      }),
      photos: buildPhotosCheck(),
    },
    now: () => new Date(),
    logger: overrides.logger,
  });
  const saleVerdictRuns = new SaleVerdictRuns({
    products: productRepo,
    listings: listingRepo,
    marketplaces: marketplaceRepo,
    workspaces: workspaceRepo,
    verdicts: saleVerdictRepo,
    researchRuns: priceResearchRunRepo,
    queue: saleVerdictQueue,
    recheck: productRecheckService,
    infoCheckFor: (recheck) => buildInfoCheck({ recheck, seo: listingSeoProposals, logger: overrides.logger }),
    newId: idGenerator,
    now: () => new Date(),
    logger: overrides.logger,
  });
  const listingService = new ListingApplicationService(
    listingRepo,
    publishListingUC,
    syncMarketplaceUC,
    productRepo
  );
  const hermesService = new HermesApplicationService(
    eventRepo,
    approveEventUC,
    dismissEventUC
  );
  const analyticsEventRepo = new AnalyticsEventRepository(pool);
  const productStatsService = new ProductStatsService({
    products: productRepo,
    listings: listingRepo,
    marketplaces: marketplaceRepo,
    analytics: analyticsEventRepo,
    awaitingReplyCounts: (workspaceId) =>
      new ConversationRepository(pool).awaitingReplyCounts(workspaceId),
  });
  const hermesQueryConfig = loadHermesConfig();
  const listingResponseRunRepo = new ListingResponseRunRepository(pool);
  const listingResponseGraph = new ListingResponseGraph({
    products: productRepo,
    listings: listingRepo,
    marketplaces: marketplaceRepo,
    analytics: analyticsEventRepo,
    verdicts: saleVerdictRepo,
    runs: listingResponseRunRepo,
    queryClient: new HermesHealthProbe(hermesQueryConfig).isConfigured()
      ? new HermesCompletionClient(hermesQueryConfig, aiUsageSink)
      : null,
    search: new OlxSearchPageClient({ baseUrl: loadOlxSearchBaseUrl() }),
    maxPages: MAX_PAGES,
    now: () => new Date(),
    logger: overrides.logger,
  });
  const listingResponseRuns = new ListingResponseRuns({
    products: productRepo,
    listings: listingRepo,
    marketplaces: marketplaceRepo,
    runs: listingResponseRunRepo,
    queue: listingResponseQueue,
    newId: idGenerator,
    now: () => new Date(),
    logger: overrides.logger,
  });
  const analyticsService = new AnalyticsApplicationService(
    productRepo,
    listingRepo,
    marketplaceRepo,
    analyticsEventRepo
  );
  const categoryCorrectionOperationService = new CategoryCorrectionOperationService(
    categoryCorrectionOperationRepo,
    eventRepo,
    listingRepo,
    productRepo,
    marketplaceRepo,
    marketplaceAccountRepo,
    olxPublicationQuotaService,
    {
      resolve: async (marketplace, expectedAccount) => {
        if (env.marketplaces.olx.adapterMode !== 'real')
          return adapterFactory.create(marketplace.key);
        const accessToken = await marketplaceOAuthService.getValidAccessToken(
          marketplace.id,
          expectedAccount
        );
        return adapterFactory.create(
          marketplace.key,
          new FetchMarketplaceHttpClient({
            logger: overrides.logger,
            defaultHeaders: buildOlxHeaders(accessToken),
            timeoutMs: env.marketplaces.olx.requestTimeoutMs,
            livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
          })
        );
      },
    },
    activityLogRepo,
    idGenerator,
    publishAttemptRepo
  );
  // Authenticated OLX adapter for actions on an existing advert; creating adverts stays blocked.
  const existingAdvertAdapters = {
    resolve: async (marketplace: Marketplace) => {
      const accessToken = await marketplaceOAuthService.getValidAccessToken(marketplace.id);
      return adapterFactory.create(
        marketplace.key,
        new FetchMarketplaceHttpClient({
          logger: overrides.logger,
          defaultHeaders: buildOlxHeaders(accessToken),
          timeoutMs: env.marketplaces.olx.requestTimeoutMs,
          livePublishEnabled: false,
        })
      );
    },
  };
  const listingReactivationService = new ListingReactivationService({
    listingRepo,
    marketplaceRepo,
    productRepo,
    activityLog: activityLogRepo,
    idGenerator,
    sandboxMode: env.marketplaces.olx.adapterMode !== 'real',
    logger: overrides.logger,
    adapters: existingAdvertAdapters,
  });
  const listingRevivalService = new ListingRevivalService({
    listingRepo,
    productRepo,
    marketplaceRepo,
    runInTransaction: (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          productRepo: new ProductRepository(pool, client),
          listingRepo: new ListingRepository(pool, client),
          priceHistory: new PriceHistoryRepository(pool, client),
        })
      ),
    adapters: existingAdvertAdapters,
    reactivation: listingReactivationService,
    activityLog: activityLogRepo,
    idGenerator,
    sandboxMode: env.marketplaces.olx.adapterMode !== 'real',
    logger: overrides.logger,
  });
  const productCategorySyncService = new ProductCategorySyncService(
    (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          productRepo: new ProductRepository(pool, client),
          listingRepo: new ListingRepository(pool, client),
          marketplaceRepo: new MarketplaceRepository(pool, client),
          activityLog: new ActivityLogRepository(pool, client),
          eventRepo: new EventRepository(pool, client),
        })
      ),
    idGenerator
  );
  const marketplaceImportService = new MarketplaceImportService(
    marketplaceRepo,
    productRepo,
    listingRepo,
    marketplaceAccountRepo,
    adapterFactory,
    marketplaceOAuthService,
    (accessToken) =>
      new FetchMarketplaceHttpClient({
        logger: overrides.logger,
        defaultHeaders: buildOlxHeaders(accessToken),
        timeoutMs: env.marketplaces.olx.requestTimeoutMs,
        livePublishEnabled: false,
      }),
    activityLogRepo,
    idGenerator,
    (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          productRepo: new ProductRepository(pool, client),
          listingRepo: new ListingRepository(pool, client),
          marketplaceRepo: new MarketplaceRepository(pool, client),
          activityLog: new ActivityLogRepository(pool, client),
          eventRepo: new EventRepository(pool, client),
          correctionOperations: new CategoryCorrectionOperationRepository(pool, client),
          accountRepo: new MarketplaceAccountRepository(pool, client),
        })
      ),
    eventRepo,
    categoryCorrectionOperationRepo,
    productCategorySyncService
  );

  // 9. Register job handlers now that their collaborators exist. The publish
  //    handler is given the domain ListingService so a successful adapter publish
  //    finalizes the listing (status -> live, marketplaceListingId, publishedAt)
  //    and records the canonical `listing.published` event.
  const publishHandler = new PublishListingHandler(
    adapterFactory,
    eventPublisher,
    listingDomainService,
    env.marketplaces.olx.adapterMode === 'real' ? marketplaceOAuthService : undefined,
    env.marketplaces.olx.adapterMode === 'real'
      ? (accessToken) =>
          new FetchMarketplaceHttpClient({
            logger: overrides.logger,
            defaultHeaders: buildOlxHeaders(accessToken),
            timeoutMs: env.marketplaces.olx.requestTimeoutMs,
            livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
          })
      : undefined,
    publishAttemptRepo,
    olxPublicationQuotaService
  );
  publishQueue.registerHandler((data) => publishHandler.handle(data));

  // Conversation failures carry ids and a fixed code only: buyer text must never reach a log.
  const warnByCode = (message: string, failure: Record<string, string>): void => {
    if (overrides.logger) overrides.logger.warn(failure, message);
    else console.warn(message, failure);
  };
  // Each thread is stored in its own transaction; unanswered buyer messages queue reply runs.
  const conversationSync = new ConversationSyncService({
    inTransaction: (work) =>
      withPoolTransaction(pool, (client) => work(new ConversationRepository(pool, client))),
    products: productRepo,
    replyQueue: conversationReplyQueue,
    now: () => new Date(),
    maxMessageAgeDays: env.replies.maxMessageAgeDays,
    onThreadFailure: (failure) => warnByCode(CONVERSATION_SYNC_FAILURE_MESSAGE, failure),
  });
  // The sync handler persists fetched listing stats and updates the marketplace
  // lastSyncAt/errorCount via the injected repositories (C5).
  const syncHandler = new SyncMarketplaceHandler(adapterFactory, {
    listingStore: listingRepo,
    conversationSync,
    onConversationSyncFailure: (failure) => warnByCode(CONVERSATION_SYNC_FAILURE_MESSAGE, failure),
    marketplaceStore: marketplaceRepo,
    accessTokens: env.marketplaces.olx.adapterMode === 'real' ? marketplaceOAuthService : undefined,
    authenticatedHttpClient:
      env.marketplaces.olx.adapterMode === 'real'
        ? (accessToken) =>
            new FetchMarketplaceHttpClient({
              logger: overrides.logger,
              defaultHeaders: buildOlxHeaders(accessToken),
              timeoutMs: env.marketplaces.olx.requestTimeoutMs,
              livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
            })
        : undefined,
    eventPublisher,
    recommendCategoryMismatch: (input) =>
      marketplaceImportService.recommendSyncedCategoryMismatch(input),
    persistAndReconcileProductCategories: async ({
      marketplace,
      listings,
      expectedUpdatedAt,
      mismatchCandidates,
      marketplaceAccount,
      analyticsEvents,
      job,
    }) => {
      await withPoolTransaction(pool, async (client) => {
        const repositories = {
          productRepo: new ProductRepository(pool, client),
          listingRepo: new ListingRepository(pool, client),
          marketplaceRepo: new MarketplaceRepository(pool, client),
          activityLog: new ActivityLogRepository(pool, client),
          eventRepo: new EventRepository(pool, client),
          correctionOperations: new CategoryCorrectionOperationRepository(pool, client),
          accountRepo: new MarketplaceAccountRepository(pool, client),
          analyticsEvents: new AnalyticsEventRepository(pool, client),
        };
        const productIds = [...new Set(listings.map((listing) => listing.productId))].sort();
        for (const productId of productIds) {
          const product = await repositories.productRepo.findByIdForWorkspaceForUpdate(
            productId,
            marketplace.workspaceId
          );
          if (!product) throw new Error(`Product not found for synchronized listing: ${productId}`);
          const activated = activateDraftWithLiveListing(product, listings);
          if (activated.isErr()) throw activated.error;
          if (activated.value) await repositories.productRepo.save(product);
        }
        await repositories.listingRepo.saveAllIfUnchanged(listings, expectedUpdatedAt);
        if (mismatchCandidates.length > 0 && !marketplaceAccount) {
          throw new InvalidStateError(
            'Marketplace account binding is required before category reconciliation'
          );
        }
        const analyticsRecords = await Promise.all(
          analyticsEvents.map(async (event) => {
            const product =
              event.eventType === 'sale'
                ? await repositories.productRepo.findByIdForWorkspace(
                    event.listing.productId,
                    marketplace.workspaceId
                  )
                : null;
            return {
              idempotencyKey: `${marketplace.workspaceId}:${event.idempotencyKey}`,
              workspaceId: marketplace.workspaceId,
              listingId: event.listing.id,
              marketplaceId: event.listing.marketplaceId,
              eventType: event.eventType,
              quantity: event.quantity,
              amount:
                event.eventType === 'sale' ? event.listing.price.amount * event.quantity : null,
              costAtSale:
                event.eventType === 'sale' && product?.costPrice ? product.costPrice.amount : null,
              currency: event.eventType === 'sale' ? event.listing.price.currency : null,
              occurredAt: event.occurredAt,
            };
          })
        );
        await repositories.analyticsEvents.appendMany(analyticsRecords);
        for (const candidate of mismatchCandidates) {
          await marketplaceImportService.recommendSyncedCategoryMismatch(
            {
              ...candidate,
              workspaceId: marketplace.workspaceId,
              marketplaceAccount: marketplaceAccount!,
            },
            repositories
          );
        }
        for (const listing of selectProductCategoryTriggerListings(listings)) {
          await productCategorySyncService.reconcileWithRepositories(
            {
              workspaceId: marketplace.workspaceId,
              listingId: listing.id,
              trigger: job.trigger ?? 'scheduled',
              actorId: job.actorId,
            },
            repositories
          );
        }
      });
    },
  });
  syncQueue.registerHandler((data) => syncHandler.handle(data));

  const replyHandler = new ConversationReplyHandler(
    () =>
      new ConversationReplyGraph({
        conversations: new ReplyGraphConversationRepository(pool),
        products: productRepo,
        ai: replyDraftAI,
        limits: {
          dailyRunCap: env.replies.dailyRunCap,
          historyMessages: env.replies.historyMessages,
          repeatThreshold: env.replies.spamRepeatThreshold,
          floodPerHour: env.replies.floodPerHour,
        },
        now: () => new Date(),
      }),
    (failure) => warnByCode(CONVERSATION_REPLY_DROPPED_MESSAGE, failure)
  );
  conversationReplyQueue.registerHandler((data) => replyHandler.handle(data));

  const saleVerdictHandler = new SaleVerdictHandler({
    verdicts: saleVerdictRepo,
    graph: saleVerdictGraph,
    now: () => new Date(),
    logger: overrides.logger,
  });
  saleVerdictQueue.registerHandler((data) => saleVerdictHandler.handle(data));

  const listingResponseHandler = new ListingResponseHandler({
    runs: listingResponseRunRepo,
    graph: listingResponseGraph,
    now: () => new Date(),
    logger: overrides.logger,
  });
  listingResponseQueue.registerHandler((data) => listingResponseHandler.handle(data));

  const conversationRetention = new ConversationRetentionService(new ConversationRepository(pool));
  conversationRetentionQueue.registerHandler(() => conversationRetention.purge(new Date()));
  void conversationRetentionQueue
    .scheduleRepeat({}, { jobId: CONVERSATION_RETENTION_JOB_ID, everyMs: CONVERSATION_RETENTION_EVERY_MS })
    .catch((error: unknown) => {
      console.warn(
        'Conversation retention could not be scheduled',
        error instanceof Error ? error.message : String(error)
      );
    });

  // Sending uses the workspace's OLX connection in real mode and the stub threads otherwise.
  const replySendService = new ReplySendService({
    conversations: new ConversationRepository(pool),
    inTransaction: (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          conversations: new ConversationRepository(pool, client),
          activityLog: new ActivityLogRepository(pool, client),
        })
      ),
    products: productRepo,
    listings: listingRepo,
    marketplaces: marketplaceRepo,
    adapters: {
      resolve: async (marketplace) => {
        if (env.marketplaces.olx.adapterMode !== 'real') return adapterFactory.create(marketplace.key);
        const accessToken = await marketplaceOAuthService.getValidAccessToken(marketplace.id);
        return adapterFactory.create(
          marketplace.key,
          new FetchMarketplaceHttpClient({
            logger: overrides.logger,
            defaultHeaders: buildOlxHeaders(accessToken),
            timeoutMs: env.marketplaces.olx.requestTimeoutMs,
            livePublishEnabled: false,
          })
        );
      },
    },
    replyQueue: conversationReplyQueue,
    dailyRunCap: env.replies.dailyRunCap,
    sendingInFlightMs: sendingInFlightWindowMs(env.marketplaces.olx.requestTimeoutMs),
    idGenerator,
    now: () => new Date(),
    onReplyQueueFailure: (failure) => warnByCode(CONVERSATION_REPLY_ENQUEUE_FAILED_MESSAGE, failure),
  });

  const hermesLimitsReader = new HermesLimitsReader(env.hermes.usageFile);

  // 10. Assemble AppDeps.
  const deps: AppDeps = {
    productService,
    productAIDraftService,
    productRecheckService,
    productAssistanceGraph,
    productImageUploadService: new ProductImageUploadService(
      productImageStorage,
      env.upload.maxFileSize
    ),
    listingService,
    hermesService,
    hermesStatus: () => aiProviderSelector.status(),
    replyDraftAI,
    conversationRepo: new ConversationRepository(pool),
    replySendService,
    aiUsageReport: async (workspaceId) => {
      const workspace = await workspaceRepo.findById(workspaceId);
      if (!workspace) throw new NotFoundError('Workspace not found');
      return aiUsageRepo.summary(workspaceId, workspace.timezone, new Date());
    },
    hermesLimits: () => hermesLimitsReader.read(new Date()),
    analyticsService,
    productRepo,
    priceResearchRepo,
    priceResearchRuns,
    researchConfigured: researchConfig !== null,
    saleVerdictRuns,
    listingResponseRuns,
    productStatsService,
    listingRepo,
    marketplaceRepo,
    marketplaceOAuthService,
    marketplaceSyncScheduler,
    marketplaceImportService,
    olxTaxonomyResolver,
    olxPublicationQuotaService,
    categoryCorrectionOperationService,
    listingReactivationService,
    listingRevivalService,
    marketplaceOAuthReturnUrl: env.marketplaces.olx.oauthSuccessUrl,
    olxAdapterMode: env.marketplaces.olx.adapterMode,
    workspaceRepo,
    settingsRepo,
    authUserStore,
    priceHistoryReader: priceHistoryRepo,
    priceHistoryRecorder: priceHistoryRepo,
    priceChangeService,
    idGenerator,
    logger: overrides.logger,
    requestLogger: overrides.logger,
    runRecorder: overrides.runRecorder ?? noopRunRecorder,
  };

  const queues: ManagedQueue<unknown>[] = [
    publishQueue as ManagedQueue<unknown>,
    syncQueue as ManagedQueue<unknown>,
    conversationRetentionQueue as ManagedQueue<unknown>,
    conversationReplyQueue as ManagedQueue<unknown>,
    saleVerdictQueue as ManagedQueue<unknown>,
    listingResponseQueue as ManagedQueue<unknown>,
  ];

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled(queues.map((q) => q.close()));
    await Promise.allSettled([
      typeof (redis as { quit?: () => Promise<unknown> }).quit === 'function'
        ? (redis as unknown as { quit: () => Promise<unknown> }).quit()
        : Promise.resolve(),
      typeof (pool as { end?: () => Promise<unknown> }).end === 'function'
        ? (pool as unknown as { end: () => Promise<unknown> }).end()
        : Promise.resolve(),
    ]);
  };

  return {
    deps,
    pool,
    redis,
    queues,
    shutdown,
  };
}
