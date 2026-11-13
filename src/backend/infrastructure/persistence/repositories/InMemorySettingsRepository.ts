import type { ISettingsRepository } from '../../../application/ports/ISettingsRepository';
import type { UserPreferences, UserPreferencesPatch } from '../../../../shared/types';

export class InMemorySettingsRepository implements ISettingsRepository {
  private readonly users = new Map<string, UserPreferences>();

  private key(workspaceId: string, userId: string): string {
    return `${workspaceId}:${userId}`;
  }

  async getUserPreferences(workspaceId: string, userId: string): Promise<UserPreferences> {
    return (
      this.users.get(this.key(workspaceId, userId)) ?? {
        workspaceId,
        userId,
        themeMode: 'system',
        density: 'comfortable',
        revision: 0,
      }
    );
  }

  async updateUserPreferences(
    workspaceId: string,
    userId: string,
    patch: UserPreferencesPatch
  ): Promise<UserPreferences> {
    // No await/read gap: independent patches cannot interleave between read and write.
    const current =
      this.users.get(this.key(workspaceId, userId)) ??
      ({ workspaceId, userId, themeMode: 'system', density: 'comfortable', revision: 0 } as const);
    const next = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(this.key(workspaceId, userId), next);
    return next;
  }
}
