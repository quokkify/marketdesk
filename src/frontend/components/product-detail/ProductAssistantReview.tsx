import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type {
  Listing,
  Product,
  ProductImprovementReviewSession,
  ProductImprovementSuggestions,
} from '@shared/types';
import {
  useDecideProductImprovement,
  useProductImprovementReview,
  useProposeProductImprovements,
} from '../../services/hooks/index.js';
import { Card } from '../common/Card.js';
import { Modal } from '../common/Modal.js';

type Proposal = ProductImprovementReviewSession['proposals'][number];
export function improvementReviewIsStale(
  session: ProductImprovementReviewSession,
  product: Product,
  listing?: Listing,
  currency?: string
): boolean {
  return (
    (currency !== undefined && session.currency !== currency) ||
    session.productId !== product.id ||
    session.productUpdatedAt !== product.updatedAt ||
    session.listingId !== listing?.id ||
    Boolean(session.listingUpdatedAt && session.listingUpdatedAt !== listing?.updatedAt)
  );
}
export function improvementEditedValue(
  field: Proposal['field'],
  value: string
): string | number | null {
  if (field !== 'price') return value.trim() ? value.trim() : null;
  const price = Number(value);
  return value.trim() && Number.isFinite(price) && price > 0 ? price : null;
}
const label = (field: Proposal['field']) =>
  field === 'title' ? 'Title' : field === 'description' ? 'Description' : 'Listing price';
const errorMessage = (error: unknown) => {
  const e = error as { data?: { error?: { message?: string } }; message?: string };
  return e.data?.error?.message ?? e.message ?? 'Unable to save the review. Please try again.';
};

export function ProductAssistantReview({
  product,
  listing,
  currency,
  principalKey,
  ready,
  refresh,
}: {
  product: Product;
  listing?: Listing;
  currency: string;
  principalKey: string;
  ready: boolean;
  refresh: () => Promise<void>;
}) {
  const saved = useProductImprovementReview(
    { productId: product.id, listingId: listing?.id, principalKey },
    {
      skip: !ready || !principalKey,
      refetchOnMountOrArgChange: true,
    }
  );
  const [generate] = useProposeProductImprovements();
  const [decide] = useDecideProductImprovement();
  const [localSession, setLocalSession] = useState<ProductImprovementReviewSession | null>(null);
  const [preview, setPreview] = useState<ProductImprovementSuggestions | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [value, setValue] = useState('');
  const [belowCostConfirmed, setBelowCostConfirmed] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const restoredSession = saved.currentData;
  const session = preview
    ? null
    : !localSession
      ? restoredSession
      : restoredSession &&
          (restoredSession.updatedAt > localSession.updatedAt ||
            (restoredSession.sessionId === localSession.sessionId &&
              restoredSession.revision >= localSession.revision))
        ? restoredSession
        : localSession;
  const stale =
    conflict ||
    Boolean(session && improvementReviewIsStale(session, product, listing, currency)) ||
    Boolean(
      preview &&
      (preview.productUpdatedAt !== product.updatedAt ||
        (preview.listingUpdatedAt && preview.listingUpdatedAt !== listing?.updatedAt) ||
        (preview.currency && preview.currency !== currency))
    );
  const locked = busy || saved.isFetching || saved.isError || !ready || conflict;
  const acceptLocked = locked || stale;
  const editedValue = editing ? improvementEditedValue(editing.field, value) : null;
  const belowCost =
    editing?.field === 'price' &&
    typeof editedValue === 'number' &&
    product.costPrice !== null &&
    editedValue < product.costPrice;

  const prepare = async () => {
    if (inFlight.current || !ready || saved.isFetching) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setEditing(null);
    try {
      const result = await generate({ productId: product.id, listingId: listing?.id }).unwrap();
      if (!active.current) return;
      setConflict(false);
      setPreview(result.session ? null : result);
      setLocalSession(result.session ?? null);
      if (result.session) await saved.refetch();
    } catch (error) {
      if (active.current) setFailure(errorMessage(error));
    } finally {
      if (active.current) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  };
  const submit = async (proposal: Proposal, action: 'accept' | 'reject') => {
    if (
      !session ||
      locked ||
      inFlight.current ||
      (action === 'accept' && (stale || editedValue === null || (belowCost && !belowCostConfirmed)))
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await decide({
        productId: product.id,
        listingId: session.listingId,
        sessionId: session.sessionId,
        revision: session.revision,
        proposalId: proposal.proposalId,
        action,
        ...(action === 'accept'
          ? { editedValue: editedValue!, ...(belowCost ? { allowBelowCost: true } : {}) }
          : {}),
      }).unwrap();
      if (!active.current) return;
      setLocalSession(result);
      setEditing(null);
      await Promise.all([refresh(), saved.refetch()]);
    } catch (error) {
      if (!active.current) return;
      if ((error as { status?: number }).status === 409) {
        setConflict(true);
        setEditing(null);
        setFailure(
          'The saved product, listing or review changed. Request fresh suggestions before applying changes.'
        );
        await Promise.all([refresh(), saved.refetch()]);
      } else setFailure(errorMessage(error));
    } finally {
      if (active.current) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  };
  return (
    <Card
      title="Product assistant"
      subtitle="Review saved text and listing price suggestions."
      sx={{ mb: 2 }}
    >
      <Stack spacing={1.5}>
        <Button
          sx={{ alignSelf: 'flex-start' }}
          variant="outlined"
          disabled={busy || saved.isFetching || !ready || !principalKey}
          onClick={() => void prepare()}
        >
          {busy ? 'Saving…' : 'Suggest improvements'}
        </Button>
        <Typography variant="body2" color="text.secondary">
          Applying a change saves it in MarketDesk without publishing.
        </Typography>
        {(!ready || saved.isLoading || (!saved.currentData && saved.isFetching)) && (
          <Typography>Loading saved suggestions…</Typography>
        )}
        {saved.isError && (
          <Alert
            severity="error"
            action={
              <Button onClick={() => void saved.refetch()} disabled={busy}>
                Retry
              </Button>
            }
          >
            Unable to load saved suggestions.
          </Alert>
        )}
        {failure && <Alert severity="error">{failure}</Alert>}
        {stale && (
          <Alert severity="warning">
            The product, listing or currency changed. Request fresh suggestions.
          </Alert>
        )}
        {session?.proposals.map((proposal) => (
          <Box key={proposal.proposalId} sx={{ overflowWrap: 'anywhere' }}>
            <Typography variant="subtitle2">
              {label(proposal.field)} ·{' '}
              {proposal.status === 'pending'
                ? 'Pending review'
                : proposal.status === 'accepted'
                  ? 'Accepted'
                  : 'Rejected'}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {proposal.editedValue ?? proposal.proposedValue}
              {proposal.field === 'price' ? ` ${session.currency}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {proposal.rationale}
            </Typography>
            {proposal.status === 'pending' && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  variant="outlined"
                  disabled={acceptLocked}
                  onClick={() => {
                    setEditing(proposal);
                    setValue(String(proposal.proposedValue));
                    setBelowCostConfirmed(false);
                  }}
                >
                  Review {label(proposal.field).toLowerCase()}
                </Button>
                <Button disabled={locked} onClick={() => void submit(proposal, 'reject')}>
                  Reject {label(proposal.field).toLowerCase()}
                </Button>
              </Stack>
            )}
          </Box>
        ))}
        {session?.proposals.length === 0 && (
          <Typography>No suggestions for this product.</Typography>
        )}
        {preview && (
          <>
            {preview.copy.map((item, index) => (
              <Box key={index}>
                <Typography variant="subtitle2">{label(item.field)}</Typography>
                <Typography>{item.proposedValue}</Typography>
                <Typography variant="caption">{item.rationale}</Typography>
              </Box>
            ))}
            {preview.price && (
              <Typography>
                Suggested price: {preview.price.suggestedPrice} {preview.currency ?? currency}
              </Typography>
            )}
            <Alert severity="info">
              Suggestions are for review only. Edit the product or listing to apply them.
            </Alert>
          </>
        )}
        {!session && !preview && ready && !saved.isFetching && !saved.isError && (
          <Typography color="text.secondary">
            Ask Hermes for wording and price ideas. Nothing is changed automatically.
          </Typography>
        )}
      </Stack>
      <Modal
        open={Boolean(editing)}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
        closeDisabled={busy}
        title={`Review ${editing ? label(editing.field).toLowerCase() : 'suggestion'}`}
        subtitle="Apply saves this change in MarketDesk. Marketplace publication is a separate action."
        actions={
          <>
            <Button disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={acceptLocked || editedValue === null || (belowCost && !belowCostConfirmed)}
              onClick={() => editing && void submit(editing, 'accept')}
            >
              Apply
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <Typography variant="body2">
            Current value:{' '}
            {editing?.field === 'title'
              ? product.name
              : editing?.field === 'description'
                ? product.description
                : `${listing?.price ?? ''} ${currency}`}
          </Typography>
          <TextField
            label="Proposed value"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setBelowCostConfirmed(false);
            }}
            disabled={busy}
            type={editing?.field === 'price' ? 'number' : 'text'}
            multiline={editing?.field === 'description'}
            minRows={editing?.field === 'description' ? 4 : undefined}
            fullWidth
          />
          {editedValue === null && (
            <Alert severity="warning">
              Enter {editing?.field === 'price' ? 'a positive price' : 'a non-empty value'}.
            </Alert>
          )}
          {belowCost && (
            <>
              <Alert severity="warning">
                This listing price is below the product cost of {product.costPrice} {currency}.
              </Alert>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={belowCostConfirmed}
                    onChange={(e) => setBelowCostConfirmed(e.target.checked)}
                    disabled={busy}
                  />
                }
                label="I confirm applying a listing price below cost"
              />
            </>
          )}
        </Stack>
      </Modal>
    </Card>
  );
}
