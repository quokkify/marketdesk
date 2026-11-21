// Thin HTTP adapter for marketplace resources. Reads and simple connection/sync-mode
// transitions run against the injected repository (no marketplace application service
// exists yet); the async sync enqueue delegates to ListingApplicationService.

import type { Request, Response, NextFunction } from 'express';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { Marketplace } from '../../../domain/entities/Marketplace';
import type { ListingApplicationService } from '../../../application/services/ListingApplicationService';
import type { MarketplaceOAuthService } from '../../../application/services/MarketplaceOAuthService';
import type { MarketplaceSyncScheduler } from '../../../application/services/MarketplaceSyncScheduler';
import type { OlxPublicationQuotaService } from '../../../application/services/OlxPublicationQuotaService';
import type { SyncMode } from '../../../../shared/types';
import type { OlxTaxonomyResolverFactory } from '../../../application/services/ProductRecheckService';
import {
  DomainError,
  InvalidStateError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../../domain/shared/DomainError';
import { presentMarketplace } from '../../../application/dto/presenters';
import { ok } from '../formatters/ResponseFormatter';
import type { ErrorLogger } from '../middleware/ErrorHandlingMiddleware';
import type { OlxAdapterMode } from '../../../config/env';


function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class MarketplaceController {
  constructor(
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly listings: ListingApplicationService,
    private readonly oauth: MarketplaceOAuthService,
    private readonly syncScheduler: MarketplaceSyncScheduler,
    private readonly olxQuotas: OlxPublicationQuotaService | undefined,
    private readonly oauthReturnUrl: string,
    private readonly olxAdapterMode: OlxAdapterMode,
    private readonly olxTaxonomyResolver: OlxTaxonomyResolverFactory | undefined,
    private readonly logger?: ErrorLogger,
  ) {}

  // Same rule as ListingController: only the stub mode is the sandbox.
  private get olxSandbox(): boolean {
    return this.olxAdapterMode === 'stub';
  }

  // OLX counts as connected only with an account in status connected and readable credentials,
  // the answer of the same check() Settings asks.
  private async present(marketplace: Marketplace) {
    const { id: marketplaceId, workspaceId } = marketplace;
    const status =
      marketplace.key === 'olx' ? await this.oauth.check({ marketplaceId, workspaceId }) : null;
    return presentMarketplace(marketplace, {
      olxSandbox: this.olxSandbox,
      oauthConnected: status?.connected,
    });
  }

  listQuotas = async (req: Request, res: Response): Promise<void> => {
    if (!this.olxQuotas) throw new InvalidStateError('OLX publication quota service is unavailable');
    const result = await this.olxQuotas.list({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  setQuota = async (req: Request, res: Response): Promise<void> => {
    if (!this.olxQuotas) throw new InvalidStateError('OLX publication quota service is unavailable');
    const result = await this.olxQuotas.set({
      ...req.body,
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
      actorId: req.user!.userId,
    });
    ok(res, result);
  };

  searchCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      routeParam(req.params.id),
      req.user!.workspaceId!,
    );
    if (!marketplace || marketplace.key !== 'olx' || !marketplace.isConnected() || !this.olxTaxonomyResolver) {
      return next(new NotFoundError('OLX taxonomy is unavailable for this marketplace'));
    }
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (query.length < 2 || query.length > 80) return next(new ValidationError('Category search must contain 2–80 characters'));
    try {
      const resolver = await this.olxTaxonomyResolver(marketplace.id);
      if (!resolver.search) return next(new ServiceUnavailableError('OLX category search is unavailable'));
      ok(res, await resolver.search(query));
    } catch {
      next(new ServiceUnavailableError('OLX category search is temporarily unavailable'));
    }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const marketplaces = await this.marketplaceRepo.findByWorkspace(
      req.user!.workspaceId!,
    );
    ok(res, await Promise.all(marketplaces.map((marketplace) => this.present(marketplace))));
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      req.user!.workspaceId!,
    );
    if (!marketplace) {
      return next(new NotFoundError(`Marketplace not found: ${marketplaceId}`));
    }
    ok(res, await this.present(marketplace));
  };

  sync = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    // Confirm tenant ownership before enqueuing a sync for this marketplace (S2).
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      req.user!.workspaceId!,
    );
    if (!marketplace) {
      return next(new NotFoundError(`Marketplace not found: ${marketplaceId}`));
    }
    const result = await this.listings.syncMarketplace({
      marketplaceId,
      workspaceId: req.user!.workspaceId!,
      actorId: req.user?.userId,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value, 202);
  };

  connect = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    const result = await this.oauth.start({
      marketplaceId,
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  callback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const providerKey = routeParam(req.params.provider);
    const code = routeParam(req.query.code as string | string[] | undefined);
    const state = routeParam(req.query.state as string | string[] | undefined);
    const wantsJson =
      req.query.response === 'json' ||
      (req.get('accept') ?? '').toLowerCase().includes('application/json');

    try {
      const result = await this.oauth.complete({ providerKey, code, state });
      if (wantsJson) {
        ok(res, result);
        return;
      }
      const target = new URL(this.oauthReturnUrl);
      target.searchParams.set('oauth', 'success');
      target.searchParams.set('marketplaceId', result.marketplaceId);
      res.redirect(303, target.toString());
    } catch (error) {
      if (wantsJson) return next(error);
      this.logger?.error({ error }, 'OLX OAuth callback failed');
      try {
        const target = new URL(this.oauthReturnUrl);
        target.searchParams.set('oauth', 'error');
        target.searchParams.set(
          'code',
          error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
        );
        res.redirect(303, target.toString());
      } catch {
        next(error);
      }
    }
  };

  check = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.check({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  getAppCredentials = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.getAppCredentialStatus({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  saveAppCredentials = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.saveAppCredentials({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
      clientId: typeof req.body?.clientId === 'string' ? req.body.clientId : '',
      clientSecret: typeof req.body?.clientSecret === 'string' ? req.body.clientSecret : '',
    });
    ok(res, result);
  };

  removeAppCredentials = async (req: Request, res: Response): Promise<void> => {
    const result = await this.oauth.removeAppCredentials({
      marketplaceId: routeParam(req.params.id),
      workspaceId: req.user!.workspaceId!,
    });
    ok(res, result);
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const marketplaceId = routeParam(req.params.id);
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      req.user!.workspaceId!,
    );
    if (!marketplace) {
      return next(new NotFoundError(`Marketplace not found: ${marketplaceId}`));
    }
    if (typeof req.body?.connected === 'boolean') {
      if (req.body.connected) {
        if (marketplace.key !== 'olx') {
          return next(new InvalidStateError('Only OLX can be connected'));
        }
        if (!marketplace.isConnected()) {
          return next(
            new InvalidStateError('Use POST /marketplaces/:id/connect to authorize with OAuth'),
          );
        }
        marketplace.connect();
      }
      if (!req.body.connected) {
        if (marketplace.key === 'olx') {
          await this.oauth.disconnect({
            marketplaceId,
            workspaceId: req.user!.workspaceId!,
          });
        }
        marketplace.disconnect();
      }
    }
    if (typeof req.body?.syncMode === 'string') {
      const result = marketplace.setSyncMode(req.body.syncMode as SyncMode);
      if (result.isErr()) return next(result.error);
    }
    try {
      await this.syncScheduler.reconcile(marketplace);
    } catch (error) {
      return next(error);
    }
    await this.marketplaceRepo.save(marketplace);
    ok(res, await this.present(marketplace));
  };
}
