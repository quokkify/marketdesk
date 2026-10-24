// Marketplace summary bar (PRD §12): how many channels are connected, active
// listings, the last full sync and the Sync all action.
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import LinkIcon from '@mui/icons-material/Link';
import SyncIcon from '@mui/icons-material/Sync';
import { Card } from '../common/Card.js';
import { formatNumber, formatRelativeTime } from '../../utils/formatters.js';

export interface MarketplaceSummaryBarProps {
  connectedCount: number;
  totalCount: number;
  // Live listings across the workspace; null while unknown.
  liveListingCount: number | null;
  // Oldest last sync among connected marketplaces; absent when any never synced.
  lastFullSyncAt?: string;
  syncing: boolean;
  onSyncAll: () => void;
}

export const MarketplaceSummaryBar: React.FC<MarketplaceSummaryBarProps> = ({
  connectedCount,
  totalCount,
  liveListingCount,
  lastFullSyncAt,
  syncing,
  onSyncAll,
}) => {
  const anyConnected = connectedCount > 0;
  const details = [
    liveListingCount === null ? null : `${formatNumber(liveListingCount)} active listings`,
    lastFullSyncAt ? `last full sync ${formatRelativeTime(lastFullSyncAt)}` : 'no full sync yet',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card>
      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Box
          aria-hidden
          sx={(theme: Theme) => {
            const tone = anyConnected ? theme.palette.success.main : theme.palette.text.secondary;
            return {
              width: 40,
              height: 40,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              borderRadius: '10px',
              bgcolor: alpha(tone, 0.12),
              color: tone,
            };
          }}
        >
          <LinkIcon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
          <Typography component="p" variant="subtitle1" sx={{ fontWeight: 800 }}>
            {`${connectedCount} of ${totalCount} marketplaces connected`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {details}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<SyncIcon />}
          onClick={onSyncAll}
          disabled={!anyConnected || syncing}
        >
          {syncing ? 'Syncing…' : 'Sync all'}
        </Button>
      </Stack>
    </Card>
  );
};

export default MarketplaceSummaryBar;
