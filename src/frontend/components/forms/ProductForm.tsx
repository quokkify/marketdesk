// Single-page product create/edit form. Owns local field state + validation;
// the parent supplies onSubmit (wired to a create/update mutation) and busy flag.
import React, { useMemo, useState } from 'react';
import { Button, Stack } from '@mui/material';
import {
  BelowCostConfirmationAlert,
  useBelowCostConfirmation,
} from './BelowCostConfirmation';
import type { Product } from '@shared/types';
import {
  belowCostConfirmationRequired,
  emptyProductValues,
  marginWarning,
  productToValues,
  toProductSubmissionValues,
  validateProductValues,
} from './productFormModel.js';
import type { ProductFormValues, ProductFieldErrors, ProductSubmissionValues } from './productFormModel.js';
import {
  DescriptionTagsFields,
  NameSkuFields,
  PriceFields,
  StatusField,
} from './ProductFields.js';
import { ProductImageUploader, uploadedImageId } from './ProductImageUploader.js';
import type { UploadedProductImage } from './ProductImageUploader.js';

export interface ProductFormProps {
  initial?: Product;
  submitting?: boolean;
  onSubmit: (values: ProductSubmissionValues) => void;
  onUploadImage: (file: File) => Promise<UploadedProductImage>;
  onDeleteImage?: (imageId: string) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

// Photos saved on the product stay in storage until the edit is saved, because
// a cancelled edit still shows them. Only a photo uploaded during this edit and
// removed again is deleted right away.
export function unsavedImageDeleter(
  savedImages: readonly string[],
  onDeleteImage?: (imageId: string) => Promise<void>
): ((imageId: string) => Promise<void>) | undefined {
  if (!onDeleteImage) return undefined;
  const saved = new Set(savedImages.map(uploadedImageId));
  return async (imageId) => {
    if (!saved.has(imageId)) await onDeleteImage(imageId);
  };
}

export const ProductForm: React.FC<ProductFormProps> = ({
  initial,
  submitting = false,
  onSubmit,
  onUploadImage,
  onDeleteImage,
  onCancel,
  submitLabel,
}) => {
  const [values, setValues] = useState<ProductFormValues>(() =>
    initial ? productToValues(initial) : emptyProductValues(),
  );
  const [errors, setErrors] = useState<ProductFieldErrors>({});
  const belowCostConfirmation = useBelowCostConfirmation(
    Boolean(initial && marginWarning(productToValues(initial)))
  );

  const change = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    belowCostConfirmation.resetForField(field);
  };

  const warning = useMemo(() => marginWarning(values), [values]);
  const fieldProps = { values, errors, onChange: change };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateProductValues(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    if (belowCostConfirmationRequired(values, belowCostConfirmation.confirmed)) {
      belowCostConfirmation.setHasError(true);
      return;
    }
    onSubmit(toProductSubmissionValues(values));
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack spacing={2.5}>
        <NameSkuFields {...fieldProps} />
        <DescriptionTagsFields {...fieldProps} />
        <PriceFields {...fieldProps} />
        {warning && (
          <BelowCostConfirmationAlert
            warning={warning}
            confirmed={belowCostConfirmation.confirmed}
            hasError={belowCostConfirmation.hasError}
            onConfirmedChange={belowCostConfirmation.changeConfirmed}
          />
        )}
        <StatusField {...fieldProps} />
        <ProductImageUploader
          images={values.images}
          error={errors.images}
          disabled={submitting}
          onChange={(images) => change('images', images)}
          onUpload={onUploadImage}
          onDelete={unsavedImageDeleter(initial?.images ?? [], onDeleteImage)}
        />

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
          {onCancel && (
            <Button type="button" color="inherit" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitLabel ?? (initial ? 'Save changes' : 'Create product')}
          </Button>
        </Stack>
      </Stack>
    </form>
  );
};

export default ProductForm;
