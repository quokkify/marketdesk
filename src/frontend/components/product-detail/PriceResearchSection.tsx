// What the owner knows about the market price of one product: the retail price of a new one and
// a few comparable used prices. Hermes reads it when it proposes a start price. The retail price
// is never written to the product's cost price.
import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Link, Stack, TextField, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import type { PriceResearch } from '@shared/types';
import { normalizeOlxAdvertUrl } from '@shared/olxAdvertUrl';
import { Card } from '../common/Card.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { LoadingSkeleton } from '../common/Skeleton.js';
import {
  useGetPriceResearchQuery,
  useSavePriceResearchMutation,
  useRefreshPriceResearchMutation,
} from '../../state/api/productsApi.js';
import { useAppDispatch } from '../../state/hooks.js';
import { enqueueToast } from '../../state/slices/uiSlice.js';
import {
  MAX_COMPARABLES,
  anchorTierLines,
  discountLine,
  editComparablePrice,
  storedEstimateLines,
  toPriceResearchBody,
  toPriceResearchForm,
  type PriceResearchForm,
} from './priceResearchModel.js';
import { formatDate, formatDateTime, formatMoney } from '../../utils/formatters.js';
import { requestErrorMessage } from './revivalView.js';

const OLX_PLN_ONLY = 'OLX search needs a PLN listing';
const OLX_CURRENCY = 'PLN';

interface PriceResearchFormProps {
  productId: string;
  research: PriceResearch | null;
  currency: string;
}

const PriceResearchEditor: React.FC<PriceResearchFormProps> = ({ productId, research, currency }) => {
  const dispatch = useAppDispatch();
  const [save, { isLoading: saving }] = useSavePriceResearchMutation();
  const [form, setForm] = useState<PriceResearchForm>(() => toPriceResearchForm(research, currency));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const patch = (change: Partial<PriceResearchForm>) => setForm((current) => ({ ...current, ...change }));
  const patchComparable = (index: number, change: Partial<PriceResearchForm['comparables'][number]>) =>
    patch({ comparables: form.comparables.map((row, i) => (i === index ? { ...row, ...change } : row)) });

  const handleSave = async () => {
    const result = toPriceResearchBody(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await save({ productId, body: result.body }).unwrap();
      dispatch(enqueueToast({ message: 'Price research saved.', severity: 'success' }));
    } catch (err) {
      dispatch(enqueueToast({ message: requestErrorMessage(err), severity: 'error' }));
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Price of a new one"
          value={form.retailPrice}
          onChange={(event) => patch({ retailPrice: event.target.value })}
          error={Boolean(errors.retailPrice)}
          helperText={errors.retailPrice}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          data-testid="price-research-retail-price"
        />
        <TextField
          label="Currency"
          value={form.retailCurrency}
          onChange={(event) => patch({ retailCurrency: event.target.value })}
          error={Boolean(errors.retailCurrency)}
          helperText={errors.retailCurrency}
          data-testid="price-research-currency"
        />
        <TextField
          fullWidth
          label="Source"
          value={form.retailSource}
          onChange={(event) => patch({ retailSource: event.target.value })}
          error={Boolean(errors.retailSource)}
          helperText={errors.retailSource}
          data-testid="price-research-source"
        />
        <TextField
          label="Checked on"
          placeholder="YYYY-MM-DD"
          value={form.retailCheckedAt}
          onChange={(event) => patch({ retailCheckedAt: event.target.value })}
          error={Boolean(errors.retailCheckedAt)}
          helperText={errors.retailCheckedAt}
          data-testid="price-research-checked-at"
        />
      </Stack>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Comparable used prices</Typography>
        <Stack spacing={1.5}>
          {form.comparables.map((row, index) => (
            <Stack key={index} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <TextField
                size="small"
                label="Price"
                value={row.price}
                onChange={(event) => patch({ comparables: editComparablePrice(form.comparables, index, event.target.value) })}
                error={Boolean(errors[`comparables.${index}.price`])}
                helperText={errors[`comparables.${index}.price`]}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
              <TextField
                fullWidth
                size="small"
                label="Note"
                value={row.note}
                onChange={(event) => patchComparable(index, { note: event.target.value })}
                error={Boolean(errors[`comparables.${index}.note`])}
                helperText={errors[`comparables.${index}.note`]}
              />
              {row.source === 'web' && row.url && normalizeOlxAdvertUrl(row.url) !== null && (
                <Link
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                  sx={{ alignSelf: 'center' }}
                  data-testid="comparable-olx-link"
                >
                  OLX
                </Link>
              )}
              <IconButton
                aria-label={`Remove comparable ${index + 1}`}
                onClick={() => patch({ comparables: form.comparables.filter((_, i) => i !== index) })}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>
        {errors.comparables && <Alert severity="error" sx={{ mt: 1 }}>{errors.comparables}</Alert>}
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            size="small"
            disabled={form.comparables.length >= MAX_COMPARABLES}
            onClick={() => patch({ comparables: [...form.comparables, { price: '', note: '' }] })}
          >
            Add comparable
          </Button>
        </Stack>
      </Box>

      <Box>
        <Button variant="contained" disabled={saving} onClick={() => void handleSave()} data-testid="price-research-save">
          Save price research
        </Button>
      </Box>
    </Stack>
  );
};

interface PriceAnchorsProps {
  productId: string;
  research: PriceResearch | null;
  currency: string;
  listingCurrency: string | null;
}

const PriceAnchors: React.FC<PriceAnchorsProps> = ({ productId, research, currency, listingCurrency }) => {
  const dispatch = useAppDispatch();
  const [refresh, { isLoading: refreshing }] = useRefreshPriceResearchMutation();
  const pln = listingCurrency === OLX_CURRENCY;
  const estimate = storedEstimateLines(research?.lastEstimate ?? null, currency);

  const handleFind = async () => {
    try {
      await refresh(productId).unwrap();
    } catch (err) {
      dispatch(enqueueToast({ message: requestErrorMessage(err), severity: 'error' }));
    }
  };

  return (
    <Stack spacing={1} data-testid="price-anchors">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2">Price anchors</Typography>
        {research?.lastAttemptAt && (
          <Typography variant="caption" color="text.secondary" data-testid="price-anchors-updated">
            {`updated ${formatDate(research.lastAttemptAt)}`}
          </Typography>
        )}
        <Tooltip title={pln ? '' : OLX_PLN_ONLY}>
          <span>
            <Button
              size="small"
              disabled={!pln || refreshing}
              startIcon={refreshing ? <CircularProgress size={14} /> : undefined}
              onClick={() => void handleFind()}
              data-testid="find-prices-button"
            >
              Find prices
            </Button>
          </span>
        </Tooltip>
        {!pln && <Typography variant="caption" color="text.secondary">{OLX_PLN_ONLY}</Typography>}
      </Stack>
      {anchorTierLines(research, currency).map((line) => (
        <Stack key={line.tier} direction="row" spacing={1} sx={{ alignItems: 'baseline' }} data-testid={`anchor-tier-${line.tier}`}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>{line.label}</Typography>
          <Typography variant="body2">{line.text}</Typography>
          {line.rows.map((row, index) =>
            row.url && row.url.startsWith('https://') ? (
              <Link
                key={index}
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="body2"
                aria-label={`${line.label}: advert ${index + 1}`}
              >
                ↗
              </Link>
            ) : null,
          )}
        </Stack>
      ))}
      {research?.specs && (
        <Typography variant="caption" color="text.secondary" data-testid="price-anchors-specs">
          {`Matched by: ${research.specs}`}
        </Typography>
      )}
      {estimate.length > 0 && (
        <Box data-testid="stored-estimate">
          {estimate.map((line) => (
            <Typography key={line} variant="body2">{line}</Typography>
          ))}
        </Box>
      )}
    </Stack>
  );
};

export interface PriceResearchSectionProps {
  productId: string;
  currentPrice: number;
  currency: string;
}

export const PriceResearchSection: React.FC<PriceResearchSectionProps & { listingCurrency?: string | null }> = ({
  productId,
  currentPrice,
  currency,
  listingCurrency = null,
}) => {
  const query = useGetPriceResearchQuery(productId);
  const research = query.currentData;
  const discount = research ? discountLine(currentPrice, research, currency) : null;

  return (
    <Card
      title="Price research"
      subtitle="Hermes uses this when it proposes a start price. It never changes your cost price."
    >
      {research === undefined && query.isError ? (
        <ErrorRetry error={query.error} onRetry={query.refetch} />
      ) : research === undefined ? (
        <LoadingSkeleton lines={3} height={48} />
      ) : (
        <Stack spacing={2}>
          {discount && (
            <Typography variant="body2" sx={{ fontWeight: 700 }} data-testid="price-research-discount">
              {discount}
            </Typography>
          )}
          {research && (
            <Typography variant="caption" color="text.secondary" data-testid="price-research-saved">
              {`Saved ${formatDateTime(research.updatedAt)}`}
            </Typography>
          )}
          <PriceAnchors productId={productId} research={research} currency={currency} listingCurrency={listingCurrency} />
          <PriceResearchEditor
            key={`${productId}:${research?.updatedAt ?? 'none'}`}
            productId={productId}
            research={research}
            currency={currency}
          />
        </Stack>
      )}
    </Card>
  );
};

// The product price with its discount against a new one, shown in the product's header.
export const ProductPriceDiscount: React.FC<PriceResearchSectionProps> = ({ productId, currentPrice, currency }) => {
  const research = useGetPriceResearchQuery(productId).currentData;
  const discount = research ? discountLine(currentPrice, research, currency) : null;
  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{formatMoney(currentPrice, currency)}</Typography>
      {discount && (
        <Typography variant="body2" color="text.secondary" data-testid="product-price-discount">
          {discount}
        </Typography>
      )}
    </Box>
  );
};
