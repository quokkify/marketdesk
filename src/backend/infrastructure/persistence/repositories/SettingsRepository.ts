import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type { ISettingsRepository } from '../../../application/ports/ISettingsRepository';
import {
  type SettingsDensity,
  type SettingsThemeMode,
  type UserPreferences,
  type UserPreferencesPatch,
} from '../../../../shared/types';

interface UserPreferenceRow {
  workspace_id: string;
  user_id: string;
  theme_mode: SettingsThemeMode;
  density: SettingsDensity;
  revision: string | number;
  updated_at: Date | string;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export class SettingsRepository implements ISettingsRepository {
  private readonly queryClient?: Pool | PoolClient;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client ?? pool;
  }

  async getUserPreferences(workspaceId: string, userId: string): Promise<UserPreferences> {
    const result = await query<UserPreferenceRow>(
      `SELECT workspace_id, user_id, theme_mode, density, revision, updated_at
         FROM user_preferences
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
      this.queryClient
    );
    const row = result.rows[0];
    return row
      ? {
          workspaceId: row.workspace_id,
          userId: row.user_id,
          themeMode: row.theme_mode,
          density: row.density,
          revision: Number(row.revision),
          updatedAt: iso(row.updated_at),
        }
      : { workspaceId, userId, themeMode: 'system', density: 'comfortable', revision: 0 };
  }

  async updateUserPreferences(
    workspaceId: string,
    userId: string,
    patch: UserPreferencesPatch
  ): Promise<UserPreferences> {
    const result = await query<UserPreferenceRow>(
      `INSERT INTO user_preferences
         (workspace_id, user_id, theme_mode, density, revision, created_at, updated_at)
       VALUES ($1, $2, COALESCE($3, 'system'), COALESCE($4, 'comfortable'), 1, NOW(), NOW())
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET
         theme_mode = COALESCE($3, user_preferences.theme_mode),
         density = COALESCE($4, user_preferences.density),
         revision = user_preferences.revision + 1,
         updated_at = NOW()
       RETURNING workspace_id, user_id, theme_mode, density, revision, updated_at`,
      [workspaceId, userId, patch.themeMode ?? null, patch.density ?? null],
      this.queryClient
    );
    const row = result.rows[0]!;
    return {
      workspaceId: row.workspace_id,
      userId: row.user_id,
      themeMode: row.theme_mode,
      density: row.density,
      revision: Number(row.revision),
      updatedAt: iso(row.updated_at),
    };
  }
}
