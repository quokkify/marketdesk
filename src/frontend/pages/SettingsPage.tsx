// Workspace settings: visual settings shell with section navigation for general
// preferences, Hermes autonomy, notifications, integrations, appearance, and security.
import React, { useEffect, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import {
  Box,
  Alert,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import NotificationsIcon from '@mui/icons-material/NotificationsNone';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import KeyIcon from '@mui/icons-material/KeyOutlined';
import PaletteIcon from '@mui/icons-material/PaletteOutlined';
import TelegramIcon from '@mui/icons-material/Telegram';
import SecurityIcon from '@mui/icons-material/SecurityOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import type {
  AutonomyLevel,
  HermesCreativityPreset,
  IntegrationSettingsStatus,
  MarketplaceAccountStatus,
  MarketplaceKey,
  NotificationChannels,
  NotificationEventKey,
  SettingsDensity,
  WorkspaceLanguage,
  WorkspaceSettingsPatch,
} from '@shared/types';
import { AUTONOMY_LEVEL_LIST } from '@shared/constants';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { setWorkspace, setAutonomyLevel } from '../state/slices/workspaceSlice.js';
import { setThemeMode, enqueueToast, type ThemeMode } from '../state/slices/uiSlice.js';
import { useApplicationInfo } from '../services/hooks/index.js';
import {
  useGetHermesSettingsQuery,
  useGetIntegrationSettingsQuery,
  useGetNotificationPreferencesQuery,
  useGetUserPreferencesQuery,
  useGetWorkspaceSettingsQuery,
  hermesCreativityPatch,
  hermesListingSeoEnabledPatch,
  hermesAutomationPatch,
  notificationChannelPatch,
  settingsPrincipalKey,
  useUpdateHermesSettingsMutation,
  useUpdateNotificationPreferencesMutation,
  useUpdateUserPreferencesMutation,
  useUpdateWorkspaceSettingsMutation,
} from '../state/api/settingsApi.js';
import { AUTONOMY_LABELS, AUTONOMY_DESCRIPTIONS } from '../utils/labels.js';
import { APP_ROUTE_PATHS, TOPBAR_HEIGHT } from '../utils/constants.js';
import { Card } from '../components/common/Card.js';
import { ConnectionBadge } from '../components/common/Badge.js';

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'UAH'];

export type SettingsSection =
  | 'general'
  | 'hermes'
  | 'notifications'
  | 'marketplaces'
  | 'apiKeys'
  | 'appearance'
  | 'telegram'
  | 'security'
  | 'about';

export const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'general',
    label: 'General',
    description: 'Workspace name, currency, timezone and language.',
    icon: <TuneIcon fontSize="small" />,
  },
  {
    id: 'hermes',
    label: 'Hermes AI',
    description: 'Control how autonomous Hermes is.',
    icon: <AutoAwesomeIcon fontSize="small" />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Preferences are saved now; delivery is not active in this release.',
    icon: <NotificationsIcon fontSize="small" />,
  },
  {
    id: 'marketplaces',
    label: 'Marketplace Accounts',
    description: 'Linked seller accounts and their connection status.',
    icon: <StorefrontIcon fontSize="small" />,
  },
  {
    id: 'apiKeys',
    label: 'API Keys',
    description: 'Programmatic access is planned.',
    icon: <KeyIcon fontSize="small" />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Personalize how MarketDesk looks.',
    icon: <PaletteIcon fontSize="small" />,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    description: 'Telegram alerts are planned.',
    icon: <TelegramIcon fontSize="small" />,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Password, two-factor authentication and sessions.',
    icon: <SecurityIcon fontSize="small" />,
  },
  {
    id: 'about',
    label: 'About',
    description: 'Application information.',
    icon: <InfoIcon fontSize="small" />,
  },
];

export function settingsSectionFromHash(hash: string): SettingsSection {
  const requested = hash.replace(/^#/, '') as SettingsSection;
  return settingsSections.some(({ id }) => id === requested) ? requested : 'general';
}

// `?section=` is the canonical deep link; the legacy `#section` hash keeps older links working.
export function settingsSectionFromLocation(location: {
  search: string;
  hash: string;
}): SettingsSection {
  const requested = new URLSearchParams(location.search).get('section');
  const fromQuery = settingsSections.find(({ id }) => id === requested);
  return fromQuery ? fromQuery.id : settingsSectionFromHash(location.hash);
}

export const settingsSectionPath = (section: SettingsSection) =>
  `${APP_ROUTE_PATHS.settings}?section=${section}`;

const NOT_AVAILABLE_LABEL = 'Not available in this release';

const HERMES_REVIEW_ONLY_NOTE =
  'Autonomy applies to scheduled catalogue runs, which are disabled in this build; all analyses stay review-only';

const API_KEYS_ROADMAP_NOTE =
  'API key management is on the roadmap and is not available in this release.';
const TELEGRAM_ROADMAP_NOTE =
  'Telegram notifications are on the roadmap and are not available in this release.';

export const themeModeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export const densityOptions: Array<{ value: SettingsDensity; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const notificationRows: Array<[NotificationEventKey, string]> = [
  ['new_sale', 'New sale'],
  ['competitor_price_change', 'Competitor price change'],
  ['listing_needs_attention', 'Listing needs attention'],
  ['sync_error', 'Sync errors'],
  ['weekly_performance_report', 'Weekly performance report'],
];

const notificationChannels: Array<{
  key: keyof NotificationChannels;
  label: string;
  unavailable?: boolean;
}> = [
  { key: 'email', label: 'Email' },
  { key: 'inApp', label: 'In-app' },
  { key: 'telegram', label: 'Telegram', unavailable: true },
];

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

type GeneralField = 'name' | 'currency' | 'timezone' | 'language';
export type GeneralFieldErrors = Partial<Record<GeneralField, string>>;

export function mapSettingsFieldErrors(err: unknown): GeneralFieldErrors {
  const details = (err as { data?: { error?: { details?: unknown } } })?.data?.error?.details;
  if (!Array.isArray(details)) return {};
  const mapped: GeneralFieldErrors = {};
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const issue = detail as { field?: unknown; path?: unknown[]; message?: string };
    const field = issue.field ?? issue.path?.[0];
    if (
      typeof field === 'string' &&
      ['name', 'currency', 'timezone', 'language'].includes(field) &&
      typeof issue.message === 'string'
    ) {
      mapped[field as GeneralField] = issue.message;
    }
  }
  return mapped;
}

interface WorkspaceDraft {
  name: string;
  currency: string;
  timezone: string;
  language: WorkspaceLanguage;
}

export const workspaceDraftSnapshot = (draft: WorkspaceDraft): string => JSON.stringify(draft);

export function workspaceSettingsPatch(
  baseline: WorkspaceDraft,
  draft: WorkspaceDraft
): WorkspaceSettingsPatch {
  const patch: WorkspaceSettingsPatch = {};
  if (draft.name !== baseline.name) patch.name = draft.name;
  if (draft.currency !== baseline.currency) patch.currency = draft.currency;
  if (draft.timezone !== baseline.timezone) patch.timezone = draft.timezone;
  if (draft.language !== baseline.language) patch.language = draft.language;
  return patch;
}

export function shouldHydrateWorkspaceDraft(input: {
  initializedPrincipal: string | null;
  principalKey: string;
  baselineSnapshot: string | null;
  incomingSnapshot: string;
  dirty: boolean;
}): boolean {
  return (
    input.initializedPrincipal !== input.principalKey ||
    input.baselineSnapshot === null ||
    (!input.dirty && input.baselineSnapshot !== input.incomingSnapshot)
  );
}

function SettingsQueryState({
  isLoading,
  isError,
  retry,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  retry: () => unknown;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <Stack direction="row" spacing={1} role="status" sx={{ alignItems: 'center' }}>
        <CircularProgress size={18} />
        <Typography>Loading settings…</Typography>
      </Stack>
    );
  }
  if (isError) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => retry()}>
            Retry
          </Button>
        }
      >
        Settings could not be loaded.
      </Alert>
    );
  }
  return <>{children}</>;
}

export function ApplicationInfoBlock({
  version,
  isLoading = false,
  isError = false,
}: {
  version?: string;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const displayVersion = isLoading
    ? 'Loading…'
    : isError || !version
      ? 'Version unavailable'
      : version;

  return (
    <Stack spacing={0.75}>
      <Typography variant="body2" color="text.secondary">
        Application version
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>
        {displayVersion}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Version embedded in the currently running MarketDesk artifact.
      </Typography>
    </Stack>
  );
}

type MarketplaceIntegration = Extract<IntegrationSettingsStatus, { category: 'marketplace' }>;

const isMarketplaceIntegration = (
  item: IntegrationSettingsStatus
): item is MarketplaceIntegration => item.category === 'marketplace';

const MARKETPLACE_BRANDS: Record<MarketplaceKey, { code: string; color: string }> = {
  olx: { code: 'OL', color: '#12B6AB' },
  allegro: { code: 'AL', color: '#FF5A00' },
  vinted: { code: 'VI', color: '#09B1BA' },
  facebook: { code: 'FB', color: '#1877F2' },
  ebay: { code: 'EB', color: '#E53238' },
  etsy: { code: 'ET', color: '#F56400' },
  amazon: { code: 'AM', color: '#FF9900' },
};

export function marketplaceAccountStatus(item: MarketplaceIntegration): MarketplaceAccountStatus {
  if (item.account?.status === 'error') return 'error';
  return item.connected ? 'connected' : 'disconnected';
}

export function MarketplaceAccountsList({ items }: { items: MarketplaceIntegration[] }) {
  if (items.length === 0) {
    return (
      <Alert
        severity="info"
        action={
          <Button
            color="inherit"
            size="small"
            component={RouterLink}
            to={APP_ROUTE_PATHS.marketplaces}
          >
            Open Marketplaces
          </Button>
        }
      >
        No marketplace accounts are linked yet.
      </Alert>
    );
  }
  return (
    <Stack divider={<Divider flexItem />}>
      {items.map((item) => {
        const brand = MARKETPLACE_BRANDS[item.providerKey];
        return (
          <Stack
            key={item.id}
            direction="row"
            spacing={1.5}
            sx={{ py: 1.5, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <Box
              role="img"
              aria-label={`${item.name} marketplace logo`}
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 800,
                color: brand.color,
                bgcolor: alpha(brand.color, 0.14),
              }}
            >
              {brand.code}
            </Box>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography sx={{ fontWeight: 700 }} noWrap>
                {item.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {item.available
                  ? (item.account?.handle ?? 'No account linked')
                  : NOT_AVAILABLE_LABEL}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
              {item.sandbox === true && (
                <Chip size="small" color="warning" variant="outlined" label="Sandbox" />
              )}
              {item.available ? (
                <ConnectionBadge status={marketplaceAccountStatus(item)} />
              ) : (
                <Chip size="small" variant="outlined" label="Roadmap" />
              )}
              {item.available && (
                <Button
                  component={RouterLink}
                  to={APP_ROUTE_PATHS.marketplaces}
                  size="small"
                  variant="outlined"
                  aria-label={`Manage ${item.name}`}
                >
                  Manage
                </Button>
              )}
            </Stack>
          </Stack>
        );
      })}
    </Stack>
  );
}

const SECURITY_ROWS: Array<{
  id: string;
  title: string;
  action: string;
  actionLabel: string;
  destructive?: boolean;
}> = [
  { id: 'password', title: 'Password', action: 'Change', actionLabel: 'Change password' },
  {
    id: 'two-factor',
    title: 'Two-factor authentication',
    action: 'Set up',
    actionLabel: 'Set up two-factor authentication',
  },
  {
    id: 'sessions',
    title: 'Active sessions',
    action: 'Sign out all',
    actionLabel: 'Sign out all sessions',
    destructive: true,
  },
];

export function SecurityPanel() {
  return (
    <Stack divider={<Divider flexItem />}>
      {SECURITY_ROWS.map((row) => (
        <Stack
          key={row.id}
          direction="row"
          spacing={2}
          sx={{ py: 2, alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700 }}>{row.title}</Typography>
            <Typography variant="caption" color="text.secondary">
              {NOT_AVAILABLE_LABEL}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            color={row.destructive ? 'error' : 'inherit'}
            aria-label={row.actionLabel}
            disabled
          >
            {row.action}
          </Button>
        </Stack>
      ))}
    </Stack>
  );
}

export function RoadmapPanel({ detail }: { detail: string }) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Chip size="small" variant="outlined" label="Roadmap" />
      <Typography variant="body2" color="text.secondary">
        {detail}
      </Typography>
    </Stack>
  );
}

const SettingsPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useAppSelector((s) => s.workspace);
  const user = useAppSelector((s) => s.auth.user);
  const themeMode = useAppSelector((s) => s.ui.themeMode);
  const principal =
    workspace.id && user?.id ? { workspaceId: workspace.id, userId: user.id } : null;
  const principalCacheKey = principal ? settingsPrincipalKey(principal) : '';
  const queryArg = principal ?? skipToken;
  const {
    data: applicationInfo,
    isLoading: applicationInfoLoading,
    isError: applicationInfoError,
  } = useApplicationInfo();
  const workspaceSettings = useGetWorkspaceSettingsQuery(queryArg);
  const preferences = useGetUserPreferencesQuery(queryArg);
  const notifications = useGetNotificationPreferencesQuery(queryArg);
  const hermesSettings = useGetHermesSettingsQuery(queryArg);
  const integrations = useGetIntegrationSettingsQuery(queryArg, {
    refetchOnMountOrArgChange: true,
  });

  const activeSection = settingsSectionFromLocation(location);
  const [name, setName] = useState(workspace.name);
  const [currency, setCurrency] = useState(workspace.currency);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [language, setLanguage] = useState<WorkspaceLanguage>('en');
  const [baseline, setBaseline] = useState<WorkspaceDraft | null>(null);
  const [initializedPrincipal, setInitializedPrincipal] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<GeneralFieldErrors>({});

  const [updateWorkspace, { isLoading: saving }] = useUpdateWorkspaceSettingsMutation();
  const [updateHermes, { isLoading: savingHermes }] = useUpdateHermesSettingsMutation();
  const [updatePreferences, { isLoading: savingPreferences }] = useUpdateUserPreferencesMutation();
  const [updateNotifications, { isLoading: savingNotifications }] =
    useUpdateNotificationPreferencesMutation();

  const draft = { name, currency, timezone, language };
  const baselineSnapshot = baseline ? workspaceDraftSnapshot(baseline) : null;
  const dirty = baselineSnapshot !== null && workspaceDraftSnapshot(draft) !== baselineSnapshot;

  useEffect(() => {
    if (!workspaceSettings.currentData || !principalCacheKey) return;
    const incoming: WorkspaceDraft = workspaceSettings.currentData;
    const incomingSnapshot = workspaceDraftSnapshot(incoming);
    if (
      !shouldHydrateWorkspaceDraft({
        initializedPrincipal,
        principalKey: principalCacheKey,
        baselineSnapshot,
        incomingSnapshot,
        dirty,
      })
    ) {
      return;
    }
    setName(incoming.name);
    setCurrency(incoming.currency);
    setTimezone(incoming.timezone);
    setLanguage(incoming.language);
    setBaseline(incoming);
    setInitializedPrincipal(principalCacheKey);
    setFieldErrors({});
  }, [
    workspaceSettings.currentData,
    principalCacheKey,
    initializedPrincipal,
    baselineSnapshot,
    dirty,
  ]);

  const clearFieldError = (field: GeneralField) =>
    setFieldErrors((current) => ({ ...current, [field]: undefined }));

  const handleSaveProfile = async () => {
    if (!principal || !baseline) return;
    setFieldErrors({});
    try {
      const patch = workspaceSettingsPatch(baseline, draft);
      if (Object.keys(patch).length === 0) return;
      const updated = await updateWorkspace({ principal, patch }).unwrap();
      const updatedDraft: WorkspaceDraft = updated;
      setName(updated.name);
      setCurrency(updated.currency);
      setTimezone(updated.timezone);
      setLanguage(updated.language);
      setBaseline(updatedDraft);
      dispatch(
        setWorkspace({
          ...workspace,
          name: updated.name,
          currency: updated.currency,
          timezone: updated.timezone,
        })
      );
      dispatch(enqueueToast({ message: 'Workspace settings saved.', severity: 'success' }));
    } catch (err) {
      setFieldErrors(mapSettingsFieldErrors(err));
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleAutonomy = async (level: AutonomyLevel) => {
    if (!principal) return;
    try {
      await updateHermes({ principal, patch: { autonomyLevel: level } }).unwrap();
      dispatch(setAutonomyLevel(level));
      dispatch(
        enqueueToast({ message: `Autonomy set to ${AUTONOMY_LABELS[level]}.`, severity: 'success' })
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleCreativity = async (creativityPreset: HermesCreativityPreset) => {
    if (!principal) return;
    try {
      await updateHermes({ principal, patch: hermesCreativityPatch(creativityPreset) }).unwrap();
      dispatch(enqueueToast({ message: 'Hermes creativity saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleListingSeo = async (enabled: boolean) => {
    if (!principal) return;
    try {
      await updateHermes({ principal, patch: hermesListingSeoEnabledPatch(enabled) }).unwrap();
      dispatch(enqueueToast({ message: 'Listing SEO agent saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleAutomation = async (
    field: 'autoCreateListings' | 'autoAdjustPricing' | 'autoRelist' | 'smartTitleAndSEO',
    enabled: boolean
  ) => {
    if (!principal) return;
    try {
      await updateHermes({ principal, patch: hermesAutomationPatch(field, enabled) }).unwrap();
      dispatch(enqueueToast({ message: 'Hermes automation saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleNotification = async (
    event: NotificationEventKey,
    channel: keyof NotificationChannels,
    enabled: boolean
  ) => {
    if (!principal) return;
    try {
      await updateNotifications({
        principal,
        patch: notificationChannelPatch(event, channel, enabled),
      }).unwrap();
      dispatch(enqueueToast({ message: 'Notification preference saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleTheme = async (mode: ThemeMode) => {
    if (!principal) return;
    try {
      await updatePreferences({ principal, patch: { themeMode: mode } }).unwrap();
      dispatch(setThemeMode(mode));
      dispatch(enqueueToast({ message: 'Appearance preference saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleDensity = async (density: SettingsDensity) => {
    if (!principal) return;
    try {
      await updatePreferences({ principal, patch: { density } }).unwrap();
      dispatch(enqueueToast({ message: 'Density preference saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const marketplaceItems = (integrations.currentData?.items ?? []).filter(isMarketplaceIntegration);

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return (
          <SettingsQueryState
            isLoading={workspaceSettings.isFetching && !workspaceSettings.currentData}
            isError={workspaceSettings.isError}
            retry={workspaceSettings.refetch}
          >
            <Stack spacing={2.25}>
              <TextField
                label="Workspace name"
                value={name}
                disabled={!workspaceSettings.currentData || saving}
                error={Boolean(fieldErrors.name)}
                helperText={fieldErrors.name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError('name');
                }}
                fullWidth
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Select
                  value={currency}
                  disabled={!workspaceSettings.currentData || saving}
                  error={Boolean(fieldErrors.currency)}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                    clearFieldError('currency');
                  }}
                  fullWidth
                  aria-label="Default currency"
                >
                  {CURRENCIES.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c} — {c === 'PLN' ? 'Polish złoty' : c}
                    </MenuItem>
                  ))}
                </Select>
                <TextField
                  label="Timezone"
                  value={timezone}
                  disabled={!workspaceSettings.currentData || saving}
                  error={Boolean(fieldErrors.timezone)}
                  helperText={fieldErrors.timezone}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    clearFieldError('timezone');
                  }}
                  fullWidth
                />
              </Stack>
              {fieldErrors.currency && (
                <Typography color="error">{fieldErrors.currency}</Typography>
              )}
              <Select
                value={language}
                disabled={!workspaceSettings.currentData || saving}
                error={Boolean(fieldErrors.language)}
                onChange={(e) => {
                  setLanguage(e.target.value as WorkspaceLanguage);
                  clearFieldError('language');
                }}
                fullWidth
                aria-label="Language"
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="pl">Polski</MenuItem>
              </Select>
              {fieldErrors.language && (
                <Typography color="error">{fieldErrors.language}</Typography>
              )}
              <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
                <Button
                  variant="outlined"
                  disabled={!workspaceSettings.currentData || saving}
                  onClick={() => {
                    if (!workspaceSettings.currentData) return;
                    const reset: WorkspaceDraft = workspaceSettings.currentData;
                    setName(reset.name);
                    setCurrency(reset.currency);
                    setTimezone(reset.timezone);
                    setLanguage(reset.language);
                    setBaseline(reset);
                    setFieldErrors({});
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSaveProfile}
                  disabled={!dirty || saving || !workspaceSettings.currentData}
                >
                  Save changes
                </Button>
              </Stack>
            </Stack>
          </SettingsQueryState>
        );
      case 'hermes':
        return (
          <SettingsQueryState
            isLoading={hermesSettings.isFetching && !hermesSettings.currentData}
            isError={hermesSettings.isError}
            retry={hermesSettings.refetch}
          >
            <Stack spacing={1.5}>
              <Typography variant="caption" color="text.secondary">
                {HERMES_REVIEW_ONLY_NOTE}
              </Typography>
              {AUTONOMY_LEVEL_LIST.map((level) => {
                const selected = hermesSettings.currentData?.autonomyLevel === level;
                return (
                  <ButtonBase
                    key={level}
                    onClick={() => handleAutonomy(level)}
                    disabled={savingHermes || !hermesSettings.currentData}
                    aria-pressed={selected}
                    sx={{
                      p: 2,
                      borderRadius: 2.5,
                      width: '100%',
                      display: 'block',
                      textAlign: 'left',
                      border: (t) =>
                        `2px solid ${selected ? t.palette.primary.main : t.palette.divider}`,
                      bgcolor: selected ? 'action.selected' : 'background.paper',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}
                    >
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        {AUTONOMY_LABELS[level]}
                      </Typography>
                      {selected && <CheckCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {AUTONOMY_DESCRIPTIONS[level]}
                    </Typography>
                  </ButtonBase>
                );
              })}
              <Divider />
              <Typography variant="subtitle2">Listing agent creativity</Typography>
              <Select
                value={hermesSettings.currentData?.creativityPreset ?? 'balanced'}
                disabled={savingHermes || !hermesSettings.currentData}
                onChange={(event) => handleCreativity(event.target.value as HermesCreativityPreset)}
                aria-label="Listing agent creativity"
              >
                <MenuItem value="precise">Precise</MenuItem>
                <MenuItem value="balanced">Balanced</MenuItem>
                <MenuItem value="creative">Creative</MenuItem>
              </Select>
              <FormControlLabel
                control={
                  <Switch
                    disabled={savingHermes || !hermesSettings.currentData}
                    checked={hermesSettings.currentData?.agents.listingSeo.enabled ?? true}
                    onChange={(event) => handleListingSeo(event.target.checked)}
                  />
                }
                label="Enable listing SEO agent (review-only)"
              />
              <Divider />
              <Typography variant="subtitle2">Automation controls</Typography>
              {(
                [
                  ['autoCreateListings', 'Automatically create listings'],
                  ['autoAdjustPricing', 'Automatically adjust pricing'],
                  ['autoRelist', 'Automatically relist'],
                  ['smartTitleAndSEO', 'Smart title and SEO'],
                ] as const
              ).map(([field, label]) => (
                <FormControlLabel
                  key={field}
                  control={
                    <Switch
                      disabled={savingHermes || !hermesSettings.currentData}
                      checked={hermesSettings.currentData?.guardrails[field] ?? false}
                      onChange={(event) => handleAutomation(field, event.target.checked)}
                    />
                  }
                  label={label}
                />
              ))}
            </Stack>
          </SettingsQueryState>
        );
      case 'notifications':
        return (
          <SettingsQueryState
            isLoading={notifications.isFetching && !notifications.currentData}
            isError={notifications.isError}
            retry={notifications.refetch}
          >
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                Choose channels independently for each event. Changes are saved immediately.
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr repeat(3, auto)' },
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <Typography variant="caption">Event</Typography>
                {notificationChannels.map((channel) => (
                  <Box key={channel.key}>
                    <Typography variant="caption">{channel.label}</Typography>
                    {channel.unavailable && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', maxWidth: 120 }}
                      >
                        {NOT_AVAILABLE_LABEL}
                      </Typography>
                    )}
                  </Box>
                ))}
                {notificationRows.map(([event, label]) => (
                  <React.Fragment key={event}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {label}
                    </Typography>
                    {notificationChannels.map((channel) => (
                      <Switch
                        key={channel.key}
                        size="small"
                        disabled={
                          !notifications.currentData || savingNotifications || channel.unavailable
                        }
                        checked={notifications.currentData?.events[event][channel.key] ?? false}
                        onChange={(e) => handleNotification(event, channel.key, e.target.checked)}
                        slotProps={{ input: { 'aria-label': `${label} ${channel.key}` } }}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </Box>
            </Stack>
          </SettingsQueryState>
        );
      case 'appearance':
        return (
          <SettingsQueryState
            isLoading={preferences.isFetching && !preferences.currentData}
            isError={preferences.isError}
            retry={preferences.refetch}
          >
            <Stack spacing={2.5}>
              <Stack spacing={0.75}>
                <Typography variant="subtitle2">Theme</Typography>
                <Select
                  value={preferences.currentData?.themeMode ?? themeMode}
                  disabled={!preferences.currentData || savingPreferences}
                  onChange={(event) => handleTheme(event.target.value as ThemeMode)}
                  aria-label="Theme preference"
                >
                  {themeModeOptions.map(({ value, label }) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </Select>
              </Stack>
              <Stack spacing={0.75}>
                <Typography variant="subtitle2">Density</Typography>
                <Select
                  value={preferences.currentData?.density ?? 'comfortable'}
                  disabled={!preferences.currentData || savingPreferences}
                  onChange={(event) => handleDensity(event.target.value as SettingsDensity)}
                  aria-label="Interface density"
                >
                  {densityOptions.map(({ value, label }) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </Select>
                <Typography variant="caption" color="text.secondary">
                  Compact uses smaller buttons, fields and table rows across the app.
                </Typography>
              </Stack>
            </Stack>
          </SettingsQueryState>
        );
      case 'marketplaces':
        return (
          <SettingsQueryState
            isLoading={integrations.isFetching && !integrations.currentData}
            isError={integrations.isError}
            retry={integrations.refetch}
          >
            <MarketplaceAccountsList items={marketplaceItems} />
          </SettingsQueryState>
        );
      case 'apiKeys':
        return <RoadmapPanel detail={API_KEYS_ROADMAP_NOTE} />;
      case 'telegram':
        return <RoadmapPanel detail={TELEGRAM_ROADMAP_NOTE} />;
      case 'security':
        return <SecurityPanel />;
      case 'about':
        return (
          <ApplicationInfoBlock
            version={applicationInfo?.version}
            isLoading={applicationInfoLoading}
            isError={applicationInfoError}
          />
        );
      default:
        return null;
    }
  };

  const activeMeta =
    settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '240px minmax(0, 1fr)' },
          gap: 2.5,
          alignItems: 'start',
        }}
      >
        <Box sx={{ position: { md: 'sticky' }, top: { md: TOPBAR_HEIGHT + 16 } }}>
          <Card contentSx={{ p: 1.25 }}>
            <SettingsSectionNavigation
              activeSection={activeSection}
              onSectionChange={(section) => navigate(settingsSectionPath(section))}
            />
          </Card>
        </Box>

        <Card
          title={activeMeta.label}
          subtitle={activeMeta.description}
          contentSx={{ p: { xs: 2, md: 3 } }}
        >
          {renderSection()}
        </Card>
      </Box>
    </Box>
  );
};

export function SettingsSectionNavigation({
  activeSection,
  onSectionChange,
}: {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  return (
    <Stack component="nav" aria-label="Settings sections" spacing={0.5}>
      {settingsSections.map((section) => {
        const active = activeSection === section.id;
        return (
          <Button
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            startIcon={section.icon}
            fullWidth
            color="inherit"
            aria-current={active ? 'page' : undefined}
            sx={(theme) => ({
              justifyContent: 'flex-start',
              borderRadius: 1,
              px: 1.5,
              py: 1,
              fontWeight: active ? 700 : 600,
              color: active ? theme.palette.primary.main : theme.palette.text.secondary,
              bgcolor: active ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
              '&:hover': {
                bgcolor: active
                  ? alpha(theme.palette.primary.main, 0.16)
                  : theme.palette.action.hover,
              },
            })}
          >
            {section.label}
          </Button>
        );
      })}
    </Stack>
  );
}

export default SettingsPage;
