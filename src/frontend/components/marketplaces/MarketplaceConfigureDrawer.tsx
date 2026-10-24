// Configure drawer for a live marketplace (PRD §12): sync mode, the OLX app
// credentials form and Disconnect. The page owns the mutations and confirms
// every disconnect before it happens.
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Divider,
  Drawer,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { Marketplace, SyncMode } from '@shared/types';
import { MARKETPLACE_NAMES } from '@shared/constants';
import type {
  MarketplaceAppCredentialStatus,
  SaveMarketplaceAppCredentialsInput,
} from '../../state/api/index.js';
import { SYNC_MODE_LABELS } from '../../utils/labels.js';
import { Badge } from '../common/Badge.js';
import { MarketplaceBrandChip } from './MarketplaceBrandChip.js';

const SUPPORTED_SYNC_MODES: SyncMode[] = ['manual', 'hourly'];

const SYNC_MODE_HELP: Record<SyncMode, string> = {
  manual: 'Sync only when you start it manually.',
  hourly: 'Run automatic synchronization once per hour.',
  realtime: 'Real-time sync is not available for the current OLX integration yet.',
};

const CREDENTIAL_FIELDS_ID = 'olx-app-credential-fields';

function syncModeOptions(current: SyncMode): SyncMode[] {
  return SUPPORTED_SYNC_MODES.includes(current)
    ? SUPPORTED_SYNC_MODES
    : [...SUPPORTED_SYNC_MODES, current];
}

export interface OlxAppCredentialsFormProps {
  sandbox: boolean;
  connected: boolean;
  credentials?: MarketplaceAppCredentialStatus;
  saving: boolean;
  // Resolves true once the credentials are saved.
  onSave: (input: SaveMarketplaceAppCredentialsInput) => Promise<boolean>;
}

export const OlxAppCredentialsForm: React.FC<OlxAppCredentialsFormProps> = ({
  sandbox,
  connected,
  credentials,
  saving,
  onSave,
}) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [expanded, setExpanded] = useState(false);
  const configured = credentials?.configured ?? false;

  useEffect(() => {
    if (credentials?.clientId) setClientId(credentials.clientId);
  }, [credentials?.clientId]);

  const handleSave = async () => {
    if (await onSave({ clientId, clientSecret })) setClientSecret('');
  };

  return (
    <Stack spacing={1.25}>
      <Typography component="h3" variant="subtitle2">
        OLX application credentials
      </Typography>
      {sandbox ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            Not needed in sandbox mode.
          </Typography>
          <Button
            variant="text"
            size="small"
            aria-expanded={expanded}
            aria-controls={CREDENTIAL_FIELDS_ID}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide credential fields' : 'Show credential fields'}
          </Button>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {configured
            ? 'Credentials are saved for this workspace. Re-enter the secret only when rotating it.'
            : 'Paste the client ID and client secret from your OLX developer application before connecting.'}
        </Typography>
      )}
      <Collapse in={!sandbox || expanded} id={CREDENTIAL_FIELDS_ID}>
        <Stack spacing={1.25} sx={{ pt: 0.5 }}>
          {connected && (
            <Typography variant="body2" color="text.secondary">
              Saving new credentials disconnects the current OLX account.
            </Typography>
          )}
          <TextField
            size="small"
            label="Client ID"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            disabled={saving}
            fullWidth
          />
          <TextField
            size="small"
            label={configured ? 'New client secret' : 'Client secret'}
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            disabled={saving}
            helperText={configured ? 'Stored secrets are never shown again.' : undefined}
            fullWidth
          />
          <Button
            variant="outlined"
            size="small"
            onClick={handleSave}
            disabled={saving || !clientId.trim() || !clientSecret.trim()}
          >
            {saving ? 'Saving…' : configured ? 'Update OLX app credentials' : 'Save OLX app credentials'}
          </Button>
        </Stack>
      </Collapse>
    </Stack>
  );
};

export interface MarketplaceConfigureDrawerProps {
  open: boolean;
  marketplace: Marketplace;
  // Authoritative connection state (OAuth check), not the list view's flag.
  connected: boolean;
  busy: boolean;
  credentials?: MarketplaceAppCredentialStatus;
  savingCredentials: boolean;
  onClose: () => void;
  onSyncModeChange: (marketplace: Marketplace, syncMode: SyncMode) => void;
  onSaveCredentials: (input: SaveMarketplaceAppCredentialsInput) => Promise<boolean>;
  onRequestDisconnect: (marketplace: Marketplace) => void;
}

export const MarketplaceConfigureDrawer: React.FC<MarketplaceConfigureDrawerProps> = ({
  open,
  marketplace: m,
  connected,
  busy,
  credentials,
  savingCredentials,
  onClose,
  onSyncModeChange,
  onSaveCredentials,
  onRequestDisconnect,
}) => {
  const name = MARKETPLACE_NAMES[m.key];
  const titleId = `marketplace-${m.id}-configure-title`;
  const syncLabelId = `marketplace-${m.id}-sync-mode-label`;
  const syncSelectId = `marketplace-${m.id}-sync-mode`;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          sx: {
            width: { xs: '100%', sm: 420 },
            borderRight: 'none',
            borderLeft: 1,
            borderColor: 'divider',
          },
        },
      }}
    >
      <Stack spacing={3} sx={{ p: 3 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <MarketplaceBrandChip marketplaceKey={m.key} />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography id={titleId} component="h2" variant="h6" sx={{ fontWeight: 800 }}>
              {`Configure ${name}`}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                {connected ? 'Connected' : 'Disconnected'}
              </Typography>
              {m.sandbox && <Badge label="Sandbox" color="warning" />}
            </Stack>
          </Box>
          <IconButton aria-label="Close configuration" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>

        <Stack spacing={1.5}>
          <Typography component="h3" variant="subtitle2">
            Synchronization
          </Typography>
          <FormControl size="small" fullWidth disabled={!connected || busy}>
            <InputLabel id={syncLabelId}>Sync mode</InputLabel>
            <Select
              labelId={syncLabelId}
              id={syncSelectId}
              label="Sync mode"
              value={m.syncMode}
              onChange={(event) => onSyncModeChange(m, event.target.value as SyncMode)}
            >
              {syncModeOptions(m.syncMode).map((mode) => (
                <MenuItem key={mode} value={mode} disabled={!SUPPORTED_SYNC_MODES.includes(mode)}>
                  {SYNC_MODE_LABELS[mode]}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>{SYNC_MODE_HELP[m.syncMode]}</FormHelperText>
          </FormControl>
          {!connected && (
            <Typography variant="body2" color="text.secondary">
              {`Connect ${name} to change the sync mode.`}
            </Typography>
          )}
        </Stack>

        {m.key === 'olx' && (
          <>
            <Divider />
            <OlxAppCredentialsForm
              sandbox={m.sandbox}
              connected={connected}
              credentials={credentials}
              saving={savingCredentials}
              onSave={onSaveCredentials}
            />
          </>
        )}

        <Divider />
        <Typography variant="body2" color="text.secondary">
          Price rules, category mapping and default shipping profiles are not available yet.
        </Typography>

        {connected && (
          <>
            <Divider />
            <Stack spacing={1.25} sx={{ alignItems: 'flex-start' }}>
              <Typography component="h3" variant="subtitle2">
                Disconnect
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {`Removes the stored ${name} authorization and stops syncing. Listings stay in MarketDesk.`}
              </Typography>
              <Button
                variant="outlined"
                color="error"
                onClick={() => onRequestDisconnect(m)}
                disabled={busy}
              >
                {`Disconnect ${name}`}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Drawer>
  );
};

export default MarketplaceConfigureDrawer;
