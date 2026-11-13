import type { MarketplaceKey, ProductCondition, ProductStatus } from '@shared/types';
import { MARKETPLACE_KEY_LIST, PRODUCT_STATUS_LIST } from '@shared/constants';
import { emptyProductValues } from './productFormModel.js';
import type { ProductFormValues, WizardOlxCategory } from './productFormModel.js';

export const PRODUCT_WIZARD_DRAFT_VERSION = 2;
const LEGACY_PRODUCT_WIZARD_DRAFT_VERSION = 1;
const LEGACY_MAX_ACTIVE_STEP = 5;
export const PRODUCT_WIZARD_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const PRODUCT_CONDITIONS: readonly ProductCondition[] = [
  'new',
  'like_new',
  'good',
  'fair',
  'poor',
  'refurbished',
  'unknown',
];

export interface ProductWizardDraftState {
  values: ProductFormValues;
  activeStep: 0 | 1;
  targetMarketplace: MarketplaceKey | null;
  olxCategory: WizardOlxCategory | null;
  createdProductId: string | null;
}

interface StoredProductWizardDraft extends ProductWizardDraftState {
  version: typeof PRODUCT_WIZARD_DRAFT_VERSION;
  updatedAt: number;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface VolatileProductWizardDraft {
  draft: ProductWizardDraftState;
  updatedAt: number;
}

const volatileDrafts = new Map<string, VolatileProductWizardDraft>();
const discardedDraftKeys = new Set<string>();

function cloneDraft(draft: ProductWizardDraftState): ProductWizardDraftState {
  return {
    values: { ...draft.values, tags: [...draft.values.tags], images: [...draft.values.images] },
    activeStep: draft.activeStep,
    targetMarketplace: draft.targetMarketplace,
    olxCategory: draft.olxCategory
      ? { ...draft.olxCategory, path: [...draft.olxCategory.path] }
      : null,
    createdProductId: draft.createdProductId,
  };
}

function timestampIsValid(updatedAt: number, now: number): boolean {
  return (
    Number.isFinite(updatedAt) &&
    updatedAt <= now + 60_000 &&
    now - updatedAt <= PRODUCT_WIZARD_DRAFT_MAX_AGE_MS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseValues(value: unknown): ProductFormValues | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== 'string' ||
    typeof value.sku !== 'string' ||
    typeof value.description !== 'string' ||
    (value.costPrice !== null &&
      (typeof value.costPrice !== 'number' || !Number.isFinite(value.costPrice))) ||
    typeof value.sellingPrice !== 'number' ||
    !Number.isFinite(value.sellingPrice) ||
    !PRODUCT_CONDITIONS.includes(value.condition as ProductCondition) ||
    typeof value.category !== 'string' ||
    !PRODUCT_STATUS_LIST.includes(value.status as ProductStatus) ||
    !isStringArray(value.tags) ||
    !isStringArray(value.images)
  ) {
    return null;
  }
  return {
    name: value.name,
    sku: value.sku,
    description: value.description,
    costPrice: value.costPrice as number | null,
    sellingPrice: value.sellingPrice,
    condition: value.condition as ProductCondition,
    category: value.category,
    status: value.status as ProductStatus,
    tags: [...value.tags],
    images: [...value.images],
  };
}

function parseOlxCategory(value: unknown): WizardOlxCategory | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.providerCategoryId !== 'string' ||
    typeof value.name !== 'string' ||
    !isStringArray(value.path)
  ) {
    return undefined;
  }
  return { providerCategoryId: value.providerCategoryId, name: value.name, path: [...value.path] };
}

function parseActiveStep(value: unknown, maxStep: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maxStep
    ? value
    : null;
}

function parseTargetMarketplace(value: unknown): MarketplaceKey | null | undefined {
  if (value === null) return null;
  return MARKETPLACE_KEY_LIST.includes(value as MarketplaceKey)
    ? (value as MarketplaceKey)
    : undefined;
}

const STORAGE_KEY_PREFIX = 'marketdesk.productWizardDraft.v';

function storageKeyForVersion(version: number, workspaceId: string, userId: string): string {
  return `${STORAGE_KEY_PREFIX}${version}.${encodeURIComponent(workspaceId)}.${encodeURIComponent(userId)}`;
}

export function productWizardDraftStorageKey(workspaceId: string, userId: string): string {
  return storageKeyForVersion(PRODUCT_WIZARD_DRAFT_VERSION, workspaceId, userId);
}

// The version 1 key for the same workspace and user, or null for a key of another shape.
function legacyStorageKey(key: string): string | null {
  const current = `${STORAGE_KEY_PREFIX}${PRODUCT_WIZARD_DRAFT_VERSION}.`;
  return key.startsWith(current)
    ? `${STORAGE_KEY_PREFIX}${LEGACY_PRODUCT_WIZARD_DRAFT_VERSION}.${key.slice(current.length)}`
    : null;
}

export function hasMeaningfulProductWizardDraft(draft: ProductWizardDraftState): boolean {
  return (
    draft.activeStep > 0 ||
    draft.targetMarketplace !== null ||
    draft.olxCategory !== null ||
    draft.createdProductId !== null ||
    JSON.stringify(draft.values) !== JSON.stringify(emptyProductValues())
  );
}

export function readProductWizardDraft(
  storage: DraftStorage | null,
  key: string,
  now = Date.now()
): ProductWizardDraftState | null {
  if (discardedDraftKeys.has(key)) return null;
  const volatile = volatileDrafts.get(key);
  if (volatile) {
    if (timestampIsValid(volatile.updatedAt, now)) return cloneDraft(volatile.draft);
    volatileDrafts.delete(key);
  }
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw) return parseStoredDraft(raw, now);
    return convertLegacyDraft(storage, key, now);
  } catch {
    return null;
  }
}

function parseStoredDraft(raw: string, now: number): ProductWizardDraftState | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== PRODUCT_WIZARD_DRAFT_VERSION) return null;
  if (typeof parsed.updatedAt !== 'number' || !timestampIsValid(parsed.updatedAt, now)) {
    return null;
  }
  const activeStep = parseActiveStep(parsed.activeStep, 1);
  const targetMarketplace = parseTargetMarketplace(parsed.targetMarketplace);
  const olxCategory = parseOlxCategory(parsed.olxCategory);
  const createdProductId = parsed.createdProductId;
  const values = parseValues(parsed.values);
  if (
    activeStep === null ||
    targetMarketplace === undefined ||
    olxCategory === undefined ||
    (createdProductId !== null && typeof createdProductId !== 'string') ||
    !values
  ) {
    return null;
  }
  return {
    values,
    activeStep: activeStep === 0 ? 0 : 1,
    targetMarketplace,
    olxCategory,
    createdProductId,
  };
}

// Reads a six-step version 1 draft, stores it as version 2 and removes the old key.
function convertLegacyDraft(
  storage: DraftStorage,
  key: string,
  now: number
): ProductWizardDraftState | null {
  const legacyKey = legacyStorageKey(key);
  const raw = legacyKey ? storage.getItem(legacyKey) : null;
  if (!legacyKey || !raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== LEGACY_PRODUCT_WIZARD_DRAFT_VERSION) return null;
  if (typeof parsed.updatedAt !== 'number' || !timestampIsValid(parsed.updatedAt, now)) {
    return null;
  }
  const activeStep = parseActiveStep(parsed.activeStep, LEGACY_MAX_ACTIVE_STEP);
  const targetMarketplace = parseTargetMarketplace(parsed.targetMarketplace);
  const values = parseValues(parsed.values);
  if (activeStep === null || targetMarketplace === undefined || !values) return null;
  const draft: ProductWizardDraftState = {
    values,
    activeStep: activeStep === 0 ? 0 : 1,
    targetMarketplace,
    olxCategory: null,
    createdProductId: null,
  };
  writeProductWizardDraft(storage, key, draft, parsed.updatedAt);
  storage.removeItem(legacyKey);
  return draft;
}

export function writeProductWizardDraft(
  storage: DraftStorage | null,
  key: string,
  draft: ProductWizardDraftState,
  now = Date.now()
): boolean {
  if (!storage) {
    discardedDraftKeys.delete(key);
    volatileDrafts.set(key, { draft: cloneDraft(draft), updatedAt: now });
    return false;
  }
  try {
    const stored: StoredProductWizardDraft = {
      ...draft,
      version: PRODUCT_WIZARD_DRAFT_VERSION,
      updatedAt: now,
    };
    storage.setItem(key, JSON.stringify(stored));
    volatileDrafts.delete(key);
    discardedDraftKeys.delete(key);
    return true;
  } catch {
    discardedDraftKeys.delete(key);
    volatileDrafts.set(key, { draft: cloneDraft(draft), updatedAt: now });
    return false;
  }
}

export function removeProductWizardDraft(storage: DraftStorage | null, key: string): boolean {
  volatileDrafts.delete(key);
  if (!storage) {
    discardedDraftKeys.add(key);
    return false;
  }
  try {
    storage.removeItem(key);
    discardedDraftKeys.delete(key);
    return true;
  } catch {
    discardedDraftKeys.add(key);
    return false;
  }
}
