// AI calls made by this workspace: analyses today and over the last 7 days, tokens only where reported.
import React from 'react';
import { Box, Skeleton, Stack, Typography } from '@mui/material';
import type { AiUsageReport } from '@shared/types';
import { Card } from '../common/Card.js';
import { REFRESH_FAILED_NOTE, totalTokensText } from './aiUsageText.js';

export interface AiUsageCardProps {
  usage: AiUsageReport | undefined;
  loading: boolean;
  failed: boolean;
}

const COST_TEXT: Record<AiUsageReport['costStatus'], string> = {
  included: 'Included in subscription',
  mixed: 'Cost: mixed',
  unknown: 'Cost unknown',
  not_applicable: 'No AI cost',
};

export const AiUsageCard: React.FC<AiUsageCardProps> = ({ usage, loading, failed }) => (
  <Box data-testid="ai-usage-card" sx={{ height: '100%' }}>
    <Card
      title="AI usage"
      subtitle={usage ? `Day boundaries in ${usage.timezone}` : undefined}
      contentSx={{ p: 2 }}
    >
      {loading && !usage ? (
        <Skeleton variant="text" height={44} />
      ) : !usage ? (
        <Typography variant="body2" color="text.secondary">
          {failed ? 'Usage unavailable — the request failed' : 'Usage unavailable'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {failed && (
            <Typography variant="body2" color="warning.main">
              {REFRESH_FAILED_NOTE}
            </Typography>
          )}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
              Analyses today
            </Typography>
            <Typography
              data-testid="ai-usage-analyses-today"
              variant="h4"
              sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}
            >
              {usage.today.analyses}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {`Hermes ${usage.today.hermesAnalyses} · offline ${usage.today.offlineAnalyses} · failed ${usage.today.failedAnalyses} · ${totalTokensText(usage.today)}`}
            </Typography>
          </Box>
          <Typography variant="body2">
            {`Last 7 days: ${usage.last7Days.analyses} analyses · ${totalTokensText(usage.last7Days)}`}
          </Typography>
          {usage.byFeature.map((f) => (
            <Typography key={f.feature} variant="caption" color="text.secondary">
              {`${f.feature}: ${f.analyses} · ${f.totalTokens === null ? 'usage not reported' : `${f.totalTokens.toLocaleString('en-US')} tokens`}`}
            </Typography>
          ))}
          <Typography variant="caption" color="text.secondary">
            {COST_TEXT[usage.costStatus]}
          </Typography>
        </Stack>
      )}
    </Card>
  </Box>
);
