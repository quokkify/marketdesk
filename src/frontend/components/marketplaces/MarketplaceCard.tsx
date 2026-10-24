// Card for a live marketplace (OLX): connection status and switch, listing and
// sync details, and the connect / configure actions (PRD §12). The page passes
// the authoritative connection state from the OAuth check and confirms every
// disconnect before it happens.
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Switch, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import LinkIcon from '@mui/icons-material/Link';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import type { Marketplace } from '@shared/types';
import { MARKETPLACE_NAMES } from '@shared/constants';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { formatNumber, formatRelativeTime } from '../../utils/formatters.js';
import { SYNC_MODE_LABELS } from '../../utils/labels.js';
import { MarketplaceBrandChip } from './MarketplaceBrandChip.js';

export const SYNC_ISSUES_PATH = '/listings?status=error';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

type StatusTone = 'success' | 'info' | 'neutral';

const STATUS_TONE_COLOR: Record<StatusTone, string> = {
  success: 'success.main',
  info: 'info.main',
  neutral: 'text.disabled',
};

function connectionStatus(connected: boolean, syncing: boolean): { label: string; tone: StatusTone } {
  if (syncing) return { label: 'Syncing…', tone: 'info' };
  return connected ? { label: 'Connected', tone: 'success' } : { label: 'Disconnected', tone: 'neutral' };
}

function errorsLabel(count: number): string {
  if (count === 0) return 'No errors';
  return count === 1 ? '1 error' : `${formatNumber(count)} errors`;
}

const DetailRow: React.FC<{ label: string; value: string; valueColor?: string }> = ({
  label,
  value,
  valueColor = 'text.primary',
}) => (
  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
    <Typography component="dt" variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography
      component="dd"
      variant="body2"
      sx={{ m: 0, color: valueColor, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}
    >
      {value}
    </Typography>
  </Stack>
);

export interface MarketplaceCardProps {
  marketplace: Marketplace;
  // Authoritative connection state (OAuth check), not the list view's flag.
  connected: boolean;
  // Live listings on this marketplace; null while unknown.
  liveListingCount: number | null;
  syncing: boolean;
  busy: boolean;
  credentialsMissing: boolean;
  onConnect: (marketplace: Marketplace) => void;
  onRequestDisconnect: (marketplace: Marketplace) => void;
  onConfigure: (marketplace: Marketplace) => void;
  onImportPreview: (marketplace: Marketplace) => void;
}

export const MarketplaceCard: React.FC<MarketplaceCardProps> = ({
  marketplace: m,
  connected,
  liveListingCount,
  syncing,
  busy,
  credentialsMissing,
  onConnect,
  onRequestDisconnect,
  onConfigure,
  onImportPreview,
}) => {
  const name = MARKETPLACE_NAMES[m.key];
  const titleId = `marketplace-${m.id}-title`;
  const status = connectionStatus(connected, syncing);
  const connectLabel = m.sandbox ? `Connect sandbox ${name}` : `Connect with ${name}`;

  return (
    <Card>
      <Stack component="section" aria-labelledby={titleId} spacing={2}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <MarketplaceBrandChip marketplaceKey={m.key} />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography id={titleId} component="h2" variant="subtitle1" noWrap sx={{ fontWeight: 800 }}>
              {name}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    flexShrink: 0,
                    bgcolor: STATUS_TONE_COLOR[status.tone],
                    animation: syncing ? `${pulse} 1.2s ease-in-out infinite` : 'none',
                    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                  }}
                />
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ fontWeight: 600, color: STATUS_TONE_COLOR[status.tone] }}
                >
                  {status.label}
                </Typography>
              </Stack>
              {m.sandbox && <Badge label="Sandbox" color="warning" />}
            </Stack>
          </Box>
          <Switch
            checked={connected}
            disabled={busy || syncing}
            onChange={(_event, checked) => (checked ? onConnect(m) : onRequestDisconnect(m))}
            slotProps={{ input: { 'aria-label': `${name} connection` } }}
          />
        </Stack>

        <Stack component="dl" spacing={1.25} sx={{ m: 0 }}>
          <DetailRow
            label="Listings"
            value={liveListingCount === null ? '—' : `${formatNumber(liveListingCount)} live`}
          />
          <DetailRow label="Synchronization" value={SYNC_MODE_LABELS[m.syncMode]} />
          <DetailRow
            label="Errors"
            value={errorsLabel(m.errorCount)}
            valueColor={m.errorCount > 0 ? 'error.main' : 'success.main'}
          />
          <DetailRow label="Last sync" value={m.lastSyncAt ? formatRelativeTime(m.lastSyncAt) : 'Never'} />
        </Stack>

        {m.errorCount > 0 && (
          <Button
            component={RouterLink}
            to={SYNC_ISSUES_PATH}
            variant="outlined"
            color="error"
            size="small"
            startIcon={<ErrorOutlineIcon />}
          >
            Review sync issues
          </Button>
        )}

        {!connected && credentialsMissing && (
          <Typography variant="body2" color="text.secondary">
            Add your OLX app credentials in Configure before connecting.
          </Typography>
        )}

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={() => onConfigure(m)}
            sx={{ flex: '1 1 140px' }}
          >
            Configure
          </Button>
          {connected && !m.sandbox && (
            <Button
              variant="outlined"
              onClick={() => onImportPreview(m)}
              disabled={busy}
              sx={{ flex: '1 1 140px' }}
            >
              Preview import
            </Button>
          )}
          {!connected && (
            <Button
              variant="contained"
              startIcon={<LinkIcon />}
              onClick={() => onConnect(m)}
              disabled={busy}
              fullWidth
            >
              {busy ? 'Connecting…' : connectLabel}
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
};

export default MarketplaceCard;
