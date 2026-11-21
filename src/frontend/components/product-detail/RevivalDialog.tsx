// Bringing an expired OLX advert back: Hermes proposes copy and price changes, the owner ticks what
// to apply and fills the missing facts, and one click saves them and revives the advert.
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { Product, RevivalProposal } from '@shared/types';
import { Modal } from '../common/Modal.js';
import { aiUsageLine } from '../hermes/aiUsageText.js';
import { useGetRevivalProposal, useReviveListing } from '../../services/hooks/index.js';
import type { ReviveListingResult } from '../../state/api/listingsApi.js';
import { formatMoney } from '../../utils/formatters.js';
import { CONDITION_LABELS, CONDITION_LIST } from '../../utils/labels.js';
import {
  aiIssuesNote,
  parseCostPrice,
  requestErrorMessage,
  revivalFailureMessage,
  revivalView,
  type RevivalForm,
} from './revivalView.js';

export interface RevivalDialogProps {
  open: boolean;
  listingId: string;
  product: Product;
  currency: string;
  onClose: () => void;
  // The advert is back (any reactivation outcome); the page shows the toast.
  onRevived: (result: ReviveListingResult) => void;
}

interface Timestamps {
  productUpdatedAt: string;
  listingUpdatedAt: string;
}

function initialForm(proposal: RevivalProposal, condition: Product['condition']): RevivalForm {
  return {
    condition,
    costPrice: '',
    useTitle: proposal.title !== undefined,
    useDescription: proposal.description !== undefined,
    usePrice: proposal.price !== undefined && proposal.priceGuard.status !== 'below_cost',
    allowBelowCost: false,
  };
}

const Change: React.FC<{ label: string; current: string; proposed: string; rationale: string; checked: boolean; onChange: (checked: boolean) => void }> = ({
  label, current, proposed, rationale, checked, onChange,
}) => (
  <Box>
    <FormControlLabel
      control={<Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label={<Typography variant="subtitle2">{label}</Typography>}
    />
    <Typography variant="body2" color="text.secondary" sx={{ pl: 4, textDecoration: 'line-through', overflowWrap: 'anywhere' }}>{current}</Typography>
    <Typography variant="body2" sx={{ pl: 4, overflowWrap: 'anywhere' }}>{proposed}</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ pl: 4, display: 'block' }}>{rationale}</Typography>
  </Box>
);

export const RevivalDialog: React.FC<RevivalDialogProps> = ({ open, listingId, product, currency: productCurrency, onClose, onRevived }) => {
  const [getProposal, { isLoading: loadingProposal }] = useGetRevivalProposal();
  const [revive, { isLoading: reviving }] = useReviveListing();
  const [proposal, setProposal] = useState<RevivalProposal | null>(null);
  const [form, setForm] = useState<RevivalForm | null>(null);
  const [timestamps, setTimestamps] = useState<Timestamps | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setProposal(null);
    setForm(null);
    setLoadError(null);
    setApplyError(null);
    getProposal(listingId)
      .unwrap()
      .then((next) => {
        if (cancelled) return;
        setProposal(next);
        setForm(initialForm(next, product.condition));
        setTimestamps({ productUpdatedAt: next.productUpdatedAt, listingUpdatedAt: next.listingUpdatedAt });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(requestErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
    // The proposal is fetched once per opening; the product prop only seeds the condition.
  }, [open, listingId]);

  const view = proposal && form ? revivalView(proposal, form) : null;
  const currency = proposal?.price?.currency ?? productCurrency;
  const patch = (changes: Partial<RevivalForm>) => setForm((current) => (current ? { ...current, ...changes } : current));

  const handleApply = async () => {
    if (!proposal || !form || !view || !timestamps) return;
    const costPrice = parseCostPrice(form.costPrice);
    setApplyError(null);
    try {
      const result = await revive({
        id: listingId,
        condition: form.condition,
        ...(costPrice !== null ? { costPrice } : {}),
        ...(form.useTitle && proposal.title ? { title: proposal.title.proposed } : {}),
        ...(form.useDescription && proposal.description ? { description: proposal.description.proposed } : {}),
        ...(form.usePrice && proposal.price ? { price: proposal.price.proposed } : {}),
        ...(view.priceRow.needsBelowCostConfirmation && form.allowBelowCost ? { allowBelowCost: true } : {}),
        ...timestamps,
      }).unwrap();
      setTimestamps({ productUpdatedAt: result.productUpdatedAt, listingUpdatedAt: result.listingUpdatedAt });
      if (result.step === 'done') {
        onRevived(result);
        onClose();
      } else {
        setApplyError(revivalFailureMessage(result));
      }
    } catch (err) {
      setApplyError(requestErrorMessage(err));
    }
  };

  const issuesNote = proposal ? aiIssuesNote(proposal.aiIssues) : '';
  const usage = proposal ? aiUsageLine(proposal.aiUsage) : '';
  const noProposal = proposal && !proposal.title && !proposal.description && !proposal.price && proposal.aiIssues.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={reviving}
      title="Revive on OLX"
      subtitle="Hermes proposes changes. Tick what to apply; nothing is sent to OLX until you apply."
      maxWidth="md"
      fullScreenOnMobile
      actions={
        <>
          <Button onClick={onClose} disabled={reviving}>Cancel</Button>
          <Button variant="contained" disabled={!view?.canApply || reviving} onClick={() => void handleApply()}>
            Apply and bring back on OLX
          </Button>
        </>
      }
    >
      <Box data-testid="revival-dialog">
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {!loadError && (!proposal || !form || !view) && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">{loadingProposal ? 'Asking Hermes for proposals…' : 'Loading…'}</Typography>
          </Stack>
        )}
        {proposal && form && view && (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                fullWidth
                label="Condition"
                value={form.condition}
                onChange={(event) => patch({ condition: event.target.value as RevivalForm['condition'] })}
                helperText={proposal.missingFacts.find((fact) => fact.field === 'condition')?.note}
                data-testid="revival-condition"
              >
                {CONDITION_LIST.map((condition) => (
                  <MenuItem key={condition} value={condition}>{CONDITION_LABELS[condition]}</MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                label="Cost price"
                value={form.costPrice}
                onChange={(event) => patch({ costPrice: event.target.value })}
                placeholder={proposal.priceGuard.costPrice === null ? 'Not set' : formatMoney(proposal.priceGuard.costPrice, currency)}
                helperText={proposal.missingFacts.find((fact) => fact.field === 'costPrice')?.note ?? 'Leave empty to keep the known cost price'}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Stack>
            {issuesNote && <Alert severity="warning" data-testid="revival-ai-issues">{issuesNote}</Alert>}
            {noProposal && <Typography variant="body2" color="text.secondary">Hermes proposed no change; reviving keeps the current title, description and price.</Typography>}
            {proposal.title && (
              <Change label="Title" current={proposal.title.current} proposed={proposal.title.proposed} rationale={proposal.title.rationale} checked={form.useTitle} onChange={(useTitle) => patch({ useTitle })} />
            )}
            {proposal.description && (
              <Change label="Description" current={proposal.description.current} proposed={proposal.description.proposed} rationale={proposal.description.rationale} checked={form.useDescription} onChange={(useDescription) => patch({ useDescription })} />
            )}
            {view.priceRow.show && proposal.price && (
              <Change
                label="Price"
                current={formatMoney(proposal.price.current, proposal.price.currency)}
                proposed={formatMoney(proposal.price.proposed, proposal.price.currency)}
                rationale={proposal.price.rationale}
                checked={form.usePrice}
                onChange={(usePrice) => patch({ usePrice })}
              />
            )}
            {view.priceRow.needsBelowCostConfirmation && (
              <Box>
                <FormControlLabel
                  control={<Checkbox checked={form.allowBelowCost} onChange={(event) => patch({ allowBelowCost: event.target.checked })} />}
                  label="Sell below cost"
                />
                <Typography variant="caption" color="text.secondary" sx={{ pl: 4, display: 'block' }}>
                  The advert price is below the cost price. Tick to apply it anyway.
                </Typography>
              </Box>
            )}
            {usage && (
              <Typography data-testid="revival-ai-usage" variant="caption" color="text.secondary">{usage}</Typography>
            )}
            {!view.canApply && view.reasons.length > 0 && (
              <Typography variant="caption" color="text.secondary">{view.reasons.join('. ')}.</Typography>
            )}
          </Stack>
        )}
        {applyError && <Alert severity="error" sx={{ mt: 2 }} data-testid="revival-error">{applyError}</Alert>}
      </Box>
    </Modal>
  );
};

export default RevivalDialog;
