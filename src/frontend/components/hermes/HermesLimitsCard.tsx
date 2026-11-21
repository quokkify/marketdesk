// The AI provider account's limits. They belong to the account, not the workspace, so the card
// says it is shared with all Hermes use.
import React from 'react';
import { Box, LinearProgress, Skeleton, Stack, Typography } from '@mui/material';
import type { HermesLimits } from '@shared/types';
import { Card } from '../common/Card.js';
import { LIMITS_SCOPE_CAPTION, LIMITS_UNAVAILABLE, limitsView } from './aiUsageText.js';

const PERCENT_MAX = 100;

export interface HermesLimitsCardProps {
  limits: HermesLimits | undefined;
  loading: boolean;
  failed: boolean;
}

const TONE_COLOR = { ok: 'primary', warning: 'warning', error: 'error' } as const;

export const HermesLimitsCard: React.FC<HermesLimitsCardProps> = ({ limits, loading, failed }) => {
  const view = limits ? limitsView(limits) : undefined;
  return (
    <Box data-testid="hermes-limits-card" sx={{ height: '100%' }}>
      <Card
        title="Hermes limits"
        subtitle={limits?.plan ? `${limits.plan} plan` : undefined}
        contentSx={{ p: 2 }}
      >
        {loading && !limits ? (
          <Skeleton variant="text" height={44} />
        ) : !view ? (
          <Typography variant="body2" color="text.secondary">
            {failed ? `${LIMITS_UNAVAILABLE} — the request failed` : LIMITS_UNAVAILABLE}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {view.bars.map((bar) => (
              <Box key={bar.label}>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {bar.label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {bar.percent === null ? 'not reported' : `${Math.round(bar.percent)}%`}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  color={TONE_COLOR[bar.tone]}
                  value={bar.percent === null ? 0 : Math.min(PERCENT_MAX, bar.percent)}
                  aria-label={`${bar.label} used`}
                />
                {bar.resetsAt && (
                  <Typography variant="caption" color="text.secondary">
                    resets {new Date(bar.resetsAt).toLocaleString()}
                  </Typography>
                )}
              </Box>
            ))}
            {view.note && (
              <Typography
                variant="body2"
                color={limits?.state === 'stale' ? 'warning.main' : 'text.secondary'}
              >
                {view.note}
              </Typography>
            )}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {LIMITS_SCOPE_CAPTION}
        </Typography>
      </Card>
    </Box>
  );
};
