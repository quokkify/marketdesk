import type { MarketplaceAccountStatus, MarketplaceKey } from '../../../shared/types';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import {
  ConfigurationError,
  InvalidStateError,
  NotFoundError,
  ReconciliationRequiredError,
  ServiceUnavailableError,
  ValidationError,
} from '../../domain/shared/DomainError';

export interface OlxOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  expiresAt: Date;
  accountHandle?: string;
}

export interface MarketplaceAccountRecord {
  id: string;
  marketplaceId: string;
  handle: string;
  credentials: Record<string, unknown>;
  status: MarketplaceAccountStatus;
  scopes: string[];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export type MarketplaceAccountWrite = Omit<
  MarketplaceAccountRecord,
  'revision' | 'createdAt' | 'updatedAt'
>;

export interface MarketplaceAccountRepository {
  findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAccountRecord | null>;
  findByMarketplaceIdForUpdate?(marketplaceId: string): Promise<MarketplaceAccountRecord | null>;
  upsert(account: MarketplaceAccountWrite): Promise<MarketplaceAccountRecord>;
  updateConnectedIfUnchanged(
    account: MarketplaceAccountWrite,
    expectedRevision: number
  ): Promise<MarketplaceAccountRecord | null>;
}

export interface MarketplaceOAuthStateContext {
  marketplaceId: string;
  workspaceId: string;
  providerKey: MarketplaceKey;
  appCredentialRevision: string;
  expiresAt: Date;
}

export interface MarketplaceOAuthStateStore {
  save(state: string, context: MarketplaceOAuthStateContext): Promise<void>;
  consume(state: string): Promise<MarketplaceOAuthStateContext | null>;
}

export interface OlxOAuthClientPort {
  buildAuthorizationUrl(state: string): string;
  exchangeAuthorizationCode(code: string): Promise<OlxOAuthTokens>;
  refreshAccessToken(refreshToken: string): Promise<OlxOAuthTokens>;
}

export interface OlxOAuthAppCredentials {
  clientId: string;
  clientSecret: string;
  credentialRevision?: string;
}

export interface MarketplaceAppCredentialRecord {
  id: string;
  marketplaceId: string;
  clientId: string;
  encryptedClientSecret: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketplaceAppCredentialRepository {
  findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAppCredentialRecord | null>;
  upsert(
    credentials: Omit<MarketplaceAppCredentialRecord, 'createdAt' | 'updatedAt'>
  ): Promise<MarketplaceAppCredentialRecord>;
  deleteByMarketplaceId(marketplaceId: string): Promise<void>;
}

export interface MarketplaceCredentialVault {
  encrypt(tokens: OlxOAuthTokens): Record<string, unknown>;
  decrypt(credentials: Record<string, unknown>): OlxOAuthTokens;
  encryptAppCredentials(credentials: OlxOAuthAppCredentials): Record<string, unknown>;
  decryptAppCredentials(credentials: Record<string, unknown>): OlxOAuthAppCredentials;
}

export interface MarketplaceOAuthRefreshLock {
  withLock<T>(
    marketplaceId: string,
    operation: (lease: MarketplaceOAuthRefreshLease) => Promise<T>
  ): Promise<T>;
}

export interface MarketplaceOAuthRefreshLease {
  assertOwned(): Promise<void>;
}

export interface MarketplaceOAuthServiceDeps {
  marketplaceRepo: IMarketplaceRepository;
  accountRepo: MarketplaceAccountRepository;
  appCredentialRepo: MarketplaceAppCredentialRepository;
  stateStore: MarketplaceOAuthStateStore;
  oauthClientFactory: (credentials: OlxOAuthAppCredentials) => OlxOAuthClientPort;
  credentialVault: MarketplaceCredentialVault;
  refreshLock?: MarketplaceOAuthRefreshLock;
  idGenerator: () => string;
  stateGenerator: () => string;
  now?: () => Date;
  stateTtlSeconds?: number;
  // Enabled while the OLX adapter is not real: start() connects a labelled sandbox
  // account and returns the app's success URL instead of an OLX authorization URL.
  // While disabled, a stored sandbox account is refused instead of served as a token.
  sandbox?: { enabled: boolean; successUrl: string };
}

export interface MarketplaceOAuthStatus {
  connected: boolean;
  marketplaceId: string;
  providerKey: MarketplaceKey;
  account: {
    id: string;
    handle: string;
    status: MarketplaceAccountStatus;
    scopes: string[];
  } | null;
  tokenExpiresAt?: string;
  refreshable: boolean;
  // True when the stored account is the sandbox stand-in rather than a real OLX account.
  sandbox: boolean;
}

export interface MarketplaceResolvedAccessToken {
  accessToken: string;
  account: Pick<MarketplaceAccountRecord, 'id' | 'revision'>;
}

export interface MarketplaceOAuthStartResult {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
  sandbox?: boolean;
}

export interface MarketplaceAppCredentialStatus {
  configured: boolean;
  marketplaceId: string;
  providerKey: MarketplaceKey;
  clientId?: string;
  updatedAt?: string;
}

export interface SaveMarketplaceAppCredentialsInput {
  marketplaceId: string;
  workspaceId: string;
  clientId: string;
  clientSecret: string;
}

export interface SaveMarketplaceAppCredentialsResult extends MarketplaceAppCredentialStatus {
  configured: true;
}

function requireValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${name} is required`);
  return trimmed;
}

function normalizeTokens(tokens: OlxOAuthTokens): OlxOAuthTokens {
  return {
    ...tokens,
    accessToken: requireValue(tokens.accessToken, 'OLX access token'),
    tokenType: tokens.tokenType || 'Bearer',
    scopes: [...new Set(tokens.scopes)],
    expiresAt: tokens.expiresAt instanceof Date ? tokens.expiresAt : new Date(tokens.expiresAt),
  };
}

const REFRESH_SKEW_MS = 60_000;

const OLX_SANDBOX_ACCOUNT_HANDLE = 'OLX sandbox account';
const OLX_SANDBOX_ACCESS_TOKEN = 'sandbox';
const OLX_SANDBOX_TOKEN_TYPE = 'sandbox';
const OLX_SANDBOX_SCOPES = ['read', 'write', 'v2'];
const OLX_SANDBOX_TOKEN_LIFETIME_YEARS = 10;

export class MarketplaceOAuthService {
  private readonly now: () => Date;
  private readonly stateTtlSeconds: number;

  constructor(private readonly deps: MarketplaceOAuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.stateTtlSeconds = deps.stateTtlSeconds ?? 10 * 60;
  }

  async start(input: {
    marketplaceId: string;
    workspaceId: string;
  }): Promise<MarketplaceOAuthStartResult> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    if (this.deps.sandbox?.enabled) {
      return this.startSandbox(marketplace, this.deps.sandbox.successUrl);
    }
    const appCredentials = await this.requireAppCredentials(marketplace.id);
    const state = requireValue(this.deps.stateGenerator(), 'OAuth state');
    const expiresAt = new Date(this.now().getTime() + this.stateTtlSeconds * 1000);

    await this.deps.stateStore.save(state, {
      marketplaceId: marketplace.id,
      workspaceId: marketplace.workspaceId,
      providerKey: marketplace.key,
      appCredentialRevision: requireValue(
        appCredentials.credentialRevision ?? '',
        'OLX application credential revision'
      ),
      expiresAt,
    });

    return {
      authorizationUrl: this.deps.oauthClientFactory(appCredentials).buildAuthorizationUrl(state),
      state,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(input: {
    providerKey: string;
    code: string;
    state: string;
  }): Promise<MarketplaceOAuthStatus> {
    const code = requireValue(input.code, 'OAuth authorization code');
    const state = requireValue(input.state, 'OAuth state');
    const context = await this.deps.stateStore.consume(state);
    if (!context || context.expiresAt.getTime() <= this.now().getTime()) {
      throw new InvalidStateError('OAuth state is invalid, expired, or already used');
    }
    if (context.providerKey !== input.providerKey) {
      throw new InvalidStateError('OAuth provider does not match the pending connection');
    }

    const marketplace = await this.requireOwnedOlxMarketplace(
      context.marketplaceId,
      context.workspaceId
    );

    const appCredentials = await this.requireAppCredentials(marketplace.id);
    if (appCredentials.credentialRevision !== context.appCredentialRevision) {
      throw new InvalidStateError(
        'OLX application credentials changed while authorization was pending; start a new connection'
      );
    }

    let tokens: OlxOAuthTokens;
    try {
      tokens = normalizeTokens(
        await this.deps.oauthClientFactory(appCredentials).exchangeAuthorizationCode(code)
      );
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof InvalidStateError ||
        error instanceof ConfigurationError
      ) {
        throw error;
      }
      throw new ServiceUnavailableError('OLX token exchange failed', error);
    }

    const existing = await this.deps.accountRepo.findByMarketplaceId(marketplace.id);
    const account = await this.deps.accountRepo.upsert({
      id: existing?.id ?? this.deps.idGenerator(),
      marketplaceId: marketplace.id,
      handle: tokens.accountHandle?.trim() || existing?.handle || 'OLX account',
      credentials: this.deps.credentialVault.encrypt(tokens),
      status: 'connected',
      scopes: [...tokens.scopes],
    });

    // The local marketplace flag becomes true only after credentials were encrypted
    // and durably persisted in marketplace_accounts.
    marketplace.connect();
    await this.deps.marketplaceRepo.save(marketplace);
    return this.toStatus(
      marketplace.id,
      marketplace.key,
      marketplace.isConnected(),
      account,
      tokens
    );
  }

  async check(input: {
    marketplaceId: string;
    workspaceId: string;
  }): Promise<MarketplaceOAuthStatus> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    const account = await this.deps.accountRepo.findByMarketplaceId(marketplace.id);
    if (!account) {
      return this.toStatus(marketplace.id, marketplace.key, marketplace.isConnected(), null, null);
    }

    if (account.status !== 'connected') {
      return this.toStatus(
        marketplace.id,
        marketplace.key,
        marketplace.isConnected(),
        account,
        null
      );
    }

    try {
      const tokens = normalizeTokens(this.deps.credentialVault.decrypt(account.credentials));
      if (!this.deps.sandbox?.enabled && this.isSandboxAccount(account, tokens)) {
        // A leftover sandbox connection cannot reach real OLX: report it as needing a
        // reconnect, like unreadable credentials, instead of as a live connection.
        return this.toStatus(
          marketplace.id,
          marketplace.key,
          marketplace.isConnected(),
          { ...account, status: 'error' },
          null
        );
      }
      return this.toStatus(
        marketplace.id,
        marketplace.key,
        marketplace.isConnected(),
        account,
        tokens
      );
    } catch {
      return this.toStatus(
        marketplace.id,
        marketplace.key,
        marketplace.isConnected(),
        { ...account, status: 'error' },
        null
      );
    }
  }

  async saveAppCredentials(
    input: SaveMarketplaceAppCredentialsInput
  ): Promise<SaveMarketplaceAppCredentialsResult> {
    const marketplace = await this.requireOwnedOlxMarketplace(input.marketplaceId, input.workspaceId);
    const clientId = requireValue(input.clientId, 'OLX application client ID');
    const clientSecret = requireValue(input.clientSecret, 'OLX application client secret');

    // Credentials identify the OAuth application. Existing account tokens were
    // issued to the previous application and must not survive a rotation.
    await this.disconnect({ marketplaceId: marketplace.id, workspaceId: marketplace.workspaceId });

    const saved = await this.deps.appCredentialRepo.upsert({
      id: this.deps.idGenerator(),
      marketplaceId: marketplace.id,
      clientId,
      encryptedClientSecret: this.deps.credentialVault.encryptAppCredentials({
        clientId,
        clientSecret,
      }),
    });
    return {
      configured: true,
      marketplaceId: marketplace.id,
      providerKey: marketplace.key,
      clientId: saved.clientId,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async getAppCredentialStatus(input: {
    marketplaceId: string;
    workspaceId: string;
  }): Promise<MarketplaceAppCredentialStatus> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    const credentials = await this.deps.appCredentialRepo.findByMarketplaceId(marketplace.id);
    return {
      configured: Boolean(credentials),
      marketplaceId: marketplace.id,
      providerKey: marketplace.key,
      clientId: credentials?.clientId,
      updatedAt: credentials?.updatedAt.toISOString(),
    };
  }

  async removeAppCredentials(input: {
    marketplaceId: string;
    workspaceId: string;
  }): Promise<MarketplaceAppCredentialStatus> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    await this.disconnect({ marketplaceId: marketplace.id, workspaceId: marketplace.workspaceId });
    await this.deps.appCredentialRepo.deleteByMarketplaceId(marketplace.id);
    return {
      configured: false,
      marketplaceId: marketplace.id,
      providerKey: marketplace.key,
    };
  }

  async disconnect(input: { marketplaceId: string; workspaceId: string }): Promise<void> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    const disconnect = async (lease?: MarketplaceOAuthRefreshLease): Promise<void> => {
      const account = await this.deps.accountRepo.findByMarketplaceId(marketplace.id);
      await lease?.assertOwned();
      if (account) {
        await this.deps.accountRepo.upsert({
          id: account.id,
          marketplaceId: account.marketplaceId,
          handle: account.handle,
          credentials: {},
          status: 'disconnected',
          scopes: account.scopes,
        });
      }
      marketplace.disconnect();
      await this.deps.marketplaceRepo.save(marketplace);
    };
    if (this.deps.refreshLock) {
      await this.deps.refreshLock.withLock(marketplace.id, disconnect);
    } else {
      await disconnect();
    }
  }

  async getValidAccessToken(
    marketplaceId: string,
    expectedAccount?: { id: string; revision: number },
  ): Promise<string> {
    const resolved = await this.getValidAccessTokenContext(marketplaceId, expectedAccount);
    return resolved.accessToken;
  }

  async getValidAccessTokenContext(
    marketplaceId: string,
    expectedAccount?: { id: string; revision: number },
  ): Promise<MarketplaceResolvedAccessToken> {
    const account = await this.deps.accountRepo.findByMarketplaceId(marketplaceId);
    if (!account || account.status !== 'connected') {
      throw new InvalidStateError('OLX account is not connected');
    }
    if (expectedAccount
      && (account.id !== expectedAccount.id || account.revision !== expectedAccount.revision)) {
      throw new ReconciliationRequiredError('OLX account changed after the operation was reviewed');
    }

    const tokens = this.decryptTokens(account);
    if (!this.deps.sandbox?.enabled && this.isSandboxAccount(account, tokens)) {
      throw new InvalidStateError(
        'Sandbox OLX account cannot be used in real mode; disconnect and reconnect OLX'
      );
    }
    if (tokens.expiresAt.getTime() > this.now().getTime() + REFRESH_SKEW_MS) {
      return {
        accessToken: tokens.accessToken,
        account: { id: account.id, revision: account.revision },
      };
    }

    const refresh = (lease?: MarketplaceOAuthRefreshLease) =>
      this.refreshAccessToken(marketplaceId, lease, expectedAccount);
    return this.deps.refreshLock
      ? this.deps.refreshLock.withLock(marketplaceId, refresh)
      : refresh();
  }

  private async refreshAccessToken(
    marketplaceId: string,
    lease?: MarketplaceOAuthRefreshLease,
    expectedAccount?: { id: string; revision: number }
  ): Promise<MarketplaceResolvedAccessToken> {
    const account = await this.deps.accountRepo.findByMarketplaceId(marketplaceId);
    if (!account || account.status !== 'connected') {
      throw new InvalidStateError('OLX account is not connected');
    }
    if (expectedAccount
      && (account.id !== expectedAccount.id || account.revision !== expectedAccount.revision)) {
      throw new ReconciliationRequiredError('OLX account changed after the operation was reviewed');
    }

    // Another worker may have refreshed while this worker waited for the lock.
    const tokens = this.decryptTokens(account);
    if (!this.deps.sandbox?.enabled && this.isSandboxAccount(account, tokens)) {
      throw new InvalidStateError(
        'Sandbox OLX account cannot be used in real mode; disconnect and reconnect OLX'
      );
    }
    if (tokens.expiresAt.getTime() > this.now().getTime() + REFRESH_SKEW_MS) {
      return {
        accessToken: tokens.accessToken,
        account: { id: account.id, revision: account.revision },
      };
    }
    if (!tokens.refreshToken) {
      throw new InvalidStateError('OLX access token expired and no refresh token is available');
    }

    const appCredentials = await this.requireAppCredentials(account.marketplaceId);

    let refreshed: OlxOAuthTokens;
    try {
      refreshed = normalizeTokens(
        await this.deps.oauthClientFactory(appCredentials).refreshAccessToken(tokens.refreshToken)
      );
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ServiceUnavailableError('OLX token refresh failed', error);
    }
    if (!refreshed.refreshToken) refreshed.refreshToken = tokens.refreshToken;

    await lease?.assertOwned();
    const saved = await this.deps.accountRepo.updateConnectedIfUnchanged(
      {
        id: account.id,
        marketplaceId: account.marketplaceId,
        handle: refreshed.accountHandle?.trim() || account.handle,
        credentials: this.deps.credentialVault.encrypt(refreshed),
        status: 'connected',
        scopes: refreshed.scopes,
      },
      account.revision
    );
    if (!saved) {
      throw new ReconciliationRequiredError('OLX account changed while its access token was refreshing');
    }
    return {
      accessToken: refreshed.accessToken,
      account: { id: saved.id, revision: saved.revision },
    };
  }

  private async startSandbox(
    marketplace: Marketplace,
    successUrl: string
  ): Promise<MarketplaceOAuthStartResult> {
    // Validate the configured URL before persisting anything.
    let returnUrl: URL;
    try {
      returnUrl = new URL(successUrl);
    } catch {
      throw new ConfigurationError('OLX sandbox success URL must be an absolute URL');
    }
    returnUrl.searchParams.set('oauth', 'success');
    returnUrl.searchParams.set('marketplaceId', marketplace.id);
    returnUrl.searchParams.set('sandbox', '1');

    const expiresAt = new Date(this.now().getTime());
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + OLX_SANDBOX_TOKEN_LIFETIME_YEARS);
    const existing = await this.deps.accountRepo.findByMarketplaceId(marketplace.id);
    await this.deps.accountRepo.upsert({
      id: existing?.id ?? this.deps.idGenerator(),
      marketplaceId: marketplace.id,
      handle: OLX_SANDBOX_ACCOUNT_HANDLE,
      credentials: this.deps.credentialVault.encrypt({
        accessToken: OLX_SANDBOX_ACCESS_TOKEN,
        tokenType: OLX_SANDBOX_TOKEN_TYPE,
        scopes: [...OLX_SANDBOX_SCOPES],
        expiresAt,
      }),
      status: 'connected',
      scopes: [...OLX_SANDBOX_SCOPES],
    });

    // Same ordering as complete(): the local flag follows the persisted account.
    marketplace.connect();
    await this.deps.marketplaceRepo.save(marketplace);
    return {
      authorizationUrl: returnUrl.toString(),
      state: 'sandbox',
      expiresAt: expiresAt.toISOString(),
      sandbox: true,
    };
  }

  // The fixed handle survives a disconnect, which clears the credentials. The token type
  // inside the encrypted credentials identifies them even if the handle is overwritten.
  private isSandboxAccount(
    account: MarketplaceAccountRecord,
    tokens?: OlxOAuthTokens | null
  ): boolean {
    return (
      account.handle === OLX_SANDBOX_ACCOUNT_HANDLE ||
      tokens?.tokenType === OLX_SANDBOX_TOKEN_TYPE
    );
  }

  private decryptTokens(account: MarketplaceAccountRecord): OlxOAuthTokens {
    try {
      return normalizeTokens(this.deps.credentialVault.decrypt(account.credentials));
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new InvalidStateError('OLX credentials cannot be decrypted; reconnect is required');
    }
  }

  private async requireAppCredentials(marketplaceId: string): Promise<OlxOAuthAppCredentials> {
    const saved = await this.deps.appCredentialRepo.findByMarketplaceId(marketplaceId);
    if (!saved) {
      throw new ConfigurationError(
        'OLX application credentials are not configured for this workspace'
      );
    }
    try {
      const decrypted = this.deps.credentialVault.decryptAppCredentials(saved.encryptedClientSecret);
      const clientId = requireValue(decrypted.clientId, 'OLX application client ID');
      const clientSecret = requireValue(decrypted.clientSecret, 'OLX application client secret');
      return { clientId, clientSecret, credentialRevision: saved.updatedAt.toISOString() };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('OLX application credentials cannot be decrypted');
    }
  }

  private async requireOwnedOlxMarketplace(marketplaceId: string, workspaceId: string) {
    const marketplace = await this.deps.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      workspaceId
    );
    if (!marketplace) {
      throw new NotFoundError(`Marketplace not found: ${marketplaceId}`);
    }
    if (marketplace.key !== 'olx') {
      throw new ValidationError(`OAuth is not implemented for marketplace: ${marketplace.key}`);
    }
    return marketplace;
  }

  private toStatus(
    marketplaceId: string,
    providerKey: MarketplaceKey,
    marketplaceConnected: boolean,
    account: MarketplaceAccountRecord | null,
    tokens: OlxOAuthTokens | null
  ): MarketplaceOAuthStatus {
    const connected = marketplaceConnected && account?.status === 'connected' && tokens !== null;
    return {
      connected,
      marketplaceId,
      providerKey,
      account: account
        ? {
            id: account.id,
            handle: account.handle,
            status: account.status,
            scopes: [...account.scopes],
          }
        : null,
      tokenExpiresAt: tokens?.expiresAt.toISOString(),
      refreshable: Boolean(tokens?.refreshToken),
      sandbox: account ? this.isSandboxAccount(account, tokens) : false,
    };
  }
}
