// The sale verdict of a product: overall label, one mark per check, and the leading reason.
import React from 'react';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SaleVerdict } from '@shared/types';
import {
  LAST_RUN_FAILED_LABEL,
  STALE_LABEL,
  VERDICT_CHECK_ORDER,
  checkAge,
  checkLabel,
  leadingReason,
  newestCheckAt,
  overallColor,
  overallLabel,
} from './verdictDisplay.js';

export interface VerdictSummaryProps {
  verdict: SaleVerdict | null | undefined;
  // A run is in progress: its checks are not in the verdict yet.
  running?: boolean;
  lastFailed?: boolean;
  stale?: boolean;
  // The row variant keeps one line of checks and one of reason; the page variant has no limit.
  compact?: boolean;
}

const VerdictSummary: React.FC<VerdictSummaryProps> = ({
  verdict,
  running = false,
  lastFailed = false,
  stale = false,
  compact = false,
}) => {
  if (!verdict && !running && !lastFailed) return null;
  const label = verdict ? overallLabel(verdict.overall) : null;
  const newest = verdict ? newestCheckAt(verdict) : null;
  const reason = verdict ? leadingReason(verdict) : null;
  const now = Date.now();
  return (
    <Stack spacing={0.25} data-testid="verdict-summary" sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.25 }}>
        {label && (
          <Chip
            size="small"
            label={label}
            color={overallColor(verdict?.overall ?? null)}
            variant={stale ? 'outlined' : 'filled'}
            data-testid="verdict-overall"
          />
        )}
        {running && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }} data-testid="verdict-running">
            <CircularProgress size={12} />
            <Typography variant="caption">Analyzing…</Typography>
          </Stack>
        )}
        {verdict &&
          VERDICT_CHECK_ORDER.map((name) => {
            const check = verdict.checks[name];
            if (!check) return null;
            const age = checkAge(check, newest, now);
            return (
              <Typography
                key={name}
                variant="caption"
                color={check.status === 'ready' ? 'text.secondary' : 'text.primary'}
                sx={{ whiteSpace: 'nowrap' }}
                data-testid={`verdict-check-${name}`}
              >
                {age ? `${checkLabel(check)} · ${age}` : checkLabel(check)}
              </Typography>
            );
          })}
        {lastFailed && (
          <Typography variant="caption" color="error" data-testid="verdict-last-failed">
            {LAST_RUN_FAILED_LABEL}
          </Typography>
        )}
        {stale && (
          <Typography variant="caption" color="warning.main" data-testid="verdict-stale">
            {STALE_LABEL}
          </Typography>
        )}
      </Stack>
      {reason && (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap={compact}
          title={reason}
          data-testid="verdict-reason"
        >
          {reason}
        </Typography>
      )}
    </Stack>
  );
};

export default VerdictSummary;
