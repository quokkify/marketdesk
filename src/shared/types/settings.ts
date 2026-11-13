import type {
  AutonomyLevel,
  HermesGuardrails,
  MarketplaceAccountStatus,
  MarketplaceKey,
} from './index';

export type WorkspaceLanguage = 'en' | 'pl';
export type SettingsThemeMode = 'system' | 'light' | 'dark';
export type SettingsDensity = 'comfortable' | 'compact';
export type HermesCreativityPreset = 'precise' | 'balanced' | 'creative';

export interface WorkspaceSettings {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  language: WorkspaceLanguage;
  updatedAt: string;
}

export interface UserPreferences {
  workspaceId: string;
  userId: string;
  themeMode: SettingsThemeMode;
  density: SettingsDensity;
  revision: number;
  updatedAt?: string;
}

export interface HermesSettings {
  autonomyLevel: AutonomyLevel;
  guardrails: HermesGuardrails;
  creativityPreset: HermesCreativityPreset;
  agents: { listingSeo: { enabled: boolean } };
  updatedAt: string;
}

export interface MarketplaceAccountSettingsSummary {
  handle: string;
  status: MarketplaceAccountStatus;
}

interface IntegrationSettingsStatusBase {
  id: string;
  name: string;
  available: boolean;
  configured: boolean;
}

export type IntegrationSettingsStatus = IntegrationSettingsStatusBase & {
  category: 'marketplace';
  providerKey: MarketplaceKey;
  connected: boolean;
  account: MarketplaceAccountSettingsSummary | null;
  // True for OLX while the adapter runs in sandbox mode; always false for other channels.
  sandbox: boolean;
};

export interface IntegrationsSettings {
  items: IntegrationSettingsStatus[];
}

export type WorkspaceSettingsPatch = Partial<
  Pick<WorkspaceSettings, 'name' | 'currency' | 'timezone' | 'language'>
>;
export type UserPreferencesPatch = Partial<Pick<UserPreferences, 'themeMode' | 'density'>>;
export interface HermesSettingsPatch {
  autonomyLevel?: AutonomyLevel;
  guardrails?: Partial<HermesGuardrails>;
  creativityPreset?: HermesCreativityPreset;
  agents?: { listingSeo?: { enabled?: boolean } };
}
