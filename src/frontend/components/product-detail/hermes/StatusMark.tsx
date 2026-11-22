// The round status mark shared by the Hermes card rows and the history steps: a glyph, never colour alone.
import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { RowStatus } from './hermesCardModel.js';

export const MARK_SIZE = 20;
// Rows and the gap above the price row's mark, in px; the connector spans them.
export const ROW_PAD_Y = 10;

export const STATUS_TEXT: Record<RowStatus, string> = {
  ok: 'Done',
  bad: 'Needs a fix',
  attention: 'Needs you',
  running: 'Running',
  idle: 'Not run',
};

const STATUS_GLYPH: Record<Exclude<RowStatus, 'running'>, string> = {
  ok: '✓',
  bad: '✗',
  attention: '!',
  idle: '–',
};

const STATUS_COLOR: Record<RowStatus, 'success' | 'error' | 'warning' | 'primary' | 'grey'> = {
  ok: 'success',
  bad: 'error',
  attention: 'warning',
  running: 'primary',
  idle: 'grey',
};

export const StatusMark: React.FC<{ status: RowStatus; fed?: boolean }> = ({ status, fed }) => (
  <Box
    component="span"
    aria-hidden
    sx={(theme) => {
      const tone = STATUS_COLOR[status];
      const main = tone === 'grey' ? theme.palette.text.secondary : theme.palette[tone].main;
      return {
        position: 'relative',
        width: MARK_SIZE,
        height: MARK_SIZE,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        color: main,
        bgcolor: status === 'running' ? 'transparent' : alpha(main, 0.14),
        // The price check reads the market prices in the row above: the connector says so.
        ...(fed && {
          '&::before': {
            content: '""',
            position: 'absolute',
            left: MARK_SIZE / 2 - 1,
            bottom: '100%',
            width: 2,
            height: ROW_PAD_Y + 1,
            bgcolor: 'divider',
          },
        }),
      };
    }}
  >
    {status === 'running' ? (
      <CircularProgress
        size={MARK_SIZE - 4}
        thickness={5}
        sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
      />
    ) : (
      STATUS_GLYPH[status]
    )}
  </Box>
);
