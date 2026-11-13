import type { UserPreferences, UserPreferencesPatch } from '../../../shared/types';

export interface ISettingsRepository {
  getUserPreferences(workspaceId: string, userId: string): Promise<UserPreferences>;
  updateUserPreferences(
    workspaceId: string,
    userId: string,
    patch: UserPreferencesPatch
  ): Promise<UserPreferences>;
}
