// Two-screen product creation wizard: photos, then "Review and publish". The
// decisions live in the exported pure functions; the view only renders them.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { Link as RouterLink } from 'react-router-dom';
import type { Marketplace, MarketplaceKey } from '@shared/types';
import { DEFAULT_CURRENCY } from '@shared/constants';
import {
  belowCostConfirmationRequired,
  deriveProductCategory,
  emptyProductValues,
  marginWarning,
  profitSummary,
  toProductSubmissionValues,
  validateForPublish,
  validateProductValues,
} from './productFormModel.js';
import type {
  ApiFieldErrors,
  ProductFormValues,
  ProductFieldErrors,
  ProductSubmissionValues,
  WizardOlxCategory,
} from './productFormModel.js';
import type { ProductWizardDraftState } from './productWizardDraft.js';
import { DescriptionTagsFields, NameSkuFields, PriceFields } from './ProductFields.js';
import { formatMoney } from '../../utils/formatters.js';
import { isSandboxMarketplace } from '../../utils/sandbox.js';
import { ProductImageUploader } from './ProductImageUploader.js';
import type { UploadedProductImage } from './ProductImageUploader.js';
import { OlxCategoryPicker } from './OlxCategoryPicker.js';
import type { OlxCategorySearchResult } from '../../state/api/listingsApi.js';
import { wizardPhaseAt, wizardStepIndex } from '../../workflows/publicationJourneyContract.js';
import { advancePublicationJourney } from '../../workflows/publicationJourneyGraph.js';
import type { PublicationJourneyEvent } from '../../workflows/publicationJourneyGraph.js';
import { BelowCostConfirmationAlert, useBelowCostConfirmation } from './BelowCostConfirmation.js';

export type WizardSubmitIntent = 'draft' | 'publish';

export interface WizardSubmission {
  intent: WizardSubmitIntent;
  // sku is '' when the seller gave none; the server generates one.
  values: ProductSubmissionValues;
  // null for a draft with nothing connected.
  targetMarketplace: MarketplaceKey | null;
  olxCategory: WizardOlxCategory | null;
}

export interface ProductWizardFormProps {
  submitting?: boolean;
  initialDraft?: ProductWizardDraftState | null;
  onDraftChange?: (draft: ProductWizardDraftState) => void;
  marketplaces?: Marketplace[];
  marketplacesLoading?: boolean;
  marketplacesError?: boolean;
  currency?: string;
  // Resolves with field errors when the API rejects the product.
  onSubmit: (submission: WizardSubmission) => void | Promise<ApiFieldErrors | void>;
  onCancel?: () => void;
  searchCategories?: (query: string) => Promise<OlxCategorySearchResult[]>;
  onUploadImage: (file: File) => Promise<UploadedProductImage>;
  onDeleteImage?: (imageId: string) => Promise<void>;
}

export const STEPS = ['Photos', 'Review'] as const;

type WizardStep = 0 | 1;

const MAX_PHOTOS = 12;

const MARKETPLACE_OPTIONS: ReadonlyArray<{ key: MarketplaceKey; name: string }> = [
  { key: 'olx', name: 'OLX' },
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
  const offered = marketplaces.filter((marketplace) =>
    MARKETPLACE_OPTIONS.some((option) => option.key === marketplace.key)
  );
  const verified = await Promise.all(
    offered.map(async (marketplace) => {
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

function connectedWizardKeys(marketplaces: Marketplace[] | undefined): Set<MarketplaceKey> {
  return new Set(
    buildWizardMarketplaceOptions(marketplaces)
      .filter((option) => option.connected)
      .map((option) => option.key)
  );
}

export function shouldClearWizardTarget(
  targetMarketplace: MarketplaceKey | null,
  marketplaces: Marketplace[] | undefined
): boolean {
  return (
    targetMarketplace !== null &&
    marketplaces !== undefined &&
    !connectedWizardKeys(marketplaces).has(targetMarketplace)
  );
}

// The seller is not asked: the target is the single connected wizard option.
export function resolveTargetMarketplace(
  marketplaces: Marketplace[] | undefined
): MarketplaceKey | null {
  return (
    buildWizardMarketplaceOptions(marketplaces).find((option) => option.connected)?.key ?? null
  );
}

export type WizardMarketplaceStatus = 'loading' | 'unavailable' | 'none' | 'connected';

export function wizardMarketplaceStatus(
  marketplaces: Marketplace[] | undefined,
  loading: boolean,
  failed: boolean
): WizardMarketplaceStatus {
  if (loading) return 'loading';
  if (failed) return 'unavailable';
  if (marketplaces === undefined) return 'loading';
  return resolveTargetMarketplace(marketplaces) ? 'connected' : 'none';
}

const NO_PHOTO_REASON = 'Add at least one product photo.';

export function photosBlocker(images: string[]): string | null {
  const validImages = images.filter((image) => image.trim().length > 0);
  if (validImages.length !== images.length) return 'Remove blank product photos.';
  if (validImages.length === 0) return NO_PHOTO_REASON;
  if (validImages.length > MAX_PHOTOS) return 'Add no more than 12 product photos.';
  return null;
}

// Review-screen fields in screen order; the first one with an error names the blocker.
const REVIEW_FIELD_ORDER: Array<keyof ProductFormValues> = [
  'name',
  'description',
  'condition',
  'sellingPrice',
  'costPrice',
];

function firstFieldError(errors: ProductFieldErrors): string | null {
  const field = REVIEW_FIELD_ORDER.find((key) => Boolean(errors[key]));
  return field ? errors[field]! : null;
}

const BELOW_COST_REASON = 'Confirm the below-cost price.';

// A converted six-step draft can reach the review screen without the photos it once required.
function hasPhoto(values: ProductFormValues): boolean {
  return values.images.some((image) => image.trim().length > 0);
}

// A converted six-step draft can carry a SKU, and the server can reject one as a duplicate.
export function showWizardSku(values: ProductFormValues, errors: ProductFieldErrors): boolean {
  return values.sku !== '' || Boolean(errors.sku);
}

// A below-cost price needs the seller's confirmation on both buttons.
export function draftBlocker(
  values: ProductFormValues,
  belowCostConfirmed: boolean
): string | null {
  if (!hasPhoto(values)) return NO_PHOTO_REASON;
  const fieldError = firstFieldError(validateProductValues(values));
  if (fieldError) return fieldError;
  return belowCostConfirmationRequired(values, belowCostConfirmed) ? BELOW_COST_REASON : null;
}

export interface PublishBlockerInput {
  values: ProductFormValues;
  olxCategory: WizardOlxCategory | null;
  marketplaceStatus: WizardMarketplaceStatus;
  belowCostConfirmed: boolean;
  // The picker hides the chosen path while the seller is replacing it.
  categoryChanging: boolean;
}

export function publishBlocker({
  values,
  olxCategory,
  marketplaceStatus,
  belowCostConfirmed,
  categoryChanging,
}: PublishBlockerInput): string | null {
  if (!hasPhoto(values)) return NO_PHOTO_REASON;
  const errors = validateForPublish(values);
  if (errors.sellingPrice) errors.sellingPrice = 'Add a price above 0.';
  const fieldError = firstFieldError(errors);
  if (fieldError) return fieldError;
  // The category picker needs a connected marketplace, so loading is named first.
  if (marketplaceStatus === 'loading') return 'Marketplace connections are still loading.';
  if (!olxCategory || categoryChanging) return 'Choose an OLX category.';
  return belowCostConfirmationRequired(values, belowCostConfirmed) ? BELOW_COST_REASON : null;
}

export function buildWizardSubmission(
  intent: WizardSubmitIntent,
  values: ProductFormValues,
  olxCategory: WizardOlxCategory | null,
  marketplaces: Marketplace[] | undefined,
  belowCostConfirmed: boolean
): WizardSubmission {
  // A converted six-step draft keeps the category the seller already chose.
  const category = values.category.trim()
    ? values.category
    : deriveProductCategory(olxCategory?.path ?? null);
  const withCategory = { ...values, category };
  // The below-cost override is only ever sent with the seller's confirmation.
  return {
    intent,
    values: belowCostConfirmed ? toProductSubmissionValues(withCategory) : withCategory,
    targetMarketplace: resolveTargetMarketplace(marketplaces),
    olxCategory,
  };
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
          You can still finish with Save as draft. Connect OLX later and publish the product from
          its page.
        </Typography>
      </Box>
      <Button component={RouterLink} to="/marketplaces" variant="outlined" size="small">
        Connect OLX
      </Button>
    </Stack>
  </Box>
);

export interface ProductWizardViewProps {
  activeStep: WizardStep;
  values: ProductFormValues;
  errors: ProductFieldErrors;
  serverError: string | null;
  olxCategory: WizardOlxCategory | null;
  marketplaceStatus: WizardMarketplaceStatus;
  belowCostConfirmed: boolean;
  belowCostHasError: boolean;
  categoryChanging: boolean;
  submitting: boolean;
  currency: string;
  searchCategories?: (query: string) => Promise<OlxCategorySearchResult[]>;
  onChange: <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => void;
  onOlxCategoryChange: (category: WizardOlxCategory | null) => void;
  onCategoryChangingChange: (changing: boolean) => void;
  onBelowCostConfirmedChange: (confirmed: boolean) => void;
  onUploadImage: (file: File) => Promise<UploadedProductImage>;
  onDeleteImage?: (imageId: string) => Promise<void>;
  onContinue: () => void;
  onBack: () => void;
  onCancel?: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
}

// On narrow screens the footer wraps and the primary button fills the last row.
const PRIMARY_BUTTON_SX = { width: { xs: '100%', sm: 'auto' } };

export const ProductWizardView: React.FC<ProductWizardViewProps> = ({
  activeStep,
  values,
  errors,
  serverError,
  olxCategory,
  marketplaceStatus,
  belowCostConfirmed,
  belowCostHasError,
  categoryChanging,
  submitting,
  currency,
  searchCategories,
  onChange,
  onOlxCategoryChange,
  onCategoryChangingChange,
  onBelowCostConfirmedChange,
  onUploadImage,
  onDeleteImage,
  onContinue,
  onBack,
  onCancel,
  onSaveDraft,
  onPublish,
}) => {
  const fieldProps = { values, errors, onChange };
  const pricing = profitSummary(values.costPrice, values.sellingPrice);
  const warning = marginWarning(values);
  const publishOffered = marketplaceStatus === 'loading' || marketplaceStatus === 'connected';
  const photosReason = photosBlocker(values.images);
  const draftReason = draftBlocker(values, belowCostConfirmed);
  const publishReason = publishBlocker({
    values,
    olxCategory,
    marketplaceStatus,
    belowCostConfirmed,
    categoryChanging,
  });
  const reason = activeStep === 0 ? photosReason : publishOffered ? publishReason : draftReason;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="caption" color="text.secondary">
          Step {activeStep + 1} of {STEPS.length}
        </Typography>
        <Typography variant="h6" component="h2">
          {activeStep === 0 ? STEPS[0] : 'Review and publish'}
        </Typography>
      </Box>

      {serverError && (
        <Alert severity="error">
          The product was not created: {serverError.replace(/\.$/, '')}. Fix the highlighted fields
          and try again.
        </Alert>
      )}

      {activeStep === 0 ? (
        <Stack spacing={2}>
          <ProductImageUploader
            images={values.images}
            error={errors.images}
            disabled={submitting}
            onChange={(images) => onChange('images', images)}
            onUpload={onUploadImage}
            onDelete={onDeleteImage}
          />
          <Typography variant="caption" color="text.secondary">
            Reorder photos with the arrow controls or mark any photo as the cover.
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <NameSkuFields
            {...fieldProps}
            showSku={showWizardSku(values, errors)}
            showCategory={false}
          />
          <DescriptionTagsFields {...fieldProps} showTags={false} />
          <PriceFields {...fieldProps} currency={currency} />
          <Typography variant="body2" color="text.secondary" aria-live="polite">
            {pricing
              ? `Profit ${formatMoney(pricing.profit, currency)}${marginText(pricing.marginPercent)}`
              : 'Add a cost price to see profit and margin.'}
          </Typography>
          {warning && (
            <BelowCostConfirmationAlert
              warning={warning}
              confirmed={belowCostConfirmed}
              hasError={belowCostHasError || reason === BELOW_COST_REASON}
              onConfirmedChange={onBelowCostConfirmedChange}
            />
          )}
          {searchCategories && (
            <OlxCategoryPicker
              value={olxCategory}
              onChange={onOlxCategoryChange}
              changing={categoryChanging}
              onChangingChange={onCategoryChangingChange}
              search={searchCategories}
              seed={values.name}
              disabled={submitting}
            />
          )}
          {marketplaceStatus === 'none' && <NoMarketplaceConnectedCard />}
          {marketplaceStatus === 'unavailable' && (
            <Alert severity="error">
              Marketplace connections could not be loaded. You can still save the product as a
              draft.
            </Alert>
          )}
        </Stack>
      )}

      <Stack spacing={1}>
        {reason && (
          <Typography variant="body2" color="text.secondary" role="status">
            {reason}
          </Typography>
        )}
        <Stack
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}
        >
          <Button
            type="button"
            color="inherit"
            onClick={onCancel}
            disabled={submitting}
            sx={{ mr: 'auto' }}
          >
            Cancel
          </Button>
          {activeStep === 0 ? (
            <Button
              type="button"
              variant="contained"
              onClick={onContinue}
              disabled={submitting || photosReason !== null}
              sx={PRIMARY_BUTTON_SX}
            >
              Continue
            </Button>
          ) : (
            <>
              <Button type="button" onClick={onBack} disabled={submitting}>
                Back
              </Button>
              <Button
                type="button"
                variant={publishOffered ? 'outlined' : 'contained'}
                onClick={onSaveDraft}
                disabled={submitting || draftReason !== null}
                sx={publishOffered ? undefined : PRIMARY_BUTTON_SX}
              >
                Save as draft
              </Button>
              {publishOffered && (
                <Button
                  type="button"
                  variant="contained"
                  onClick={onPublish}
                  disabled={submitting || publishReason !== null}
                  sx={PRIMARY_BUTTON_SX}
                >
                  Publish to OLX
                </Button>
              )}
            </>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
};

function toWizardStep(index: number): WizardStep {
  return index === 0 ? 0 : 1;
}

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
  searchCategories,
  onUploadImage,
  onDeleteImage,
}) => {
  const [activeStep, setActiveStep] = useState<WizardStep>(initialDraft?.activeStep ?? 0);
  const [values, setValues] = useState<ProductFormValues>(() =>
    initialDraft
      ? {
          ...initialDraft.values,
          tags: [...initialDraft.values.tags],
          images: [...initialDraft.values.images],
        }
      : emptyProductValues()
  );
  const [olxCategory, setOlxCategory] = useState<WizardOlxCategory | null>(
    initialDraft?.olxCategory ?? null
  );
  const [errors, setErrors] = useState<ProductFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const belowCostConfirmation = useBelowCostConfirmation();
  const [categoryChanging, setCategoryChanging] = useState(false);
  const [targetMarketplace, setTargetMarketplace] = useState<MarketplaceKey | null>(
    initialDraft?.targetMarketplace ?? null
  );
  // Guards against a second click in the same tick, before `submitting` re-renders.
  const submittingRef = useRef(false);
  const marketplaceStatus = useMemo(
    () => wizardMarketplaceStatus(marketplaces, marketplacesLoading, marketplacesError),
    [marketplaces, marketplacesError, marketplacesLoading]
  );

  useEffect(() => {
    onDraftChange?.({ values, activeStep, targetMarketplace, olxCategory, createdProductId: null });
  }, [activeStep, olxCategory, onDraftChange, targetMarketplace, values]);

  useEffect(() => {
    if (shouldClearWizardTarget(targetMarketplace, marketplaces)) {
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

  const move = async (event: PublicationJourneyEvent) => {
    const next = await advancePublicationJourney({ phase: wizardPhaseAt(activeStep) }, event);
    setActiveStep(toWizardStep(wizardStepIndex(next.phase)));
  };

  const handleContinue = async () => {
    if (photosBlocker(values.images) !== null) return;
    setServerError(null);
    await move({ type: 'next', validated: true });
  };

  const handleBack = async () => {
    setErrors({});
    setServerError(null);
    await move({ type: 'back' });
  };

  const submit = async (intent: WizardSubmitIntent) => {
    const blocked =
      intent === 'publish'
        ? publishBlocker({
            values,
            olxCategory,
            marketplaceStatus,
            belowCostConfirmed: belowCostConfirmation.confirmed,
            categoryChanging,
          })
        : draftBlocker(values, belowCostConfirmation.confirmed);
    if (blocked === BELOW_COST_REASON) belowCostConfirmation.setHasError(true);
    if (blocked !== null || submittingRef.current) return;
    submittingRef.current = true;
    setServerError(null);
    try {
      const rejected = await onSubmit(
        buildWizardSubmission(
          intent,
          values,
          olxCategory,
          marketplaces,
          belowCostConfirmation.confirmed
        )
      );
      if (rejected) {
        setErrors(rejected.fieldErrors);
        setServerError(rejected.message);
      }
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <ProductWizardView
      activeStep={activeStep}
      values={values}
      errors={errors}
      serverError={serverError}
      olxCategory={olxCategory}
      marketplaceStatus={marketplaceStatus}
      belowCostConfirmed={belowCostConfirmation.confirmed}
      belowCostHasError={belowCostConfirmation.hasError}
      categoryChanging={categoryChanging}
      submitting={submitting}
      currency={currency}
      searchCategories={searchCategories}
      onChange={change}
      onOlxCategoryChange={setOlxCategory}
      onCategoryChangingChange={setCategoryChanging}
      onBelowCostConfirmedChange={belowCostConfirmation.changeConfirmed}
      onUploadImage={onUploadImage}
      onDeleteImage={onDeleteImage}
      onContinue={() => void handleContinue()}
      onBack={() => void handleBack()}
      onCancel={onCancel}
      onSaveDraft={() => void submit('draft')}
      onPublish={() => void submit('publish')}
    />
  );
};

export default ProductWizardForm;
