// Workspace settings: section navigation for general preferences, marketplace accounts,
// appearance and application information.
import React, { useEffect, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import {
  Box,
  Alert,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import PaletteIcon from '@mui/icons-material/PaletteOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import type {
  IntegrationSettingsStatus,
  MarketplaceAccountStatus,
  SettingsDensity,
  WorkspaceLanguage,
  WorkspaceSettingsPatch,
} from '@shared/types';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { setWorkspace } from '../state/slices/workspaceSlice.js';
import { setThemeMode, enqueueToast, type ThemeMode } from '../state/slices/uiSlice.js';
import { useApplicationInfo } from '../services/hooks/index.js';
import {
  useGetIntegrationSettingsQuery,
  useGetUserPreferencesQuery,
  useGetWorkspaceSettingsQuery,
  settingsPrincipalKey,
  useUpdateUserPreferencesMutation,
  useUpdateWorkspaceSettingsMutation,
} from '../state/api/settingsApi.js';
import { APP_ROUTE_PATHS, TOPBAR_HEIGHT } from '../utils/constants.js';
import { Card } from '../components/common/Card.js';
import { ConnectionBadge } from '../components/common/Badge.js';

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'UAH'];

export type SettingsSection = 'general' | 'marketplaces' | 'appearance' | 'about';

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
    id: 'marketplaces',
    label: 'Marketplace Accounts',
    description: 'Linked seller accounts and their connection status.',
    icon: <StorefrontIcon fontSize="small" />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Personalize how MarketDesk looks.',
    icon: <PaletteIcon fontSize="small" />,
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

export const themeModeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export const densityOptions: Array<{ value: SettingsDensity; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
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

const OLX_BRAND = { code: 'OL', color: '#12B6AB' };

const isOlxIntegration = (item: IntegrationSettingsStatus): boolean => item.providerKey === 'olx';

export function marketplaceAccountStatus(
  item: IntegrationSettingsStatus
): MarketplaceAccountStatus {
  if (item.account?.status === 'error') return 'error';
  return item.connected ? 'connected' : 'disconnected';
}

export function MarketplaceAccountsList({ items: stored }: { items: IntegrationSettingsStatus[] }) {
  const items = stored.filter(isOlxIntegration);
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
                color: OLX_BRAND.color,
                bgcolor: alpha(OLX_BRAND.color, 0.14),
              }}
            >
              {OLX_BRAND.code}
            </Box>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography sx={{ fontWeight: 700 }} noWrap>
                {item.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {item.account?.handle ?? 'No account linked'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
              {item.sandbox === true && (
                <Chip size="small" color="warning" variant="outlined" label="Sandbox" />
              )}
              <ConnectionBadge status={marketplaceAccountStatus(item)} />
              <Button
                component={RouterLink}
                to={APP_ROUTE_PATHS.marketplaces}
                size="small"
                variant="outlined"
                aria-label={`Manage ${item.name}`}
              >
                Manage
              </Button>
            </Stack>
          </Stack>
        );
      })}
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
  const [updatePreferences, { isLoading: savingPreferences }] = useUpdateUserPreferencesMutation();

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

  const marketplaceItems = integrations.currentData?.items ?? [];

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
