// The response stage of a listing: stage line, the Why no response? button and the last findings.
import React from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ListingResponseRun, ListingResponseSignal } from '@shared/types';
import {
  ASK_WHY_LABEL,
  ASK_WHY_RUNNING_LABEL,
  OUT_OF_DATE_LABEL,
  canAskWhy,
  checkedLabel,
  responseLines,
  stageLabel,
} from './responseDisplay.js';

export interface ResponseSummaryProps {
  signal: ListingResponseSignal | null | undefined;
  run: ListingResponseRun | null;
  active?: boolean;
  outOfDate?: boolean;
  onAsk?: () => void;
  lineLimit?: number;
}

const DEFAULT_LINE_LIMIT = 2;

const ResponseSummary: React.FC<ResponseSummaryProps> = ({
  signal,
  run,
  active = false,
  outOfDate = false,
  onAsk,
  lineLimit = DEFAULT_LINE_LIMIT,
}) => {
  const stage = signal ? stageLabel(signal) : '';
  const checked = checkedLabel(run);
  const lines = responseLines(run, lineLimit);
  const showButton = Boolean(onAsk) && canAskWhy(signal ?? null, active);
  if (!stage && !checked && !active && !showButton) return null;
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0, mt: 0.5 }} data-testid="response-summary">
      {stage && (
        <Typography variant="caption" color="text.primary" data-testid="response-stage">
          {stage}
        </Typography>
      )}
      {active && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }} data-testid="response-running">
          <CircularProgress size={12} />
          <Typography variant="caption">{ASK_WHY_RUNNING_LABEL}</Typography>
        </Stack>
      )}
      {showButton && (
        <Button size="small" variant="outlined" onClick={onAsk} sx={{ alignSelf: 'flex-start' }} data-testid="response-ask">
          {ASK_WHY_LABEL}
        </Button>
      )}
      {!active && checked && (
        <Typography variant="caption" color="text.secondary" data-testid="response-checked">
          {checked}
          {outOfDate && (
            <Typography component="span" variant="caption" color="warning.main" data-testid="response-out-of-date">
              {` · ${OUT_OF_DATE_LABEL}`}
            </Typography>
          )}
        </Typography>
      )}
      {!active &&
        lines.map((line) => (
          <Typography key={line} variant="caption" color="text.secondary" title={line} data-testid="response-line">
            {line}
          </Typography>
        ))}
    </Stack>
  );
};

export default ResponseSummary;
