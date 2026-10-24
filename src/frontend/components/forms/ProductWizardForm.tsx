// Multi-step product creation wizard. Reuses the shared field controls and
// validation model; emits the completed values via onSubmit on the final step.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Chip,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { Link as RouterLink } from 'react-router-dom';
import type {
  Marketplace,
  MarketplaceKey,
  ProductAIDraft,
  ProductAIDraftRequest,
} from '@shared/types';
import { DEFAULT_CURRENCY } from '@shared/constants';
import {
  belowCostConfirmationRequired,
  emptyProductValues,
  marginWarning,
  profitSummary,
  toProductSubmissionValues,
  validateProductValues,
} from './productFormModel.js';
import type {
  ApiFieldErrors,
  ProductFormValues,
  ProductFieldErrors,
  ProductSubmissionValues,
} from './productFormModel.js';
import type { ProductWizardDraftState } from './productWizardDraft.js';
import { DescriptionTagsFields, NameSkuFields, PriceFields } from './ProductFields.js';
import { formatMoney } from '../../utils/formatters.js';
import { conditionLabel } from '../../utils/labels.js';
import { isSandboxMarketplace } from '../../utils/sandbox.js';
import { ProductImageUploader } from './ProductImageUploader.js';
import type { UploadedProductImage } from './ProductImageUploader.js';
import { wizardPhaseAt, wizardStepIndex } from '../../workflows/publicationJourneyContract.js';
import { advancePublicationJourney } from '../../workflows/publicationJourneyGraph.js';
import {
  BelowCostConfirmationAlert,
  useBelowCostConfirmation,
} from './BelowCostConfirmation.js';

export interface ProductWizardFormProps {
  submitting?: boolean;
  initialDraft?: ProductWizardDraftState | null;
  onDraftChange?: (draft: ProductWizardDraftState) => void;
  marketplaces?: Marketplace[];
  marketplacesLoading?: boolean;
  marketplacesError?: boolean;
  currency?: string;
  // Resolves with field errors when the API rejects the product.
  onSubmit: (values: ProductSubmissionValues) => void | Promise<ApiFieldErrors | void>;
  onCancel?: () => void;
  onGenerateAIDraft?: (request: ProductAIDraftRequest) => Promise<ProductAIDraft>;
  onUploadImage: (file: File) => Promise<UploadedProductImage>;
  onDeleteImage?: (imageId: string) => Promise<void>;
}

const STEPS = ['Photos', 'Basic info', 'Pricing', 'Category', 'Marketplaces', 'Review'] as const;

// Which value keys each step is responsible for (drives per-step validation
// and the jump to the step that owns a field the API rejected).
const STEP_FIELDS: Array<Array<keyof ProductFormValues>> = [
  ['images'],
  ['name', 'sku', 'description', 'condition', 'tags', 'status'],
  ['costPrice', 'sellingPrice'],
  ['category'],
  [],
  [],
];

export function firstWizardStepWithErrors(errors: ProductFieldErrors): number | null {
  const step = STEP_FIELDS.findIndex((fields) => fields.some((field) => Boolean(errors[field])));
  return step === -1 ? null : step;
}

const MARKETPLACE_OPTIONS: ReadonlyArray<{ key: MarketplaceKey; name: string }> = [
  { key: 'olx', name: 'OLX' },
  { key: 'allegro', name: 'Allegro' },
  { key: 'vinted', name: 'Vinted' },
  { key: 'facebook', name: 'Facebook Marketplace' },
  { key: 'ebay', name: 'eBay' },
  { key: 'etsy', name: 'Etsy' },
  { key: 'amazon', name: 'Amazon' },
];

export interface WizardMarketplaceOption {
  key: MarketplaceKey;
  name: string;
  connected: boolean;
  configured: boolean;
  // OLX is the only channel MarketDesk integrates today.
  integrated: boolean;
  sandbox: boolean;
}

export interface WizardStepValidation {
  fieldErrors: ProductFieldErrors;
  marketplaceError?: string;
}

export interface MarketplaceReadinessStatus {
  connected: boolean;
  marketplaceId: string;
  providerKey: MarketplaceKey;
}

export interface VerifiedMarketplaceResult {
  marketplaces: Marketplace[];
  hadCheckError: boolean;
}

export async function verifyWizardMarketplaceReadiness(
  marketplaces: Marketplace[],
  check: (id: string) => Promise<MarketplaceReadinessStatus>
): Promise<VerifiedMarketplaceResult> {
  let hadCheckError = false;
  const verified = await Promise.all(
    marketplaces.map(async (marketplace) => {
      if (!marketplace.connected) return marketplace;
      try {
        const status = await check(marketplace.id);
        const connected =
          status.connected &&
          status.marketplaceId === marketplace.id &&
          status.providerKey === marketplace.key;
        return { ...marketplace, connected };
      } catch {
        hadCheckError = true;
        return { ...marketplace, connected: false };
      }
    })
  );
  return { marketplaces: verified, hadCheckError };
}

export function buildWizardMarketplaceOptions(
  marketplaces: Marketplace[] | undefined
): WizardMarketplaceOption[] {
  const byKey = new Map((marketplaces ?? []).map((marketplace) => [marketplace.key, marketplace]));
  return MARKETPLACE_OPTIONS.map((option) => {
    const configured = byKey.get(option.key);
    return {
      ...option,
      connected: configured?.connected === true,
      configured: configured !== undefined,
      integrated: option.key === 'olx',
      sandbox: isSandboxMarketplace(configured),
    };
  });
}

export function validateWizardStep(
  step: number,
  values: ProductFormValues,
  targetMarketplace: MarketplaceKey | null,
  marketplaces: Marketplace[] | undefined,
  marketplacesLoading = false,
  marketplacesError = false
): WizardStepValidation {
  const all = validateProductValues(values);
  const validImages = values.images.filter((image) => image.trim().length > 0);
  if (validImages.length !== values.images.length) {
    all.images = 'Remove blank product photos.';
  } else if (validImages.length === 0) {
    all.images = 'Add at least one product photo.';
  } else if (validImages.length > 12) {
    all.images = 'Add no more than 12 product photos.';
  }
  if (!values.category.trim()) all.category = 'Choose a category.';

  const fieldErrors: ProductFieldErrors = {};
  for (const key of STEP_FIELDS[step] ?? []) {
    if (all[key]) fieldErrors[key] = all[key];
  }

  if (step !== 4) return { fieldErrors };
  if (marketplacesLoading || (marketplaces === undefined && !marketplacesError)) {
    return { fieldErrors, marketplaceError: 'Wait for marketplace connections to load.' };
  }
  if (marketplacesError) {
    return {
      fieldErrors,
      marketplaceError: 'Marketplace connections could not be loaded. Retry before continuing.',
    };
  }

  const connectedKeys = new Set(
    (marketplaces ?? [])
      .filter((marketplace) => marketplace.connected)
      .map((marketplace) => marketplace.key)
  );
  // Without a connected marketplace the product is created as a draft.
  if (connectedKeys.size === 0) return { fieldErrors };
  if (!targetMarketplace || !connectedKeys.has(targetMarketplace)) {
    return { fieldErrors, marketplaceError: 'Select a connected marketplace.' };
  }
  return { fieldErrors };
}

const DRAFT_FIELD_ORDER: Array<keyof ProductFormValues> = [
  'name',
  'sku',
  'description',
  'category',
  'condition',
  'tags',
  'images',
  'costPrice',
  'sellingPrice',
  'status',
];

function populatedValues(values: ProductFormValues): ProductAIDraftRequest['existingFields'] {
  return {
    name: values.name || undefined,
    sku: values.sku || undefined,
    description: values.description || undefined,
    category: values.category || undefined,
    condition: values.condition,
    status: values.status,
    costPrice: values.costPrice,
    sellingPrice: values.sellingPrice,
    tags: values.tags,
    images: values.images,
  };
}

function fieldSummary(value: ProductFormValues[keyof ProductFormValues]): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

const DESCRIPTION_EXCERPT_LENGTH = 120;

function descriptionExcerpt(description: string): string {
  const text = description.trim().replace(/\s+/g, ' ');
  if (text.length <= DESCRIPTION_EXCERPT_LENGTH) return text;
  const cut = text.slice(0, DESCRIPTION_EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:]$/, '')}…`;
}

function marginText(marginPercent: number | null): string {
  return marginPercent === null ? '' : ` · ${Math.round(marginPercent)}% margin`;
}

export const NoMarketplaceConnectedCard: React.FC = () => (
  <Box
    role="status"
    sx={{ p: 2, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'action.hover' }}
  >
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
    >
      <StorefrontOutlinedIcon color="action" />
      <Box sx={{ flex: 1 }}>
        <Typography variant="subtitle2">No marketplace connected</Typography>
        <Typography variant="body2" color="text.secondary">
          You can still finish with Create as draft. Connect OLX later and publish the product from
          its page.
        </Typography>
      </Box>
      <Button component={RouterLink} to="/marketplaces" variant="outlined" size="small">
        Connect OLX
      </Button>
    </Stack>
  </Box>
);

export const WizardReviewSummary: React.FC<{
  values: ProductFormValues;
  currency: string;
  marketplace: WizardMarketplaceOption | null;
}> = ({ values, currency, marketplace }) => {
  const cover = values.images[0];
  const pricing = profitSummary(values.costPrice, values.sellingPrice);
  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '148px minmax(0, 1fr)' },
          gap: 2,
        }}
      >
        <Box
          sx={{
            aspectRatio: '1 / 1',
            maxWidth: 220,
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: 'action.hover',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {cover ? (
            <Box
              component="img"
              src={cover}
              alt={`${values.name || 'Product'} cover photo`}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              No cover photo
            </Typography>
          )}
        </Box>
        <Stack spacing={1} sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
            {values.name || 'Untitled product'}
          </Typography>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip size="small" label={conditionLabel(values.condition)} />
            <Chip size="small" variant="outlined" label={values.category || 'No category'} />
            <Chip
              size="small"
              variant="outlined"
              label={`${values.images.length} photo${values.images.length === 1 ? '' : 's'}`}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {descriptionExcerpt(values.description) || 'No description'}
          </Typography>
        </Stack>
      </Box>
      <Divider />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            Selling price
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {formatMoney(values.sellingPrice, currency)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {pricing ? (
              <>
                Cost {formatMoney(values.costPrice, currency)} · Profit{' '}
                <Box
                  component="span"
                  sx={{ fontWeight: 700, color: pricing.profit < 0 ? 'error.main' : 'success.main' }}
                >
                  {formatMoney(pricing.profit, currency)}
                </Box>
                {marginText(pricing.marginPercent)}
              </>
            ) : (
              'Cost unknown, so profit is not calculated.'
            )}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Target marketplace
          </Typography>
          {marketplace ? (
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, alignItems: 'center' }}>
              <Chip size="small" color="primary" label={marketplace.name} />
              {marketplace.sandbox && (
                <Chip size="small" color="warning" variant="outlined" label="Sandbox" />
              )}
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
              Saved as a draft
            </Typography>
          )}
        </Box>
      </Box>
      <Alert severity="info">
        {marketplace
          ? `Creating saves the product and opens its ${marketplace.name} listing draft for review. Publishing still needs your confirmation.`
          : 'Creating saves the product as a draft. Connect OLX later to publish it from the product page.'}
      </Alert>
    </Stack>
  );
};

export const ProductWizardForm: React.FC<ProductWizardFormProps> = ({
  submitting = false,
  initialDraft,
  onDraftChange,
  marketplaces,
  marketplacesLoading = false,
  marketplacesError = false,
  currency = DEFAULT_CURRENCY,
  onSubmit,
  onCancel,
  onGenerateAIDraft,
  onUploadImage,
  onDeleteImage,
}) => {
  const [activeStep, setActiveStep] = useState(initialDraft?.activeStep ?? 0);
  const [values, setValues] = useState<ProductFormValues>(() =>
    initialDraft
      ? {
          ...initialDraft.values,
          tags: [...initialDraft.values.tags],
          images: [...initialDraft.values.images],
        }
      : emptyProductValues()
  );
  const [errors, setErrors] = useState<ProductFieldErrors>({});
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductAIDraft | null>(null);
  const [selectedDraftFields, setSelectedDraftFields] = useState<Array<keyof ProductFormValues>>(
    []
  );
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const belowCostConfirmation = useBelowCostConfirmation();
  const [targetMarketplace, setTargetMarketplace] = useState<MarketplaceKey | null>(
    initialDraft?.targetMarketplace ?? null
  );
  const marketplaceOptions = useMemo(
    () => buildWizardMarketplaceOptions(marketplaces),
    [marketplaces]
  );

  useEffect(() => {
    onDraftChange?.({ values, activeStep, targetMarketplace });
  }, [activeStep, onDraftChange, targetMarketplace, values]);

  useEffect(() => {
    if (
      targetMarketplace &&
      marketplaces &&
      !marketplaces.some(
        (marketplace) => marketplace.key === targetMarketplace && marketplace.connected
      )
    ) {
      setTargetMarketplace(null);
    }
  }, [marketplaces, targetMarketplace]);

  const change = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    belowCostConfirmation.resetForField(field);
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const warning = useMemo(() => marginWarning(values), [values]);
  const fieldProps = { values, errors, onChange: change };

  const validationFor = (step: number) =>
    validateWizardStep(
      step,
      values,
      targetMarketplace,
      marketplaces,
      marketplacesLoading,
      marketplacesError
    );

  const validateStep = (step: number): boolean => {
    const validation = validationFor(step);
    setErrors(validation.fieldErrors);
    setMarketplaceError(validation.marketplaceError ?? null);
    const pricingNeedsConfirmation =
      step === 2 && belowCostConfirmationRequired(values, belowCostConfirmation.confirmed);
    belowCostConfirmation.setHasError(pricingNeedsConfirmation);
    return (
      Object.keys(validation.fieldErrors).length === 0 &&
      !validation.marketplaceError &&
      !pricingNeedsConfirmation
    );
  };

  const requestDraft = async (mode: ProductAIDraftRequest['mode']) => {
    if (!onGenerateAIDraft) return;
    setDraftError(null);
    setDraftLoading(true);
    try {
      const nextDraft = await onGenerateAIDraft({
        mode,
        title: values.name || undefined,
        imageUrls: values.images,
        existingFields: populatedValues(values),
      });
      setDraft(nextDraft);
      setSelectedDraftFields(
        DRAFT_FIELD_ORDER.filter((field) => nextDraft.fields[field] !== undefined)
      );
    } catch (err) {
      const e = err as { data?: { error?: { message?: string } }; message?: string };
      setDraftError(e.data?.error?.message ?? e.message ?? 'AI draft generation failed.');
    } finally {
      setDraftLoading(false);
    }
  };

  const applyDraft = (fields: Array<keyof ProductFormValues>) => {
    if (!draft) return;
    if (fields.includes('costPrice') || fields.includes('sellingPrice')) {
      belowCostConfirmation.resetForField('costPrice');
    }
    setValues((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const value = draft.fields[field];
        if (value !== undefined) {
          (next as Record<keyof ProductFormValues, ProductFormValues[keyof ProductFormValues]>)[
            field
          ] = value;
        }
      }
      return next;
    });
    setErrors({});
  };

  const handleNext = async () => {
    setServerError(null);
    if (!validateStep(activeStep)) return;
    const next = await advancePublicationJourney(
      { phase: wizardPhaseAt(activeStep) },
      { type: 'next', validated: true },
    );
    setActiveStep(wizardStepIndex(next.phase));
  };

  const handleBack = async () => {
    setErrors({});
    setMarketplaceError(null);
    setServerError(null);
    if (activeStep === 0) return;
    const previous = await advancePublicationJourney(
      { phase: wizardPhaseAt(activeStep) },
      { type: 'back' },
    );
    setActiveStep(wizardStepIndex(previous.phase));
  };

  const handleFinish = async () => {
    setServerError(null);
    for (let step = 0; step <= 4; step += 1) {
      const validation = validationFor(step);
      const pricingNeedsConfirmation =
        step === 2 && belowCostConfirmationRequired(values, belowCostConfirmation.confirmed);
      if (
        Object.keys(validation.fieldErrors).length > 0 ||
        validation.marketplaceError ||
        pricingNeedsConfirmation
      ) {
        setErrors(validation.fieldErrors);
        setMarketplaceError(validation.marketplaceError ?? null);
        belowCostConfirmation.setHasError(pricingNeedsConfirmation);
        setActiveStep(step);
        return;
      }
    }
    const rejected = await onSubmit({
      ...toProductSubmissionValues(values),
      targetMarketplace: targetMarketplace ?? undefined,
    });
    const rejectedStep = rejected ? firstWizardStepWithErrors(rejected.fieldErrors) : null;
    if (!rejected || rejectedStep === null) return;
    setErrors(rejected.fieldErrors);
    setServerError(rejected.message);
    setActiveStep(rejectedStep);
  };

  const pricing = profitSummary(values.costPrice, values.sellingPrice);
  const hasConnectedMarketplace = marketplaceOptions.some((option) => option.connected);
  const selectedMarketplace =
    marketplaceOptions.find((option) => option.key === targetMarketplace && option.connected) ??
    null;

  const availableDraftFields = draft
    ? DRAFT_FIELD_ORDER.filter((field) => draft.fields[field] !== undefined)
    : [];

  return (
    <Stack spacing={3}>
      <Stack spacing={1.5} sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <AutoAwesomeIcon color="primary" />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle2">AI-assisted product creation</Typography>
            <Typography variant="body2" color="text.secondary">
              Start from photos or a title, then review and apply the draft manually.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            onClick={() => requestDraft('photos')}
            disabled={!onGenerateAIDraft || draftLoading || values.images.length === 0}
          >
            Create from photos
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => requestDraft('title')}
            disabled={!onGenerateAIDraft || draftLoading || !values.name.trim()}
          >
            Start with title
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Manual product entry remains available. AI drafts never save or publish until you apply
          fields and create the product.
        </Typography>
        {draftError && <Alert severity="error">{draftError}</Alert>}
        {draft && (
          <Stack spacing={1.5} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper' }}>
            <Typography variant="subtitle2">
              Draft from {draft.mode === 'photos' ? 'photos' : 'title'} · confidence{' '}
              {Math.round(draft.confidence * 100)}%
            </Typography>
            <Stack spacing={0.5}>
              {availableDraftFields.map((field) => (
                <FormControlLabel
                  key={field}
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedDraftFields.includes(field)}
                      onChange={(event) => {
                        setSelectedDraftFields((prev) =>
                          event.target.checked ? [...prev, field] : prev.filter((f) => f !== field)
                        );
                      }}
                    />
                  }
                  label={`${field}: ${fieldSummary(draft.fields[field] as ProductFormValues[keyof ProductFormValues])}`}
                />
              ))}
            </Stack>
            {draft.uncertainFields.length > 0 && (
              <Alert severity="warning">
                Review uncertain fields: {draft.uncertainFields.join(', ')}.
              </Alert>
            )}
            {draft.missingInfoQuestions.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                Missing info: {draft.missingInfoQuestions.join(' ')}
              </Typography>
            )}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="contained"
                onClick={() => applyDraft(availableDraftFields)}
              >
                Apply
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => applyDraft(selectedDraftFields)}
              >
                Apply selected
              </Button>
              <Button size="small" onClick={() => requestDraft(draft.mode)} disabled={draftLoading}>
                Regenerate
              </Button>
              <Button size="small" color="inherit" onClick={() => setDraft(null)}>
                Discard
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>

      <Divider />

      <Stepper activeStep={activeStep} alternativeLabel>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ minHeight: 280 }}>
        {serverError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            The product was not created: {serverError.replace(/\.$/, '')}. Fix the highlighted
            fields and create it again.
          </Alert>
        )}
        {activeStep === 0 && (
          <Stack spacing={2}>
            <Typography variant="subtitle2">Upload photos</Typography>
            <ProductImageUploader
              images={values.images}
              error={errors.images}
              disabled={submitting}
              onChange={(images) => change('images', images)}
              onUpload={onUploadImage}
              onDelete={onDeleteImage}
            />
            <Typography variant="caption" color="text.secondary">
              Reorder photos with the arrow controls or mark any photo as the cover. Hermes analyzes
              the current cover first.
            </Typography>
          </Stack>
        )}
        {activeStep === 1 && (
          <Stack spacing={2}>
            <NameSkuFields {...fieldProps} showCategory={false} />
            <DescriptionTagsFields {...fieldProps} />
          </Stack>
        )}
        {activeStep === 2 && (
          <Stack spacing={2}>
            <PriceFields {...fieldProps} currency={currency} />
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {pricing
                ? `Profit ${formatMoney(pricing.profit, currency)}${marginText(pricing.marginPercent)}`
                : 'Add a cost price to see profit and margin.'}
            </Typography>
            <Alert severity="info">
              Hermes price ideas are available after creation: open the product and use Suggest
              improvements.
            </Alert>
            {warning && (
              <BelowCostConfirmationAlert
                warning={warning}
                confirmed={belowCostConfirmation.confirmed}
                hasError={belowCostConfirmation.hasError}
                onConfirmedChange={belowCostConfirmation.changeConfirmed}
              />
            )}
          </Stack>
        )}
        {activeStep === 3 && (
          <FormControl error={Boolean(errors.category)}>
            <FormLabel id="product-category-label">Choose category</FormLabel>
            <ToggleButtonGroup
              exclusive
              value={values.category || null}
              onChange={(_event, category: string | null) => {
                if (category) change('category', category);
              }}
              aria-labelledby="product-category-label"
              aria-describedby={errors.category ? 'product-category-error' : undefined}
              sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}
            >
              {['Electronics', 'Fashion', 'Home and Garden', 'Sports', 'Kitchen', 'Other'].map(
                (category) => (
                  <ToggleButton
                    key={category}
                    value={category}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
                  >
                    {category}
                  </ToggleButton>
                )
              )}
            </ToggleButtonGroup>
            {errors.category && (
              <FormHelperText id="product-category-error">{errors.category}</FormHelperText>
            )}
            <Typography variant="caption" color="text.secondary">
              Hermes can suggest the closest category from photos, title, and description; final
              mapping stays editable.
            </Typography>
          </FormControl>
        )}
        {activeStep === 4 && (
          <FormControl error={Boolean(marketplaceError)}>
            <FormLabel id="target-marketplace-label">Marketplaces</FormLabel>
            {marketplacesLoading && <Alert severity="info">Loading marketplace connections…</Alert>}
            {marketplacesError && (
              <Alert severity="error">Marketplace connections could not be loaded.</Alert>
            )}
            {marketplaces && !marketplacesLoading && !marketplacesError && !hasConnectedMarketplace && (
              <Box sx={{ mt: 1 }}>
                <NoMarketplaceConnectedCard />
              </Box>
            )}
            <RadioGroup
              value={targetMarketplace ?? ''}
              onChange={(_event, key) => {
                setTargetMarketplace(key as MarketplaceKey);
                setMarketplaceError(null);
              }}
              aria-labelledby="target-marketplace-label"
              aria-describedby={marketplaceError ? 'target-marketplace-error' : undefined}
              sx={{ mt: 1, gap: 1 }}
            >
              {marketplaceOptions.map((marketplace) => {
                const selected = targetMarketplace === marketplace.key;
                return (
                  <FormControlLabel
                    key={marketplace.key}
                    value={marketplace.key}
                    disabled={!marketplace.connected}
                    control={<Radio />}
                    sx={{
                      m: 0,
                      p: 1.5,
                      borderRadius: 2,
                      opacity: marketplace.connected ? 1 : 0.62,
                      border: (t) =>
                        `2px solid ${selected ? t.palette.primary.main : t.palette.divider}`,
                      bgcolor: selected ? 'action.selected' : 'background.paper',
                    }}
                    label={
                      <Box sx={{ width: '100%' }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {marketplace.name}
                          </Typography>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                            {marketplace.sandbox && (
                              <Chip size="small" color="warning" variant="outlined" label="Sandbox" />
                            )}
                            {selected ? (
                              <Chip size="small" color="primary" label="Selected" />
                            ) : (
                              <Chip
                                size="small"
                                color={marketplace.connected ? 'success' : 'default'}
                                label={
                                  marketplace.connected
                                    ? 'Connected'
                                    : marketplace.integrated
                                      ? 'Not connected'
                                      : 'Not available yet'
                                }
                              />
                            )}
                          </Stack>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {marketplace.connected
                            ? 'Connected to this workspace and available for publishing.'
                            : !marketplace.integrated
                              ? 'Roadmap channel. MarketDesk currently integrates OLX only.'
                              : marketplace.configured
                                ? 'Reconnect OLX from Marketplaces to publish.'
                                : 'Connect OLX from Marketplaces to publish.'}
                        </Typography>
                      </Box>
                    }
                  />
                );
              })}
            </RadioGroup>
            {marketplaceError && (
              <FormHelperText id="target-marketplace-error">{marketplaceError}</FormHelperText>
            )}
          </FormControl>
        )}
        {activeStep === 5 && (
          <WizardReviewSummary
            values={values}
            currency={currency}
            marketplace={selectedMarketplace}
          />
        )}
      </Box>

      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Button type="button" color="inherit" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Typography variant="caption" color="text.secondary">
          Step {activeStep + 1} of {STEPS.length}
        </Typography>
        <Stack direction="row" spacing={1.5}>
          <Button type="button" onClick={handleBack} disabled={activeStep === 0 || submitting}>
            Back
          </Button>
          {activeStep < STEPS.length - 1 ? (
            <Button type="button" variant="contained" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button
              type="button"
              variant="contained"
              onClick={() => void handleFinish()}
              disabled={submitting}
            >
              {selectedMarketplace ? 'Create product' : 'Create as draft'}
            </Button>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
};

export default ProductWizardForm;
