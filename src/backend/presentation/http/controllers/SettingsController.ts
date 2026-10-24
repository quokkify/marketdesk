import type { Request, Response, NextFunction } from 'express';
import type { ISettingsRepository } from '../../../application/ports/ISettingsRepository';
import type { IWorkspaceRepository } from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type {
  MarketplaceOAuthService,
  MarketplaceOAuthStatus,
} from '../../../application/services/MarketplaceOAuthService';
import { Workspace } from '../../../domain/entities/Workspace';
import { NotFoundError } from '../../../domain/shared/DomainError';
import type {
  AutonomyLevel,
  HermesGuardrails,
  IntegrationSettingsStatus,
  WorkspaceLanguage,
} from '../../../../shared/types';
import type { OlxAdapterMode } from '../../../config/env';
import { ok } from '../formatters/ResponseFormatter';

export class SettingsController {
  constructor(
    private readonly workspaces: IWorkspaceRepository,
    private readonly settings: ISettingsRepository,
    private readonly marketplaces: IMarketplaceRepository,
    private readonly oauth: MarketplaceOAuthService,
    private readonly olxAdapterMode: OlxAdapterMode
  ) {}

  private async workspace(workspaceId: string) {
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) throw new NotFoundError(`Workspace not found: ${workspaceId}`);
    return workspace;
  }

  getWorkspace = async (req: Request, res: Response): Promise<void> => {
    const workspace = await this.workspace(req.user!.workspaceId!);
    ok(res, {
      id: workspace.id,
      name: workspace.name,
      currency: workspace.currency,
      timezone: workspace.timezone,
      language: workspace.language,
      updatedAt: workspace.updatedAt.toISOString(),
    });
  };

  updateWorkspace = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const current = await this.workspace(req.user!.workspaceId!);
    const rebuilt = Workspace.create({
      id: current.id,
      name: req.body.name ?? current.name,
      currency: req.body.currency ?? current.currency,
      timezone: req.body.timezone ?? current.timezone,
      language: (req.body.language ?? current.language) as WorkspaceLanguage,
      autonomyLevel: current.autonomyLevel,
      guardrails: current.guardrails,
      createdAt: current.createdAt,
    });
    if (rebuilt.isErr()) return next(rebuilt.error);
    const updated = await this.workspaces.updateProfile(current.id, {
      name: req.body.name,
      currency: req.body.currency,
      timezone: req.body.timezone,
      language: req.body.language,
    });
    if (!updated) throw new NotFoundError(`Workspace not found: ${current.id}`);
    ok(res, {
      id: updated.id,
      name: updated.name,
      currency: updated.currency,
      timezone: updated.timezone,
      language: updated.language,
      updatedAt: updated.updatedAt.toISOString(),
    });
  };

  getPreferences = async (req: Request, res: Response): Promise<void> => {
    ok(res, await this.settings.getUserPreferences(req.user!.workspaceId!, req.user!.userId));
  };

  updatePreferences = async (req: Request, res: Response): Promise<void> => {
    ok(
      res,
      await this.settings.updateUserPreferences(req.user!.workspaceId!, req.user!.userId, req.body)
    );
  };

  getNotifications = async (req: Request, res: Response): Promise<void> => {
    ok(
      res,
      await this.settings.getNotificationPreferences(req.user!.workspaceId!, req.user!.userId)
    );
  };

  updateNotifications = async (req: Request, res: Response): Promise<void> => {
    ok(
      res,
      await this.settings.updateNotificationPreferences(
        req.user!.workspaceId!,
        req.user!.userId,
        req.body
      )
    );
  };

  getHermes = async (req: Request, res: Response): Promise<void> => {
    const workspace = await this.workspace(req.user!.workspaceId!);
    ok(res, {
      autonomyLevel: workspace.autonomyLevel,
      guardrails: workspace.guardrails,
      creativityPreset: workspace.creativityPreset,
      agents: { listingSeo: { enabled: workspace.listingSeoEnabled } },
      updatedAt: workspace.updatedAt.toISOString(),
    });
  };

  updateHermes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const current = await this.workspace(req.user!.workspaceId!);
    const rebuilt = Workspace.create({
      id: current.id,
      name: current.name,
      currency: current.currency,
      timezone: current.timezone,
      language: current.language,
      autonomyLevel: (req.body.autonomyLevel ?? current.autonomyLevel) as AutonomyLevel,
      guardrails: {
        ...current.guardrails,
        ...(req.body.guardrails as Partial<HermesGuardrails> | undefined),
      },
      creativityPreset: req.body.creativityPreset ?? current.creativityPreset,
      listingSeoEnabled: req.body.agents?.listingSeo?.enabled ?? current.listingSeoEnabled,
      createdAt: current.createdAt,
    });
    if (rebuilt.isErr()) return next(rebuilt.error);
    const guardrailResult = rebuilt.value.updateGuardrails({});
    if (guardrailResult.isErr()) return next(guardrailResult.error);
    const updated = await this.workspaces.updateHermes(current.id, {
      autonomyLevel: req.body.autonomyLevel,
      guardrails: req.body.guardrails,
      creativityPreset: req.body.creativityPreset,
      listingSeoEnabled: req.body.agents?.listingSeo?.enabled,
    });
    if (!updated) throw new NotFoundError(`Workspace not found: ${current.id}`);
    ok(res, {
      autonomyLevel: updated.autonomyLevel,
      guardrails: updated.guardrails,
      creativityPreset: updated.creativityPreset,
      agents: { listingSeo: { enabled: updated.listingSeoEnabled } },
      updatedAt: updated.updatedAt.toISOString(),
    });
  };

  getIntegrations = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.user!.workspaceId!;
    const marketplaces = await this.marketplaces.findByWorkspace(workspaceId);
    const marketplaceItems: IntegrationSettingsStatus[] = await Promise.all(
      marketplaces.map(async (marketplace) => {
        const isOlx = marketplace.key === 'olx';
        const status: MarketplaceOAuthStatus | null = isOlx
          ? await this.oauth.check({ marketplaceId: marketplace.id, workspaceId })
          : null;
        // In real mode check() disconnects a leftover sandbox account, so the marketplace read
        // above can be stale: the answer of check() decides.
        const connected = status ? status.connected : marketplace.isConnected();
        return {
          category: 'marketplace' as const,
          id: marketplace.id,
          providerKey: marketplace.key,
          name: marketplace.name,
          available: isOlx,
          configured: connected,
          connected,
          account: status?.account
            ? { handle: status.account.handle, status: status.account.status }
            : null,
          // Same meaning as the Marketplaces list: the adapter runs in sandbox mode. A leftover
          // sandbox account still counts when the adapter is real.
          sandbox: isOlx && (this.olxAdapterMode === 'stub' || status?.sandbox === true),
        };
      })
    );
    const apiKeySummary = await this.settings.getApiKeySummary(workspaceId);
    const items: IntegrationSettingsStatus[] = [
      ...marketplaceItems,
      {
        category: 'telegram',
        id: 'telegram',
        name: 'Telegram',
        available: false,
        configured: false,
      },
      {
        category: 'api_keys',
        id: 'api_keys',
        name: 'API keys',
        available: false,
        configured: apiKeySummary.active > 0,
        apiKeySummary,
      },
    ];
    ok(res, { items });
  };
}
