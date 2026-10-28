// KPI tile (PRD stat row): label with a soft icon tile on the right, a large
// tabular value, and an optional trend delta chip (green up / red down).
import React from 'react';
import { Box, Card, Skeleton, Stack, Typography } from '@mui/material';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';

export type StatCardTone = 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  // Colour of the icon tile.
  tone?: StatCardTone;
  // Percentage change vs previous period (e.g. 12.4 or -3.1).
  deltaPct?: number;
  deltaLabel?: string;
  loading?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  tone = 'primary',
  deltaPct,
  deltaLabel = 'vs last month',
  loading = false,
}) => {
  const hasDelta = typeof deltaPct === 'number' && Number.isFinite(deltaPct);
  const positive = hasDelta && deltaPct >= 0;
  const deltaTone = positive ? 'success' : 'error';
  const DeltaIcon = positive ? ArrowUpwardRoundedIcon : ArrowDownwardRoundedIcon;

  return (
    <Card
      sx={{
        p: '18px 18px 16px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: '0.78125rem', fontWeight: 600 }}
        >
          {label}
        </Typography>
        {icon && (
          <Box
            data-testid="stat-card-icon"
            sx={{
              width: 32,
              height: 32,
              borderRadius: '9px',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: `${tone}.weak`,
              color: `${tone}.main`,
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
          >
            {icon}
          </Box>
        )}
      </Stack>

      <Box>
        {loading ? (
          <Skeleton variant="text" width="70%" height={36} />
        ) : (
          <Typography
            component="p"
            sx={{
              fontSize: '1.5625rem',
              fontWeight: 800,
              lineHeight: 1.2,
              letterSpacing: '-0.03em',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </Typography>
        )}

        {loading ? (
          <Skeleton variant="text" width="45%" height={20} sx={{ mt: 0.5 }} />
        ) : (
          hasDelta && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: '7px' }}>
              <Box
                component="span"
                data-testid="stat-card-delta"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '2px',
                  px: '6px',
                  py: '1px',
                  borderRadius: '6px',
                  bgcolor: `${deltaTone}.weak`,
                  color: `${deltaTone}.main`,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <DeltaIcon aria-hidden="true" sx={{ fontSize: 13 }} />
                {positive ? '+' : ''}
                {deltaPct.toFixed(1)}%
              </Box>
              <Typography variant="caption" sx={{ color: 'textMuted', fontSize: '0.75rem' }}>
                {deltaLabel}
              </Typography>
            </Stack>
          )
        )}
      </Box>
    </Card>
  );
};

export default StatCard;
