// Semantic status/severity chips in the PRD style: weak-tint background,
// tone-coloured text and a status dot. A generic <Badge> plus typed wrappers
// that map the domain unions (ARCHITECTURE §3) to consistent tones + labels;
// values outside a union (e.g. from a newer API) fall back to a neutral chip.
import React from 'react';
import { Box, Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type {
  ProductStatus,
  ListingStatus,
  HermesSeverity,
  HermesEventStatus,
  AutonomyDecision,
  MarketplaceAccountStatus,
} from '@shared/types';

type ChipColor = ChipProps['color'];

export interface BadgeProps {
  label: string;
  color?: ChipColor;
  // 'filled' is the weak-tint chip; 'outlined' keeps a transparent background.
  variant?: ChipProps['variant'];
  size?: ChipProps['size'];
  // Replaces the status dot.
  icon?: ChipProps['icon'];
}

function toneColors(theme: Theme, color: ChipColor): { text: string; background: string } {
  if (!color || color === 'default') {
    return { text: theme.palette.text.secondary, background: theme.palette.surface3 };
  }
  return { text: theme.palette[color].main, background: theme.palette[color].weak };
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  color = 'default',
  variant = 'filled',
  size = 'small',
  icon,
}) => (
  <Chip
    size={size}
    icon={icon}
    label={
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        {!icon && (
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: 'currentColor',
              flexShrink: 0,
            }}
          />
        )}
        {label}
      </Box>
    }
    sx={(theme) => {
      const tone = toneColors(theme, color);
      return {
        height: size === 'small' ? 22 : 26,
        borderRadius: '7px',
        fontSize: size === 'small' ? '0.71875rem' : '0.78125rem',
        fontWeight: 700,
        color: tone.text,
        bgcolor: variant === 'outlined' ? 'transparent' : tone.background,
        border: variant === 'outlined' ? `1px solid ${alpha(tone.text, 0.4)}` : 'none',
        '& .MuiChip-label': { px: '9px' },
        '& .MuiChip-icon': { color: tone.text, fontSize: 14, ml: '7px', mr: '-5px' },
      };
    }}
  />
);

interface BadgeMeta {
  label: string;
  color: ChipColor;
}

function humanizeValue(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'Unknown';
  const words = value.trim().replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function resolveMeta<T extends string>(map: Record<T, BadgeMeta>, value: T): BadgeMeta {
  return Object.prototype.hasOwnProperty.call(map, value)
    ? map[value]
    : { label: humanizeValue(value), color: 'default' };
}

const PRODUCT_STATUS_META: Record<ProductStatus, BadgeMeta> = {
  draft: { label: 'Draft', color: 'default' },
  active: { label: 'Active', color: 'success' },
  attention: { label: 'Needs attention', color: 'warning' },
  sold: { label: 'Sold', color: 'info' },
};

const LISTING_STATUS_META: Record<ListingStatus, BadgeMeta> = {
  live: { label: 'Live', color: 'success' },
  draft: { label: 'Draft', color: 'default' },
  expired: { label: 'Expired', color: 'warning' },
  error: { label: 'Error', color: 'error' },
};

const SEVERITY_META: Record<HermesSeverity, BadgeMeta> = {
  info: { label: 'Info', color: 'info' },
  success: { label: 'Success', color: 'success' },
  warning: { label: 'Warning', color: 'warning' },
  critical: { label: 'Critical', color: 'error' },
};

const HERMES_STATUS_META: Record<HermesEventStatus, BadgeMeta> = {
  pending_decision: { label: 'Decision pending', color: 'info' },
  pending_review: { label: 'Pending review', color: 'warning' },
  applying: { label: 'Applying', color: 'info' },
  applied: { label: 'Applied', color: 'success' },
  dismissed: { label: 'Dismissed', color: 'default' },
  failed: { label: 'Action failed', color: 'error' },
  reverting: { label: 'Reverting', color: 'info' },
  reverted: { label: 'Reverted', color: 'default' },
};

const DECISION_META: Record<AutonomyDecision, BadgeMeta> = {
  auto_apply: { label: 'Auto-applied', color: 'secondary' },
  pending_review: { label: 'Awaiting approval', color: 'warning' },
};

const CONNECTION_META: Record<MarketplaceAccountStatus, BadgeMeta> = {
  connected: { label: 'Connected', color: 'success' },
  disconnected: { label: 'Disconnected', color: 'default' },
  error: { label: 'Error', color: 'error' },
};

export const ProductStatusBadge: React.FC<{ status: ProductStatus }> = ({ status }) => (
  <Badge {...resolveMeta(PRODUCT_STATUS_META, status)} />
);

export const ListingStatusBadge: React.FC<{ status: ListingStatus }> = ({ status }) => (
  <Badge {...resolveMeta(LISTING_STATUS_META, status)} />
);

export const HermesSeverityBadge: React.FC<{ severity: HermesSeverity }> = ({ severity }) => (
  <Badge {...resolveMeta(SEVERITY_META, severity)} />
);

export const HermesStatusBadge: React.FC<{ status: HermesEventStatus }> = ({ status }) => (
  <Badge {...resolveMeta(HERMES_STATUS_META, status)} />
);

export const AutonomyDecisionBadge: React.FC<{ decision: AutonomyDecision }> = ({ decision }) => (
  <Badge {...resolveMeta(DECISION_META, decision)} />
);

export const ConnectionBadge: React.FC<{ status: MarketplaceAccountStatus }> = ({ status }) => (
  <Badge {...resolveMeta(CONNECTION_META, status)} />
);

export default Badge;
