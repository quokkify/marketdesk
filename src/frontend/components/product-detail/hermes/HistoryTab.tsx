// The Log and history tab of the Hermes drawer: every analysis, price search and suggestion of the
// product, newest first. Each entry opens to its steps.
import React, { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ErrorRetry } from '../../common/ErrorRetry.js';
import { LoadingSkeleton } from '../../common/Skeleton.js';
import { formatDateTime } from '../../../utils/formatters.js';
import { defaultExpandedId, formatDuration, type HistoryEntry, type HistoryStep } from './hermesHistory.js';
import type { RowStatus } from './hermesCardModel.js';
import { STATUS_TEXT, StatusMark } from './StatusMark.js';

export const PAGE_SIZE = 10;
export const EMPTY_MESSAGE =
  'No runs yet. Every analysis and every price search will be listed here with its steps.';

const CHIP_COLOR = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  default: 'default',
} as const;

function stepStatus(step: HistoryStep): RowStatus {
  if (step.status === 'ok') return 'ok';
  if (step.status === 'bad') return 'bad';
  if (step.status === 'attention') return 'attention';
  return step.detail === 'Running' ? 'running' : 'idle';
}

function headline(entry: HistoryEntry): string {
  return entry.title === 'Suggestion' && entry.steps[0] ? `Suggestion · ${entry.steps[0].label}` : entry.title;
}

const EntryHeader: React.FC<{ entry: HistoryEntry }> = ({ entry }) => {
  const meta = [formatDateTime(entry.at), `started by ${entry.startedBy}`];
  if (entry.durationMs !== null) meta.push(formatDuration(entry.durationMs));
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {headline(entry)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {meta.join(' · ')}
        </Typography>
      </Box>
      <Chip
        size="small"
        label={entry.outcome.label}
        color={CHIP_COLOR[entry.outcome.tone]}
        variant={entry.outcome.tone === 'default' ? 'outlined' : 'filled'}
        data-testid="history-entry-outcome"
        sx={{ flexShrink: 0 }}
      />
    </Stack>
  );
};

const EntryRow: React.FC<{ entry: HistoryEntry; defaultExpanded: boolean }> = ({ entry, defaultExpanded }) =>
  entry.steps.length === 0 ? (
    <Box data-testid="history-entry" sx={{ px: 2, py: 1.25 }}>
      <EntryHeader entry={entry} />
    </Box>
  ) : (
    <Accordion
      disableGutters
      square
      elevation={0}
      defaultExpanded={defaultExpanded}
      data-testid="history-entry"
      sx={{ '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <EntryHeader entry={entry} />
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Stack spacing={1} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {entry.steps.map((step, index) => {
            const status = stepStatus(step);
            return (
              <Stack
                key={`${index}:${step.label}`}
                component="li"
                direction="row"
                spacing={1.25}
                data-testid="history-step"
                sx={{ alignItems: 'flex-start' }}
              >
                <StatusMark status={status} />
                <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <Box component="span" sx={visuallyHidden}>{`${STATUS_TEXT[status]}: `}</Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>{step.label}</Box>
                  {step.detail && <Box component="span" color="text.secondary">{` · ${step.detail}`}</Box>}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );

export interface HistoryTabProps {
  entries: HistoryEntry[];
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ entries, loading, error, onRetry }) => {
  const [shown, setShown] = useState(PAGE_SIZE);
  const expandedId = defaultExpandedId(entries);
  if (loading) return <LoadingSkeleton lines={3} height={56} />;
  if (error) return <ErrorRetry error={error} onRetry={onRetry} title="History unavailable" />;
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="history-empty">
        {EMPTY_MESSAGE}
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5}>
      <Stack sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', '& > * + *': { borderTop: 1, borderColor: 'divider' } }}>
        {entries.slice(0, shown).map((entry) => (
          <EntryRow key={entry.id} entry={entry} defaultExpanded={entry.id === expandedId} />
        ))}
      </Stack>
      {entries.length > shown && (
        <Button variant="outlined" onClick={() => setShown(shown + PAGE_SIZE)} data-testid="history-show-more" sx={{ alignSelf: 'flex-start' }}>
          Show more
        </Button>
      )}
    </Stack>
  );
};
