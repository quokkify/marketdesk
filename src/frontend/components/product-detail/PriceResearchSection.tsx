// What the owner knows about the market price of one product: the retail price of a new one and
// a few comparable used prices. Hermes reads it when it proposes a start price. The retail price
// is never written to the product's cost price.
import React, { useState } from 'react';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import type { PriceResearch } from '@shared/types';
import { Card } from '../common/Card.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { LoadingSkeleton } from '../common/Skeleton.js';
import { useGetPriceResearchQuery, useSavePriceResearchMutation } from '../../state/api/productsApi.js';
import { useAppDispatch } from '../../state/hooks.js';
import { enqueueToast } from '../../state/slices/uiSlice.js';
import {
  MAX_COMPARABLES,
  discountLine,
  toPriceResearchBody,
  toPriceResearchForm,
  type PriceResearchForm,
} from './priceResearchModel.js';
import { formatDateTime } from '../../utils/formatters.js';
import { requestErrorMessage } from './revivalView.js';

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
                onChange={(event) => patchComparable(index, { price: event.target.value })}
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
        <Button
          size="small"
          sx={{ mt: 1 }}
          disabled={form.comparables.length >= MAX_COMPARABLES}
          onClick={() => patch({ comparables: [...form.comparables, { price: '', note: '' }] })}
        >
          Add comparable
        </Button>
      </Box>

      <Box>
        <Button variant="contained" disabled={saving} onClick={() => void handleSave()} data-testid="price-research-save">
          Save price research
        </Button>
      </Box>
    </Stack>
  );
};

export interface PriceResearchSectionProps {
  productId: string;
  currentPrice: number;
  currency: string;
}

export const PriceResearchSection: React.FC<PriceResearchSectionProps> = ({ productId, currentPrice, currency }) => {
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
