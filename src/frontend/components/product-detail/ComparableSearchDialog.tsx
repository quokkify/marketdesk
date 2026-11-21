// The adverts a market search found: the owner ticks the ones that are really comparable and adds
// them to the price research. Titles come from the web, so they are only ever rendered as text.
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Link, Stack, Typography } from '@mui/material';
import type { ComparableCandidate } from '@shared/types';
import { normalizeOlxAdvertUrl } from '@shared/olxAdvertUrl';
import { Modal } from '../common/Modal.js';
import { formatMoney } from '../../utils/formatters.js';
import { MAX_COMPARABLES, selectionFits, type PriceResearchForm } from './priceResearchModel.js';

export const NO_COMPARABLES_MESSAGE = 'No comparable adverts found';
export const CAP_MESSAGE = `Keep at most ${MAX_COMPARABLES} comparables — untick some`;

export interface ComparableSearchDialogProps {
  open: boolean;
  candidates: ComparableCandidate[];
  form: PriceResearchForm;
  saving: boolean;
  onClose: () => void;
  onAdd: (picked: ComparableCandidate[]) => void;
}

export const ComparableSearchDialog: React.FC<ComparableSearchDialogProps> = ({
  open,
  candidates,
  form,
  saving,
  onClose,
  onAdd,
}) => {
  const known = useMemo(
    () => new Set(form.comparables.map((row) => (row.url ? normalizeOlxAdvertUrl(row.url) : null))),
    [form.comparables],
  );
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());

  const isKnown = (c: ComparableCandidate) => known.has(normalizeOlxAdvertUrl(c.url));
  const picked = candidates.filter((c) => !isKnown(c) && !unticked.has(c.url));
  const fits = selectionFits(form, picked.length);

  const toggle = (url: string) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (!next.delete(url)) next.add(url);
      return next;
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      maxWidth="md"
      title={`Found on OLX (${candidates.length})`}
      subtitle="Tick the adverts that match your product. Prices are asking prices, not sales."
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            disabled={saving || picked.length === 0 || !fits}
            onClick={() => onAdd(picked)}
            data-testid="comparable-search-add"
          >
            {`Add ${picked.length} selected`}
          </Button>
        </>
      }
    >
      <Stack spacing={1} data-testid="comparable-search-dialog">
        {candidates.length === 0 && <Typography>{NO_COMPARABLES_MESSAGE}</Typography>}
        {candidates.map((c) => {
          const already = isKnown(c);
          return (
            <Stack key={c.url} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <FormControlLabel
                sx={{ flex: 1, minWidth: 0, mr: 0 }}
                control={
                  <Checkbox
                    checked={already || !unticked.has(c.url)}
                    disabled={already || saving}
                    onChange={() => toggle(c.url)}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" component="span" sx={{ fontWeight: 700, mr: 1 }}>
                      {formatMoney(c.price, c.currency)}
                    </Typography>
                    <Typography variant="body2" component="span">{c.title}</Typography>
                    {already && (
                      <Typography variant="caption" color="text.secondary" component="span" sx={{ ml: 1 }}>
                        already added
                      </Typography>
                    )}
                  </Box>
                }
              />
              {normalizeOlxAdvertUrl(c.url) !== null && (
                <Link href={c.url} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                  Open on OLX
                </Link>
              )}
            </Stack>
          );
        })}
        {!fits && <Alert severity="warning">{CAP_MESSAGE}</Alert>}
      </Stack>
    </Modal>
  );
};
