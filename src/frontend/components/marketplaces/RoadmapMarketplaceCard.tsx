// Card for a marketplace MarketDesk does not integrate yet (PRD §12 with the
// OLX-only deviation in docs/spec/PRODUCT.md): muted, explicitly labelled, and
// without any connect action.
import React from 'react';
import { Box, Stack, Switch, Typography } from '@mui/material';
import type { MarketplaceKey } from '@shared/types';
import { MARKETPLACE_NAMES } from '@shared/constants';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { MarketplaceBrandChip } from './MarketplaceBrandChip.js';

export const ROADMAP_CARD_COPY = 'Roadmap channel. MarketDesk currently integrates OLX only.';

export interface RoadmapMarketplaceCardProps {
  marketplaceKey: MarketplaceKey;
}

export const RoadmapMarketplaceCard: React.FC<RoadmapMarketplaceCardProps> = ({ marketplaceKey }) => {
  const name = MARKETPLACE_NAMES[marketplaceKey];
  const titleId = `marketplace-${marketplaceKey}-title`;
  return (
    <Card sx={{ bgcolor: 'background.default', boxShadow: 'none' }}>
      <Stack component="section" aria-labelledby={titleId} spacing={2}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <MarketplaceBrandChip marketplaceKey={marketplaceKey} />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography id={titleId} component="h2" variant="subtitle1" noWrap sx={{ fontWeight: 800 }}>
              {name}
            </Typography>
            <Badge label="Not available yet" />
          </Box>
          <Switch
            checked={false}
            disabled
            slotProps={{ input: { 'aria-label': `${name} connection (not available yet)` } }}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {ROADMAP_CARD_COPY}
        </Typography>
      </Stack>
    </Card>
  );
};

export default RoadmapMarketplaceCard;
