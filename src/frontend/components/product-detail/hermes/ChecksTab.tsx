// The Checks tab of the Hermes drawer: every check of the latest verdict with all its reasons, the
// price fix, and the publication readiness check below them.
import React from 'react';
import { Box, Button, Divider, Link, Stack, Typography } from '@mui/material';
import type { SaleVerdict, VerdictCheckName } from '@shared/types';
import { formatRelative } from '../../../utils/formatters.js';
import { checkLabel } from '../../products/verdictDisplay.js';

export interface ChecksTabProps {
  verdict: SaleVerdict | null;
  // The price fix the card offers, if any.
  setPrice: { label: string; eventId: string } | null;
  busy: boolean;
  // An analysis is running, so a missing verdict is on its way.
  running: boolean;
  now: Date;
  onSetPrice: (eventId: string) => void;
  onOpenPrices: () => void;
  onEdit: () => void;
  // The publication readiness check, rendered under the verdict checks.
  children?: React.ReactNode;
}

const CHECKS: ReadonlyArray<{ name: VerdictCheckName; title: string }> = [
  { name: 'price', title: 'Price' },
  { name: 'info', title: 'Info' },
  { name: 'photos', title: 'Photos' },
];

export const ChecksTab: React.FC<ChecksTabProps> = ({
  verdict,
  setPrice,
  busy,
  running,
  now,
  onSetPrice,
  onOpenPrices,
  onEdit,
  children,
}) => (
  <Stack spacing={3}>
    {verdict ? (
      <Stack divider={<Divider />} sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
        {CHECKS.map(({ name, title }) => {
          const check = verdict.checks[name];
          const fix = name === 'price' ? setPrice : null;
          const editable = check?.reasons.some((reason) => reason.field) ?? false;
          return (
            <Stack key={name} spacing={0.75} sx={{ p: 1.5, minWidth: 0 }} data-testid={`hermes-check-${name}`}>
              <Typography variant="subtitle2" component="h3" sx={{ overflowWrap: 'anywhere' }}>
                {check ? checkLabel(check) : title}
              </Typography>
              {!check ? (
                <Typography variant="body2" color="text.secondary">Not checked yet.</Typography>
              ) : (
                <>
                  {check.reasons.map((reason) => (
                    <Typography key={`${reason.code}:${reason.message}`} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {reason.message}
                    </Typography>
                  ))}
                  <Typography variant="caption" color="text.secondary">
                    {`Checked ${formatRelative(check.checkedAt, now)}`}
                  </Typography>
                  {name === 'price' && (
                    <Box>
                      <Link component="button" type="button" variant="body2" onClick={onOpenPrices}>
                        See the prices
                      </Link>
                    </Box>
                  )}
                  {(fix || editable) && (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {fix && (
                        <Button variant="contained" disabled={busy} onClick={() => onSetPrice(fix.eventId)}>
                          {fix.label}
                        </Button>
                      )}
                      {editable && <Button variant="outlined" onClick={onEdit}>Edit product</Button>}
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          );
        })}
      </Stack>
    ) : (
      <Typography variant="body2" color="text.secondary">
        {running ? 'Checking…' : 'Not checked yet. Run Analyze to get a verdict.'}
      </Typography>
    )}
    {children}
  </Stack>
);
