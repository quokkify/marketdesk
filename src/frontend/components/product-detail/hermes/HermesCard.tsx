// The one Hermes card in the product rail: renders a HermesCardState as given, with no decisions of its own.
import React from 'react';
import { Box, Button, ButtonBase, Chip, Link, Stack, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Card } from '../../common/Card.js';
import type { HermesCardRow, HermesCardState, HermesDrawerTab, ResponseCardState } from './hermesCardModel.js';
import {
  ASK_WHY_LABEL,
  ASK_WHY_RUNNING_LABEL,
  OUT_OF_DATE_LABEL,
  RESPONSE_ACTION_LABELS,
} from '../../products/responseDisplay.js';
import type { ResponseActionKind } from '../../products/responseDisplay.js';
import { LAST_RUN_FAILED_LABEL } from '../../products/verdictDisplay.js';
import { MARK_SIZE, ROW_PAD_Y, STATUS_TEXT, StatusMark } from './StatusMark.js';

export interface HermesCardProps {
  state: HermesCardState;
  analyzeDisabledReason: string | null;
  // Who answers the analysis, under the actions.
  note?: string;
  // Why the last analyze request was refused.
  error?: string | null;
  busy: boolean;
  onAnalyze: () => void;
  onSetPrice: (eventId: string) => void;
  onOpen: (tab: HermesDrawerTab) => void;
  response?: ResponseCardState | null;
  onAskWhy?: () => void;
  onResponseAction?: (action: Exclude<ResponseActionKind, 'hint'>) => void;
}

const ResponseSection: React.FC<{
  response: ResponseCardState;
  busy: boolean;
  onAskWhy?: () => void;
  onAction?: (action: Exclude<ResponseActionKind, 'hint'>) => void;
}> = ({ response, busy, onAskWhy, onAction }) => (
  <Stack spacing={0.75} useFlexGap data-testid="hermes-response">
    {response.stage && (
      <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="hermes-response-stage">
        {response.stage}
      </Typography>
    )}
    {response.active && (
      <Typography variant="caption" data-testid="hermes-response-running">
        {ASK_WHY_RUNNING_LABEL}
      </Typography>
    )}
    {response.canAsk && onAskWhy && (
      <Button variant="outlined" size="small" disabled={busy} onClick={onAskWhy} sx={{ alignSelf: 'flex-start' }} data-testid="hermes-response-ask">
        {ASK_WHY_LABEL}
      </Button>
    )}
    {response.lastFailed && !response.active && (
      <Typography variant="caption" color="error" data-testid="hermes-response-failed">
        {LAST_RUN_FAILED_LABEL}
      </Typography>
    )}
    {!response.active && response.checked && (
      <Typography variant="caption" color="text.secondary" data-testid="hermes-response-checked">
        {response.checked}
        {response.outOfDate && (
          <Typography component="span" variant="caption" color="warning.main" data-testid="hermes-response-out-of-date">
            {` · ${OUT_OF_DATE_LABEL}`}
          </Typography>
        )}
      </Typography>
    )}
    {!response.active &&
      response.findings.map((finding, index) => (
        <Stack key={`${index}-${finding.message}`} spacing={0.25} data-testid="hermes-response-finding">
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {finding.message}
          </Typography>
          {finding.control === 'hint' && (
            <Typography variant="caption" color="text.secondary" data-testid="hermes-response-hint">
              {RESPONSE_ACTION_LABELS.hint}
            </Typography>
          )}
          {finding.control && finding.control !== 'hint' && onAction && (
            <Link
              component="button"
              type="button"
              variant="caption"
              disabled={busy}
              onClick={() => onAction(finding.control as Exclude<ResponseActionKind, 'hint'>)}
              sx={{ alignSelf: 'flex-start' }}
              data-testid={`hermes-response-action-${finding.control}`}
            >
              {RESPONSE_ACTION_LABELS[finding.control]}
            </Link>
          )}
        </Stack>
      ))}
  </Stack>
);

const StepRow: React.FC<{ row: HermesCardRow; onOpen: (tab: HermesDrawerTab) => void }> = ({ row, onOpen }) => {
  const feeds = row.key === 'prices';
  return (
    <ButtonBase
      onClick={() => onOpen(row.tab)}
      data-testid={`hermes-row-${row.key}`}
      sx={{
        display: 'grid',
        gridTemplateColumns: `${MARK_SIZE}px minmax(0, 1fr) auto`,
        columnGap: 1.25,
        rowGap: 0.25,
        alignItems: 'start',
        justifyItems: 'stretch',
        width: '100%',
        px: 2.5,
        py: `${ROW_PAD_Y}px`,
        textAlign: 'left',
        borderBottom: 1,
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <Stack component="span" sx={{ gridRow: '1 / 3', alignSelf: 'stretch', alignItems: 'center' }}>
        <StatusMark status={row.status} fed={row.key === 'price'} />
        {feeds && <Box component="span" aria-hidden sx={{ flexGrow: 1, width: 2, minHeight: 8, mb: `-${ROW_PAD_Y}px`, bgcolor: 'divider' }} />}
      </Stack>
      <Typography variant="body2" component="span" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        <Box component="span" sx={visuallyHidden}>{`${STATUS_TEXT[row.status]}: `}</Box>
        {row.title}
      </Typography>
      <Typography variant="body2" component="span" sx={{ fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>
        {row.value}
      </Typography>
      {row.detail && (
        <Typography
          variant="caption"
          component="span"
          color="text.secondary"
          sx={{ gridColumn: '2 / 4', overflowWrap: 'anywhere' }}
        >
          {row.detail}
        </Typography>
      )}
    </ButtonBase>
  );
};

export const HermesCard: React.FC<HermesCardProps> = ({
  state,
  analyzeDisabledReason,
  note,
  error,
  busy,
  onAnalyze,
  onSetPrice,
  onOpen,
  response,
  onAskWhy,
  onResponseAction,
}) => {
  const analyzeBlocked = busy || analyzeDisabledReason !== null;
  const { primary } = state;
  return (
    <Box data-testid="hermes-card">
      <Card
        title="Hermes"
        action={
          <Chip
            size="small"
            label={state.chip.label}
            color={state.chip.color}
            variant={state.chip.outlined ? 'outlined' : 'filled'}
            data-testid="hermes-chip"
          />
        }
      >
        <Stack spacing={1.5} useFlexGap>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, textWrap: 'balance' }} data-testid="hermes-lead">
            {state.lead}
          </Typography>
          {(primary.kind !== 'none' || state.showAnalyzeAgain) && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {primary.kind === 'analyze' && (
                <Button variant="contained" disabled={analyzeBlocked} onClick={onAnalyze} data-testid="hermes-primary-action">
                  {primary.label}
                </Button>
              )}
              {primary.kind === 'set_price' && (
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => onSetPrice(primary.eventId)}
                  data-testid="hermes-primary-action"
                >
                  {primary.label}
                </Button>
              )}
              {state.showAnalyzeAgain && (
                <Button variant="outlined" disabled={analyzeBlocked} onClick={onAnalyze} data-testid="hermes-analyze-again">
                  Analyze again
                </Button>
              )}
            </Stack>
          )}
          {analyzeDisabledReason && (
            <Typography variant="caption" color="text.secondary">
              {analyzeDisabledReason}
            </Typography>
          )}
          {error && (
            <Typography variant="caption" color="error.main" role="alert" data-testid="hermes-analyze-error">
              {error}
            </Typography>
          )}
          {note && (
            <Typography variant="caption" color="text.secondary" data-testid="hermes-provider-note">
              {note}
            </Typography>
          )}
          {response && <ResponseSection response={response} busy={busy} onAskWhy={onAskWhy} onAction={onResponseAction} />}
          <Box sx={{ mx: -2.5, borderTop: 1, borderColor: 'divider' }}>
            {state.rows.map((row) => (
              <StepRow key={row.key} row={row} onOpen={onOpen} />
            ))}
          </Box>
          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Typography variant="caption" color="text.secondary">{state.footer}</Typography>
            <Link
              component="button"
              type="button"
              variant="caption"
              onClick={() => onOpen('history')}
              data-testid="hermes-history-link"
            >
              Log and history
            </Link>
          </Stack>
        </Stack>
      </Card>
    </Box>
  );
};
