import { Marketplace } from '../../domain/entities/Marketplace';
import { InMemoryMarketplaceRepository, unwrap } from '../../domain/testkit/support';
import {
  MarketplaceOAuthService,
  type MarketplaceAccountRecord,
  type MarketplaceAccountWrite,
  type MarketplaceAppCredentialRecord,
  type MarketplaceOAuthServiceDeps,
  type OlxOAuthAppCredentials,
  type OlxOAuthTokens,
} from '../services/MarketplaceOAuthService';

class InMemoryAccountRepository {
  readonly accounts = new Map<string, MarketplaceAccountRecord>();

  async findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAccountRecord | null> {
    return this.accounts.get(marketplaceId) ?? null;
  }

  async upsert(input: MarketplaceAccountWrite) {
    const current = this.accounts.get(input.marketplaceId);
    const now = new Date('2026-07-14T12:00:00.000Z');
    const account: MarketplaceAccountRecord = {
      ...input,
      revision: (current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.accounts.set(input.marketplaceId, account);
    return account;
  }

  async updateConnectedIfUnchanged(
    input: MarketplaceAccountWrite,
    expectedRevision: number
  ): Promise<MarketplaceAccountRecord | null> {
    const current = this.accounts.get(input.marketplaceId);
    if (
      !current ||
      current.status !== 'connected' ||
      current.revision !== expectedRevision
    ) {
      return null;
    }
    return this.upsert(input);
  }
}

class InMemoryAppCredentialRepository {
  readonly credentials = new Map<string, MarketplaceAppCredentialRecord>();

  async findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAppCredentialRecord | null> {
    return this.credentials.get(marketplaceId) ?? null;
  }

  async upsert(input: Omit<MarketplaceAppCredentialRecord, 'createdAt' | 'updatedAt'>) {
    const current = this.credentials.get(input.marketplaceId);
    const now = new Date('2026-07-14T12:00:00.000Z');
    const saved: MarketplaceAppCredentialRecord = {
      ...input,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.credentials.set(input.marketplaceId, saved);
    return saved;
  }

  async deleteByMarketplaceId(marketplaceId: string): Promise<void> {
    this.credentials.delete(marketplaceId);
  }
}

class InMemoryStateStore {
  readonly values = new Map<
    string,
    Parameters<MarketplaceOAuthServiceDeps['stateStore']['save']>[1]
  >();

  async save(
    state: string,
    context: Parameters<MarketplaceOAuthServiceDeps['stateStore']['save']>[1]
  ) {
    this.values.set(state, context);
  }

  async consume(state: string) {
    const value = this.values.get(state) ?? null;
    this.values.delete(state);
    return value;
  }
}

const initialTokens: OlxOAuthTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
  scopes: ['basic', 'write'],
  expiresAt: new Date('2026-07-14T13:00:00.000Z'),
};

function setup(
  refreshLock?: MarketplaceOAuthServiceDeps['refreshLock'],
  sandbox?: MarketplaceOAuthServiceDeps['sandbox']
) {
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const marketplace = unwrap(
    Marketplace.create({
      id: 'marketplace-olx',
      workspaceId: 'ws-1',
      key: 'olx',
      name: 'OLX',
      connected: false,
    })
  );
  marketplaceRepo.items.set(marketplace.id, marketplace);

  const accountRepo = new InMemoryAccountRepository();
  const appCredentialRepo = new InMemoryAppCredentialRepository();
  appCredentialRepo.credentials.set(marketplace.id, {
    id: 'app-credentials-1',
    marketplaceId: marketplace.id,
    clientId: 'workspace-client-id',
    encryptedClientSecret: { appPayload: { clientId: 'workspace-client-id', clientSecret: 'workspace-secret' } },
    createdAt: new Date('2026-07-14T12:00:00.000Z'),
    updatedAt: new Date('2026-07-14T12:00:00.000Z'),
  });
  const stateStore = new InMemoryStateStore();
  const exchangeAuthorizationCode = jest.fn(async () => initialTokens);
  const refreshAccessToken = jest.fn(async () => ({
    ...initialTokens,
    accessToken: 'refreshed-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: new Date('2026-07-14T14:00:00.000Z'),
  }));
  const oauthClient = {
    buildAuthorizationUrl: jest.fn(
      (state: string) => `https://www.olx.pl/oauth/authorize?state=${state}`
    ),
    exchangeAuthorizationCode,
    refreshAccessToken,
  };
  const oauthClientFactory = jest.fn((_credentials: OlxOAuthAppCredentials) => oauthClient);
  const vault = {
    encrypt: jest.fn((tokens: OlxOAuthTokens) => ({ payload: tokens })),
    decrypt: jest.fn((envelope: Record<string, unknown>) => envelope.payload as OlxOAuthTokens),
    encryptAppCredentials: jest.fn((credentials: OlxOAuthAppCredentials) => ({ appPayload: credentials })),
    decryptAppCredentials: jest.fn(
      (envelope: Record<string, unknown>) => envelope.appPayload as OlxOAuthAppCredentials
    ),
  };
  let nonce = 0;
  const deps: MarketplaceOAuthServiceDeps = {
    marketplaceRepo,
    accountRepo,
    appCredentialRepo,
    stateStore,
    oauthClientFactory,
    credentialVault: vault,
    refreshLock,
    idGenerator: () => `account-${++nonce}`,
    stateGenerator: () => 'oauth-state',
    now: () => new Date('2026-07-14T12:00:00.000Z'),
    stateTtlSeconds: 600,
    sandbox,
  };
  const service = new MarketplaceOAuthService(deps);

  return {
    service,
    deps,
    marketplaceRepo,
    marketplace,
    accountRepo,
    appCredentialRepo,
    stateStore,
    oauthClient,
    oauthClientFactory,
    exchangeAuthorizationCode,
    refreshAccessToken,
  };
}

describe('MarketplaceOAuthService', () => {
  it('starts OLX OAuth without marking the marketplace connected', async () => {
    const { service, marketplace, stateStore, oauthClientFactory } = setup();

    const result = await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    expect(result.authorizationUrl).toContain('https://www.olx.pl/oauth/authorize');
    expect(result.state).toBe('oauth-state');
    expect(stateStore.values.get('oauth-state')).toMatchObject({
      marketplaceId: marketplace.id,
      workspaceId: 'ws-1',
      providerKey: 'olx',
      appCredentialRevision: '2026-07-14T12:00:00.000Z',
    });
    expect(oauthClientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'workspace-client-id',
        clientSecret: 'workspace-secret',
      })
    );
    expect(marketplace.isConnected()).toBe(false);
  });

  it('requires workspace OLX application credentials before starting OAuth', async () => {
    const { service, marketplace, appCredentialRepo, stateStore, oauthClientFactory, oauthClient } = setup();
    appCredentialRepo.credentials.delete(marketplace.id);

    await expect(service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' })).rejects.toThrow(
      'OLX application credentials are not configured for this workspace'
    );
    expect(stateStore.values.size).toBe(0);
    expect(oauthClientFactory).not.toHaveBeenCalled();
    expect(oauthClient.buildAuthorizationUrl).not.toHaveBeenCalled();
    expect(oauthClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(oauthClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('consumes state once, persists encrypted tokens, then marks OLX connected', async () => {
    const { service, marketplace, marketplaceRepo, accountRepo } = setup();
    await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    const completed = await service.complete({
      providerKey: 'olx',
      code: 'authorization-code',
      state: 'oauth-state',
    });

    expect(completed.connected).toBe(true);
    expect(completed.account.status).toBe('connected');
    expect(completed.account.scopes).toEqual(['basic', 'write']);
    expect(accountRepo.accounts.get(marketplace.id)?.credentials).toEqual({
      payload: initialTokens,
    });
    expect((await marketplaceRepo.findById(marketplace.id))?.isConnected()).toBe(true);
    await expect(
      service.complete({ providerKey: 'olx', code: 'again', state: 'oauth-state' })
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects callback when OLX app credentials rotated after authorization started', async () => {
    const { service, marketplace, appCredentialRepo, oauthClient } = setup();
    await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
    const saved = appCredentialRepo.credentials.get(marketplace.id)!;
    appCredentialRepo.credentials.set(marketplace.id, {
      ...saved,
      clientId: 'rotated-client-id',
      encryptedClientSecret: {
        appPayload: { clientId: 'rotated-client-id', clientSecret: 'rotated-secret' },
      },
      updatedAt: new Date('2026-07-14T12:05:00.000Z'),
    });

    await expect(
      service.complete({ providerKey: 'olx', code: 'authorization-code', state: 'oauth-state' })
    ).rejects.toThrow('OLX application credentials changed while authorization was pending');
    expect(oauthClient.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('reports app-authoritative connection state without exposing credentials', async () => {
    const { service, marketplace } = setup();
    await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
    await service.complete({
      providerKey: 'olx',
      code: 'authorization-code',
      state: 'oauth-state',
    });

    const status = await service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    expect(status).toMatchObject({
      connected: true,
      marketplaceId: marketplace.id,
      providerKey: 'olx',
      account: { handle: 'OLX account', status: 'connected' },
      tokenExpiresAt: '2026-07-14T13:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('access-token');
    expect(JSON.stringify(status)).not.toContain('refresh-token');
  });

  it('refreshes an expired access token and persists refresh-token rotation', async () => {
    const { service, marketplace, accountRepo, refreshAccessToken, oauthClientFactory } = setup();
    await accountRepo.upsert({
      id: 'account-1',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: {
          ...initialTokens,
          expiresAt: new Date('2026-07-14T11:59:00.000Z'),
        },
      },
      status: 'connected',
      scopes: ['basic'],
    });

    const accessToken = await service.getValidAccessToken(marketplace.id);

    expect(accessToken).toBe('refreshed-access-token');
    expect(refreshAccessToken).toHaveBeenCalledWith('refresh-token');
    expect(oauthClientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'workspace-client-id',
        clientSecret: 'workspace-secret',
      })
    );
    const saved = accountRepo.accounts.get(marketplace.id)!;
    const savedTokens = saved.credentials.payload as OlxOAuthTokens;
    expect(savedTokens.refreshToken).toBe('rotated-refresh-token');
  });

  it('returns the persisted account revision with a refreshed access token', async () => {
    const { service, marketplace, accountRepo } = setup();
    const beforeRefresh = await accountRepo.upsert({
      id: 'account-1',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: {
          ...initialTokens,
          expiresAt: new Date('2026-07-14T11:59:00.000Z'),
        },
      },
      status: 'connected',
      scopes: ['basic'],
    });

    const resolved = await service.getValidAccessTokenContext(marketplace.id);

    expect(resolved).toEqual({
      accessToken: 'refreshed-access-token',
      account: { id: beforeRefresh.id, revision: beforeRefresh.revision + 1 },
    });
    expect(accountRepo.accounts.get(marketplace.id)?.revision).toBe(resolved.account.revision);
  });

  it('rejects access-token resolution when the reviewed account identity changed', async () => {
    const { service, marketplace, accountRepo, refreshAccessToken } = setup();
    await accountRepo.upsert({
      id: 'account-2',
      marketplaceId: marketplace.id,
      handle: 'Different OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });

    await expect(service.getValidAccessToken(marketplace.id, {
      id: 'account-1',
      revision: 1,
    })).rejects.toThrow(
      'OLX account changed after the operation was reviewed'
    );
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('rejects access-token resolution when the reviewed account revision changed', async () => {
    const { service, marketplace, accountRepo, refreshAccessToken } = setup();
    const reviewed = await accountRepo.upsert({
      id: 'account-1',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });
    await accountRepo.upsert({
      id: reviewed.id,
      marketplaceId: marketplace.id,
      handle: 'Reconnected OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });

    await expect(service.getValidAccessToken(marketplace.id, {
      id: reviewed.id,
      revision: reviewed.revision,
    })).rejects.toThrow('OLX account changed after the operation was reviewed');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('rechecks the reviewed account identity after acquiring the refresh lock', async () => {
    let accountRepo: InMemoryAccountRepository;
    const refreshLock = {
      withLock: jest.fn(async (_marketplaceId: string, work: () => Promise<string>) => {
        await accountRepo.upsert({
          id: 'account-2',
          marketplaceId: 'marketplace-olx',
          handle: 'Reconnected OLX account',
          credentials: { payload: initialTokens },
          status: 'connected',
          scopes: ['basic'],
        });
        return work();
      }),
    };
    const context = setup(refreshLock);
    accountRepo = context.accountRepo;
    const reviewed = await accountRepo.upsert({
      id: 'account-1',
      marketplaceId: context.marketplace.id,
      handle: 'Reviewed OLX account',
      credentials: {
        payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:00:00.000Z') },
      },
      status: 'connected',
      scopes: ['basic'],
    });

    await expect(context.service.getValidAccessToken(context.marketplace.id, {
      id: reviewed.id,
      revision: reviewed.revision,
    })).rejects.toThrow('OLX account changed after the operation was reviewed');
    expect(context.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a genuinely stale account revision after a concurrent write', async () => {
    const { marketplace, accountRepo } = setup();
    const original = await accountRepo.upsert({
      id: 'account-stale-revision',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });
    const concurrent = await accountRepo.upsert({
      id: original.id,
      marketplaceId: marketplace.id,
      handle: original.handle,
      credentials: { payload: { ...initialTokens, accessToken: 'concurrent-token' } },
      status: 'connected',
      scopes: original.scopes,
    });

    const saved = await accountRepo.updateConnectedIfUnchanged(
      {
        id: original.id,
        marketplaceId: marketplace.id,
        handle: original.handle,
        credentials: { payload: { ...initialTokens, accessToken: 'stale-token' } },
        status: 'connected',
        scopes: original.scopes,
      },
      original.revision
    );

    expect(saved).toBeNull();
    expect(accountRepo.accounts.get(marketplace.id)).toEqual(concurrent);
  });

  it('does not refresh when workspace app credentials are missing', async () => {
    const { service, marketplace, accountRepo, appCredentialRepo, oauthClientFactory, refreshAccessToken } = setup();
    await accountRepo.upsert({
      id: 'account-missing-app-credentials',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:59:00.000Z') },
      },
      status: 'connected',
      scopes: ['basic'],
    });
    appCredentialRepo.credentials.delete(marketplace.id);

    await expect(service.getValidAccessToken(marketplace.id)).rejects.toThrow(
      'OLX application credentials are not configured for this workspace'
    );
    expect(oauthClientFactory).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('does not resurrect credentials when the account changes before refresh persistence', async () => {
    const { service, marketplace, accountRepo } = setup();
    await accountRepo.upsert({
      id: 'account-cas',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:59:00.000Z') },
      },
      status: 'connected',
      scopes: ['basic'],
    });
    jest.spyOn(accountRepo, 'updateConnectedIfUnchanged').mockImplementationOnce(async () => {
      const current = accountRepo.accounts.get(marketplace.id)!;
      await accountRepo.upsert({
        ...current,
        credentials: {},
        status: 'disconnected',
      });
      return null;
    });

    await expect(service.getValidAccessToken(marketplace.id)).rejects.toThrow(
      'account changed while its access token was refreshing'
    );
    expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
      status: 'disconnected',
      credentials: {},
    });
  });

  it('clears stored credentials when disconnecting', async () => {
    const { service, marketplace, accountRepo } = setup();
    await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
    await service.complete({ providerKey: 'olx', code: 'code', state: 'oauth-state' });

    await service.disconnect({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
      status: 'disconnected',
      credentials: {},
    });
    const status = await service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
    expect(status.connected).toBe(false);
    expect(status.account?.status).toBe('disconnected');
  });

  it('clears existing account tokens when app credentials are rotated', async () => {
    const { service, marketplace, accountRepo, appCredentialRepo } = setup();
    marketplace.connect();
    await accountRepo.upsert({
      id: 'account-existing',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });

    const result = await service.saveAppCredentials({
      marketplaceId: marketplace.id,
      workspaceId: 'ws-1',
      clientId: 'new-client-id',
      clientSecret: 'new-secret',
    });

    expect(result).toMatchObject({ configured: true, clientId: 'new-client-id' });
    expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
      status: 'disconnected',
      credentials: {},
    });
    expect(marketplace.isConnected()).toBe(false);
    expect(appCredentialRepo.credentials.get(marketplace.id)).toMatchObject({
      clientId: 'new-client-id',
    });
  });

  it('removes app credentials only after clearing account tokens', async () => {
    const { service, marketplace, accountRepo, appCredentialRepo } = setup();
    marketplace.connect();
    await accountRepo.upsert({
      id: 'account-existing',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });

    const result = await service.removeAppCredentials({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

    expect(result).toMatchObject({ configured: false, marketplaceId: marketplace.id });
    expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
      status: 'disconnected',
      credentials: {},
    });
    expect(appCredentialRepo.credentials.has(marketplace.id)).toBe(false);
  });

  it('does not rotate app credentials when account token clearing fails', async () => {
    const { service, marketplace, accountRepo, appCredentialRepo } = setup();
    marketplace.connect();
    await accountRepo.upsert({
      id: 'account-existing',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });
    const originalAccount = accountRepo.accounts.get(marketplace.id)!;
    const originalAppCredentials = appCredentialRepo.credentials.get(marketplace.id)!;
    jest.spyOn(accountRepo, 'upsert').mockRejectedValueOnce(new Error('disconnect persistence failed'));

    await expect(
      service.saveAppCredentials({
        marketplaceId: marketplace.id,
        workspaceId: 'ws-1',
        clientId: 'new-client-id',
        clientSecret: 'new-secret',
      })
    ).rejects.toThrow('disconnect persistence failed');

    expect(accountRepo.accounts.get(marketplace.id)).toBe(originalAccount);
    expect(appCredentialRepo.credentials.get(marketplace.id)).toBe(originalAppCredentials);
  });

  it('does not remove app credentials when account token clearing fails', async () => {
    const { service, marketplace, accountRepo, appCredentialRepo } = setup();
    marketplace.connect();
    await accountRepo.upsert({
      id: 'account-existing',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: { payload: initialTokens },
      status: 'connected',
      scopes: ['basic'],
    });
    const originalAccount = accountRepo.accounts.get(marketplace.id)!;
    const originalAppCredentials = appCredentialRepo.credentials.get(marketplace.id)!;
    jest.spyOn(accountRepo, 'upsert').mockRejectedValueOnce(new Error('disconnect persistence failed'));

    await expect(
      service.removeAppCredentials({ marketplaceId: marketplace.id, workspaceId: 'ws-1' })
    ).rejects.toThrow('disconnect persistence failed');

    expect(accountRepo.accounts.get(marketplace.id)).toBe(originalAccount);
    expect(appCredentialRepo.credentials.get(marketplace.id)).toBe(originalAppCredentials);
  });

  it('re-reads credentials while holding the refresh lock', async () => {
    let accountRepo: InMemoryAccountRepository;
    const withLock = jest.fn(async (_marketplaceId: string, operation: () => Promise<string>) => {
      const current = accountRepo.accounts.get('marketplace-olx')!;
      await accountRepo.upsert({
        ...current,
        credentials: {
          payload: {
            ...initialTokens,
            accessToken: 'already-refreshed-token',
            expiresAt: new Date('2026-07-14T14:00:00.000Z'),
          },
        },
      });
      return operation();
    });
    const setupResult = setup({ withLock });
    accountRepo = setupResult.accountRepo;
    await accountRepo.upsert({
      id: 'account-1',
      marketplaceId: setupResult.marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:59:00.000Z') },
      },
      status: 'connected',
      scopes: ['basic'],
    });

    await expect(setupResult.service.getValidAccessToken(setupResult.marketplace.id)).resolves.toBe(
      'already-refreshed-token'
    );
    expect(withLock).toHaveBeenCalledWith(setupResult.marketplace.id, expect.any(Function));
    expect(setupResult.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('serializes disconnect behind an in-flight refresh so credentials stay cleared', async () => {
    let tail = Promise.resolve();
    const refreshLock: NonNullable<MarketplaceOAuthServiceDeps['refreshLock']> = {
      withLock: async (_marketplaceId, operation) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await operation({ assertOwned: async () => {} });
        } finally {
          release();
        }
      },
    };
    const { service, marketplace, accountRepo, refreshAccessToken } = setup(refreshLock);
    marketplace.connect();
    await accountRepo.upsert({
      id: 'account-race',
      marketplaceId: marketplace.id,
      handle: 'OLX account',
      credentials: {
        payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:59:00.000Z') },
      },
      status: 'connected',
      scopes: ['basic'],
    });
    let finishRefresh!: (tokens: OlxOAuthTokens) => void;
    const refreshStarted = new Promise<void>((resolveStarted) => {
      refreshAccessToken.mockImplementationOnce(
        () =>
          new Promise<OlxOAuthTokens>((resolveRefresh) => {
            finishRefresh = resolveRefresh;
            resolveStarted();
          })
      );
    });

    const refreshing = service.getValidAccessToken(marketplace.id);
    await refreshStarted;
    const disconnecting = service.disconnect({
      marketplaceId: marketplace.id,
      workspaceId: 'ws-1',
    });
    finishRefresh({
      ...initialTokens,
      accessToken: 'refreshed-access-token',
      expiresAt: new Date('2026-07-14T14:00:00.000Z'),
    });

    await refreshing;
    await disconnecting;
    expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
      status: 'disconnected',
      credentials: {},
    });
    expect(marketplace.isConnected()).toBe(false);
  });

  describe('sandbox mode', () => {
    const sandbox = { enabled: true, successUrl: 'http://localhost:3000/marketplaces' };
    const sandboxScopes = ['read', 'write', 'v2'];

    it('start() in sandbox mode connects the marketplace without app credentials and returns the success URL', async () => {
      const {
        service,
        marketplace,
        marketplaceRepo,
        accountRepo,
        appCredentialRepo,
        stateStore,
        oauthClientFactory,
      } = setup(undefined, sandbox);
      appCredentialRepo.credentials.delete(marketplace.id);

      const result = await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      expect(result).toEqual({
        authorizationUrl:
          'http://localhost:3000/marketplaces?oauth=success&marketplaceId=marketplace-olx&sandbox=1',
        state: 'sandbox',
        expiresAt: '2036-07-14T12:00:00.000Z',
        sandbox: true,
      });
      expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
        id: 'account-1',
        marketplaceId: marketplace.id,
        handle: 'OLX sandbox account',
        status: 'connected',
        scopes: sandboxScopes,
      });
      expect(accountRepo.accounts.get(marketplace.id)?.credentials).toEqual({
        payload: {
          accessToken: 'sandbox',
          tokenType: 'sandbox',
          scopes: sandboxScopes,
          expiresAt: new Date('2036-07-14T12:00:00.000Z'),
        },
      });
      expect((await marketplaceRepo.findById(marketplace.id))?.isConnected()).toBe(true);
      expect(oauthClientFactory).not.toHaveBeenCalled();
      expect(stateStore.values.size).toBe(0);
    });

    it('start() in real mode still requires app credentials', async () => {
      const { service, marketplace, accountRepo, appCredentialRepo, stateStore, oauthClientFactory } =
        setup(undefined, { ...sandbox, enabled: false });
      appCredentialRepo.credentials.delete(marketplace.id);

      await expect(service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' })).rejects.toThrow(
        'OLX application credentials are not configured for this workspace'
      );
      expect(accountRepo.accounts.size).toBe(0);
      expect(stateStore.values.size).toBe(0);
      expect(oauthClientFactory).not.toHaveBeenCalled();
      expect(marketplace.isConnected()).toBe(false);
    });

    it('start() in real mode returns the OLX authorization URL without a sandbox flag', async () => {
      const { service, marketplace } = setup(undefined, { ...sandbox, enabled: false });

      const result = await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      expect(result).toEqual({
        authorizationUrl: 'https://www.olx.pl/oauth/authorize?state=oauth-state',
        state: 'oauth-state',
        expiresAt: '2026-07-14T12:10:00.000Z',
      });
      expect(marketplace.isConnected()).toBe(false);
    });

    it('check() reports the sandbox account as a connected sandbox connection', async () => {
      const { service, marketplace } = setup(undefined, sandbox);
      await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      const status = await service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      expect(status).toEqual({
        connected: true,
        marketplaceId: marketplace.id,
        providerKey: 'olx',
        account: {
          id: 'account-1',
          handle: 'OLX sandbox account',
          status: 'connected',
          scopes: sandboxScopes,
        },
        tokenExpiresAt: '2036-07-14T12:00:00.000Z',
        refreshable: false,
        sandbox: true,
      });
    });

    it('check() does not report a real OAuth account as sandbox', async () => {
      const { service, marketplace } = setup();
      await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
      await service.complete({ providerKey: 'olx', code: 'authorization-code', state: 'oauth-state' });

      const status = await service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      expect(status.connected).toBe(true);
      expect(status.sandbox).toBe(false);
    });

    it('disconnects a sandbox account and reconnects it idempotently', async () => {
      const { service, marketplace, marketplaceRepo, accountRepo } = setup(undefined, sandbox);
      await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      await service.disconnect({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
        id: 'account-1',
        status: 'disconnected',
      });
      expect(accountRepo.accounts.get(marketplace.id)?.credentials).toEqual({});
      expect((await marketplaceRepo.findById(marketplace.id))?.isConnected()).toBe(false);
      await expect(
        service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' })
      ).resolves.toMatchObject({ connected: false, sandbox: true });

      await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });
      await service.start({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

      expect(accountRepo.accounts.size).toBe(1);
      expect(accountRepo.accounts.get(marketplace.id)).toMatchObject({
        id: 'account-1',
        handle: 'OLX sandbox account',
        status: 'connected',
      });
      expect((await marketplaceRepo.findById(marketplace.id))?.isConnected()).toBe(true);
      await expect(
        service.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' })
      ).resolves.toMatchObject({ connected: true, sandbox: true });
    });

    describe('after a switch to real mode', () => {
      const realModeError =
        'Sandbox OLX account cannot be used in real mode; disconnect and reconnect OLX';
      const sandboxCredentials = {
        payload: {
          accessToken: 'sandbox',
          tokenType: 'sandbox',
          scopes: sandboxScopes,
          expiresAt: new Date('2036-07-14T12:00:00.000Z'),
        },
      };

      // Connect in stub mode, then serve the same repositories from a real-mode service.
      async function connectedInStubModeThenReal() {
        const context = setup(undefined, sandbox);
        await context.service.start({ marketplaceId: context.marketplace.id, workspaceId: 'ws-1' });
        const realService = new MarketplaceOAuthService({
          ...context.deps,
          sandbox: { ...sandbox, enabled: false },
        });
        return { ...context, realService };
      }

      it('real mode refuses a stored sandbox token', async () => {
        const { realService, marketplace, oauthClientFactory, refreshAccessToken } =
          await connectedInStubModeThenReal();

        await expect(realService.getValidAccessToken(marketplace.id)).rejects.toThrow(realModeError);
        await expect(realService.getValidAccessTokenContext(marketplace.id)).rejects.toMatchObject({
          code: 'INVALID_STATE',
          message: realModeError,
        });
        expect(oauthClientFactory).not.toHaveBeenCalled();
        expect(refreshAccessToken).not.toHaveBeenCalled();
      });

      it('real mode refuses a sandbox-marked token even when the account handle differs', async () => {
        const { service, marketplace, accountRepo } = setup(undefined, { ...sandbox, enabled: false });
        await accountRepo.upsert({
          id: 'account-renamed',
          marketplaceId: marketplace.id,
          handle: 'Renamed account',
          credentials: sandboxCredentials,
          status: 'connected',
          scopes: sandboxScopes,
        });

        await expect(service.getValidAccessToken(marketplace.id)).rejects.toThrow(realModeError);
      });

      it('real mode refuses a sandbox account found after acquiring the refresh lock', async () => {
        let accountRepo: InMemoryAccountRepository;
        const refreshLock = {
          withLock: jest.fn(async (_marketplaceId: string, work: () => Promise<unknown>) => {
            const current = accountRepo.accounts.get('marketplace-olx')!;
            await accountRepo.upsert({
              ...current,
              handle: 'OLX sandbox account',
              credentials: sandboxCredentials,
              scopes: sandboxScopes,
            });
            return work();
          }),
        };
        const context = setup(refreshLock, { ...sandbox, enabled: false });
        accountRepo = context.accountRepo;
        await accountRepo.upsert({
          id: 'account-1',
          marketplaceId: context.marketplace.id,
          handle: 'OLX account',
          credentials: {
            payload: { ...initialTokens, expiresAt: new Date('2026-07-14T11:59:00.000Z') },
          },
          status: 'connected',
          scopes: ['basic'],
        });

        await expect(context.service.getValidAccessToken(context.marketplace.id)).rejects.toThrow(
          realModeError
        );
        expect(refreshLock.withLock).toHaveBeenCalledWith(context.marketplace.id, expect.any(Function));
        expect(context.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('real mode check() reports a sandbox account as disconnected', async () => {
        const { realService, marketplace } = await connectedInStubModeThenReal();

        const status = await realService.check({ marketplaceId: marketplace.id, workspaceId: 'ws-1' });

        expect(status).toEqual({
          connected: false,
          marketplaceId: marketplace.id,
          providerKey: 'olx',
          account: {
            id: 'account-1',
            handle: 'OLX sandbox account',
            status: 'error',
            scopes: sandboxScopes,
          },
          refreshable: false,
          sandbox: true,
        });
      });
    });
  });
});
