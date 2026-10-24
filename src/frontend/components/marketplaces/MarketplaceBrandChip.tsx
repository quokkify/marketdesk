// Marketplace logo chip: the channel's two-letter code on a tint of its brand
// colour (PRD §4.1 — brand colours appear only as small logo chips).
import React from 'react';
import { Box } from '@mui/material';
import { alpha, darken } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { MarketplaceKey } from '@shared/types';
import {
  MARKETPLACE_BRAND_COLORS,
  MARKETPLACE_NAMES,
  MARKETPLACE_SHORT,
} from '@shared/constants';

export type MarketplaceBrandChipSize = 'sm' | 'md';

const CHIP_SIZES: Record<MarketplaceBrandChipSize, { box: number; radius: string; fontSize: string }> = {
  sm: { box: 28, radius: '8px', fontSize: '0.6875rem' },
  md: { box: 40, radius: '10px', fontSize: '0.875rem' },
};

export interface MarketplaceBrandChipProps {
  marketplaceKey: MarketplaceKey;
  size?: MarketplaceBrandChipSize;
}

export const MarketplaceBrandChip: React.FC<MarketplaceBrandChipProps> = ({
  marketplaceKey,
  size = 'md',
}) => {
  const brand = MARKETPLACE_BRAND_COLORS[marketplaceKey];
  const dimensions = CHIP_SIZES[size];
  return (
    <Box
      role="img"
      aria-label={`${MARKETPLACE_NAMES[marketplaceKey]} logo`}
      sx={(theme: Theme) => ({
        width: dimensions.box,
        height: dimensions.box,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: dimensions.radius,
        bgcolor: alpha(brand, theme.palette.mode === 'dark' ? 0.18 : 0.12),
        // The raw brand colour is too light to read on its own light tint.
        color: theme.palette.mode === 'dark' ? brand : darken(brand, 0.3),
        fontSize: dimensions.fontSize,
        fontWeight: 800,
        letterSpacing: '0.02em',
        lineHeight: 1,
        userSelect: 'none',
      })}
    >
      {MARKETPLACE_SHORT[marketplaceKey]}
    </Box>
  );
};

export default MarketplaceBrandChip;
