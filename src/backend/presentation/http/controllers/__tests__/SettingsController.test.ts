import type { Request, Response } from 'express';
import type { ISettingsRepository } from '../../../../application/ports/ISettingsRepository';
import type {
  MarketplaceOAuthService,
  MarketplaceOAuthStatus,
} from '../../../../application/services/MarketplaceOAuthService';
import { Marketplace } from '../../../../domain/entities/Marketplace';
import type { IWorkspaceRepository } from '../../../../domain/repositories/interfaces/IWorkspaceRepository';
import { InMemoryMarketplaceRepository, unwrap } from '../../../../domain/testkit/support';
import type { IntegrationSettingsStatus, MarketplaceKey } from '../../../../../shared/types';
import type { OlxAdapterMode } from '../../../../config/env';
import { SettingsController } from '../SettingsController';

const WORKSPACE_ID = 'ws-1';

interface MarketplaceRow {
  id: string;
  key: MarketplaceKey;
  name: string;
  connected?: boolean;
}

async function seedMarketplaces(...rows: MarketplaceRow[]) {
  const repo = new InMemoryMarketplaceRepository();
  for (const row of rows) {
    await repo.save(unwrap(Marketplace.create({ ...row, workspaceId: WORKSPACE_ID })));
  }
  return repo;
}

function oauthStatus(overrides: Partial<MarketplaceOAuthStatus> = {}): MarketplaceOAuthStatus {
  return {
    connected: true,
    marketplaceId: 'marketplace-olx',
    providerKey: 'olx',
    account: {
      id: 'account-1',
      handle: 'seller@example.test',
      status: 'connected',
      scopes: ['v2'],
    },
    tokenExpiresAt: '2026-07-14T13:00:00.000Z',
    refreshable: true,
    sandbox: false,
    ...overrides,
  };
}

function fixtures(check: jest.Mock = jest.fn().mockResolvedValue(oauthStatus())) {
  const getAppCredentialStatus = jest.fn();
  const oauth = { check, getAppCredentialStatus } as unknown as MarketplaceOAuthService;
  return { check, getAppCredentialStatus, oauth };
}

async function readIntegrations(
  marketplaces: InMemoryMarketplaceRepository,
  oauth: MarketplaceOAuthService,
  olxAdapterMode: OlxAdapterMode = 'stub'
): Promise<IntegrationSettingsStatus[]> {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const controller = new SettingsController(
    {} as IWorkspaceRepository,
    {} as ISettingsRepository, // unused stub: the constructor still takes it, getIntegrations never reads it
    marketplaces,
    oauth,
    olxAdapterMode
  );
  await controller.getIntegrations(
    { user: { workspaceId: WORKSPACE_ID, userId: 'user-1' } } as unknown as Request,
    { status } as unknown as Response
  );
  return json.mock.calls[0][0].data.items;
}

function marketplaceItem(items: IntegrationSettingsStatus[], id: string) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`No marketplace item: ${id}`);
  return item;
}

const OLX_ROW: MarketplaceRow = {
  id: 'marketplace-olx',
  key: 'olx',
  name: 'OLX',
  connected: true,
};

describe('SettingsController.getIntegrations marketplace accounts', () => {
  it('merges the real connection flag with the OAuth account handle and status', async () => {
    const { check, getAppCredentialStatus, oauth } = fixtures();
    const repo = await seedMarketplaces(OLX_ROW);

    const items = await readIntegrations(repo, oauth, 'real');

    expect(check).toHaveBeenCalledWith({
      marketplaceId: 'marketplace-olx',
      workspaceId: WORKSPACE_ID,
    });
    expect(marketplaceItem(items, 'marketplace-olx')).toEqual({
      category: 'marketplace',
      id: 'marketplace-olx',
      providerKey: 'olx',
      name: 'OLX',
      available: true,
      configured: true,
      connected: true,
      account: { handle: 'seller@example.test', status: 'connected' },
      sandbox: false,
    });
    expect(getAppCredentialStatus).not.toHaveBeenCalled();
  });

  it('reports a disconnected OLX row without an account as not configured', async () => {
    const { oauth } = fixtures(
      jest.fn().mockResolvedValue(oauthStatus({ connected: false, account: null }))
    );
    const repo = await seedMarketplaces({ id: 'marketplace-olx', key: 'olx', name: 'OLX' });

    const item = marketplaceItem(await readIntegrations(repo, oauth), 'marketplace-olx');

    expect(item).toMatchObject({ connected: false, configured: false, account: null });
  });

  it('keeps the retained handle and the error status of a connected row with unusable credentials', async () => {
    const { oauth } = fixtures(
      jest.fn().mockResolvedValue(
        oauthStatus({
          account: { id: 'account-1', handle: 'seller@example.test', status: 'error', scopes: [] },
        })
      )
    );
    const repo = await seedMarketplaces(OLX_ROW);

    const item = marketplaceItem(await readIntegrations(repo, oauth), 'marketplace-olx');

    expect(item.account).toEqual({ handle: 'seller@example.test', status: 'error' });
  });

  // In real mode check() disconnects a leftover sandbox account, so the marketplace row read
  // before it still says connected. The answer of check() decides.
  it('reports a leftover sandbox account that the check disconnected as not connected', async () => {
    const { oauth } = fixtures(
      jest.fn().mockResolvedValue(
        oauthStatus({
          connected: false,
          account: { id: 'account-1', handle: 'OLX sandbox account', status: 'error', scopes: [] },
          sandbox: true,
        })
      )
    );
    const repo = await seedMarketplaces(OLX_ROW);

    const item = marketplaceItem(
      await readIntegrations(repo, oauth, 'real'),
      'marketplace-olx'
    );

    expect(item).toMatchObject({
      connected: false,
      configured: false,
      account: { handle: 'OLX sandbox account', status: 'error' },
      sandbox: true,
    });
  });

  it('never exposes scopes, token expiry or credentials from the OAuth status', async () => {
    const { oauth } = fixtures();
    const repo = await seedMarketplaces(OLX_ROW);

    const items = await readIntegrations(repo, oauth);

    expect(JSON.stringify(items)).not.toMatch(
      /scopes|tokenExpiresAt|refreshable|token|secret|credential/i
    );
  });

  it('lists roadmap channels as unavailable and never asks OAuth about them', async () => {
    const { check, oauth } = fixtures();
    const repo = await seedMarketplaces({
      id: 'marketplace-allegro',
      key: 'allegro',
      name: 'Allegro',
    });

    const item = marketplaceItem(
      await readIntegrations(repo, oauth),
      'marketplace-allegro'
    );

    expect(item).toEqual({
      category: 'marketplace',
      id: 'marketplace-allegro',
      providerKey: 'allegro',
      name: 'Allegro',
      available: false,
      configured: false,
      connected: false,
      account: null,
      sandbox: false,
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('does not swallow an OAuth status failure', async () => {
    const { oauth } = fixtures(jest.fn().mockRejectedValue(new Error('vault offline')));
    const repo = await seedMarketplaces(OLX_ROW);

    await expect(readIntegrations(repo, oauth)).rejects.toThrow('vault offline');
  });
});

describe('SettingsController.getIntegrations sandbox flag', () => {
  it('flags a never-connected OLX as sandbox while the adapter is in stub mode', async () => {
    const { oauth } = fixtures(
      jest.fn().mockResolvedValue(oauthStatus({ connected: false, account: null, sandbox: false }))
    );
    const repo = await seedMarketplaces({ id: 'marketplace-olx', key: 'olx', name: 'OLX' });

    const item = marketplaceItem(
      await readIntegrations(repo, oauth, 'stub'),
      'marketplace-olx'
    );

    expect(item).toMatchObject({ connected: false, account: null, sandbox: true });
  });

  it('treats the stub adapter mode as sandbox', async () => {
    const { oauth } = fixtures();
    const repo = await seedMarketplaces(OLX_ROW);

    const item = marketplaceItem(
      await readIntegrations(repo, oauth, 'stub'),
      'marketplace-olx'
    );

    expect(item.sandbox).toBe(true);
  });

  it('does not flag a live OLX adapter without a stored sandbox account', async () => {
    const { oauth } = fixtures();
    const repo = await seedMarketplaces(OLX_ROW);

    const item = marketplaceItem(
      await readIntegrations(repo, oauth, 'real'),
      'marketplace-olx'
    );

    expect(item.sandbox).toBe(false);
  });

  it('still flags a leftover sandbox account when the adapter is real', async () => {
    const { oauth } = fixtures(
      jest.fn().mockResolvedValue(oauthStatus({ sandbox: true }))
    );
    const repo = await seedMarketplaces(OLX_ROW);

    const item = marketplaceItem(
      await readIntegrations(repo, oauth, 'real'),
      'marketplace-olx'
    );

    expect(item.sandbox).toBe(true);
  });

  it('never flags roadmap channels as sandbox', async () => {
    const { oauth } = fixtures();
    const repo = await seedMarketplaces({
      id: 'marketplace-allegro',
      key: 'allegro',
      name: 'Allegro',
    });

    const item = marketplaceItem(
      await readIntegrations(repo, oauth, 'stub'),
      'marketplace-allegro'
    );

    expect(item.sandbox).toBe(false);
  });
});
