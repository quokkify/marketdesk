// Shared form-value shape + validation for product create/edit flows.
// Mirrors domain invariants (ARCHITECTURE §3) client-side; the API remains the
// source of truth. sellingPrice < costPrice is a soft warning, not a hard block.
import type { Product, ProductCondition, ProductStatus } from '@shared/types';
import { PRODUCT_DESCRIPTION_MIN_LENGTH, PRODUCT_DESCRIPTION_MAX_LENGTH } from '@shared/constants';

export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  costPrice: number | null;
  sellingPrice: number;
  condition: ProductCondition;
  category: string;
  status: ProductStatus;
  tags: string[];
  images: string[];
}

export type ProductSubmissionValues = ProductFormValues & {
  // Review-only marketplace preference captured by the wizard; product creation strips it.
  targetMarketplace?: string;
  // Explicit API contract marker for clients that intentionally submit a loss.
  allowBelowCost?: boolean;
};

export type ProductFieldErrors = Partial<Record<keyof ProductFormValues, string>>;

export function emptyProductValues(): ProductFormValues {
  return {
    name: '',
    sku: '',
    description: '',
    costPrice: 0,
    sellingPrice: 0,
    condition: 'good',
    category: '',
    status: 'draft',
    tags: [],
    images: [],
  };
}

export function productToValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    sku: product.sku,
    description: product.description,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    condition: product.condition,
    category: product.category,
    status: product.status,
    tags: product.tags ?? [],
    images: product.images ?? [],
  };
}

export function validateProductValues(values: ProductFormValues): ProductFieldErrors {
  const errors: ProductFieldErrors = {};
  if (!values.name.trim()) errors.name = 'Name is required.';
  if (!values.sku.trim()) errors.sku = 'SKU is required.';

  const descLen = values.description.trim().length;
  if (descLen < PRODUCT_DESCRIPTION_MIN_LENGTH) {
    errors.description = `Description must be at least ${PRODUCT_DESCRIPTION_MIN_LENGTH} characters.`;
  } else if (descLen > PRODUCT_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be at most ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters.`;
  }

  if (values.costPrice !== null && (!(values.costPrice >= 0) || Number.isNaN(values.costPrice))) {
    errors.costPrice = 'Cost must be a non-negative number.';
  }
  if (!(values.sellingPrice >= 0) || Number.isNaN(values.sellingPrice)) {
    errors.sellingPrice = 'Price must be a non-negative number.';
  }
  return errors;
}

// Soft warning: selling below cost is allowed but flagged.
export function belowCostLoss(
  values: ProductFormValues
): { amount: number; marginPercent: number } | null {
  if (
    typeof values.costPrice === 'number' &&
    Number.isFinite(values.costPrice) &&
    Number.isFinite(values.sellingPrice) &&
    values.costPrice > 0 &&
    values.sellingPrice < values.costPrice
  ) {
    const amount = values.costPrice - values.sellingPrice;
    const marginPercent =
      values.sellingPrice === 0
        ? -100
        : ((values.sellingPrice - values.costPrice) / values.sellingPrice) * 100;
    return { amount, marginPercent };
  }
  return null;
}

// Soft warning: selling below cost is allowed but flagged.
export function marginWarning(values: ProductFormValues): string | null {
  const loss = belowCostLoss(values);
  if (!loss) return null;
  if (values.sellingPrice === 0) {
    return `Selling price is below cost — this listing would sell at a loss (${formatLossAmount(loss.amount)}, zero selling price).`;
  }
  return `Selling price is below cost — this listing would sell at a loss (${formatLossAmount(loss.amount)}, ${loss.marginPercent.toFixed(1)}% margin).`;
}

export function belowCostConfirmationRequired(
  values: ProductFormValues,
  confirmed: boolean
): boolean {
  return belowCostLoss(values) !== null && !confirmed;
}

export function toProductSubmissionValues(values: ProductFormValues): ProductSubmissionValues {
  const belowCost = belowCostLoss(values) !== null;
  return belowCost ? { ...values, allowBelowCost: true } : { ...values };
}

export interface ProfitSummary {
  profit: number;
  marginPercent: number | null;
}

// Profit and margin for display; null when the cost is unknown.
export function profitSummary(costPrice: number | null, sellingPrice: number): ProfitSummary | null {
  if (costPrice === null || !Number.isFinite(costPrice) || !Number.isFinite(sellingPrice)) {
    return null;
  }
  const profit = sellingPrice - costPrice;
  return { profit, marginPercent: sellingPrice === 0 ? null : (profit / sellingPrice) * 100 };
}

export interface ApiFieldErrors {
  fieldErrors: ProductFieldErrors;
  message: string;
}

const FORM_FIELDS = new Set<string>([
  'name',
  'sku',
  'description',
  'costPrice',
  'sellingPrice',
  'condition',
  'category',
  'status',
  'tags',
  'images',
]);

const BELOW_COST_FIELD_MESSAGE =
  'Selling price is below cost. Confirm the below-cost price to continue.';

interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: Array<{ field?: string; message?: string }>;
}

// Maps an API error envelope to per-field messages: request validation
// details, an application validation "field: message" text, or a duplicate SKU.
export function productFieldErrorsFromApi(error: unknown): ApiFieldErrors {
  const failure = (error ?? {}) as { data?: { error?: ApiErrorBody }; message?: string };
  const body = failure.data?.error;
  const message = body?.message ?? failure.message ?? 'Request failed';
  const fieldErrors: ProductFieldErrors = {};
  const assign = (field: string, text: string) => {
    if (field === 'allowBelowCost') {
      fieldErrors.sellingPrice ??= BELOW_COST_FIELD_MESSAGE;
      return;
    }
    const key = field.split('.')[0] ?? '';
    if (FORM_FIELDS.has(key)) fieldErrors[key as keyof ProductFormValues] ??= text;
  };
  for (const detail of body?.details ?? []) {
    if (detail.field && detail.message) assign(detail.field, detail.message);
  }
  if (!body?.details?.length && body?.code === 'VALIDATION_ERROR' && body.message) {
    const prefixed = /^([A-Za-z]+)(?:\.\d+)?: (.+)$/.exec(body.message);
    if (prefixed) assign(prefixed[1]!, prefixed[2]!);
  }
  if (body?.code === 'CONFLICT' && /\bSKU\b/i.test(message)) fieldErrors.sku = message;
  return { fieldErrors, message };
}

function formatLossAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}
