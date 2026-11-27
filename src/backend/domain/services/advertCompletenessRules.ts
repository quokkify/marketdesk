// Pure rules of the advert completeness checks: category, attributes and delivery of an OLX advert.
// Facts come in, a VerdictCheck comes out. No I/O and no AI here.
import { createHash } from 'crypto';
import type { ParcelSize, VerdictCheck, VerdictCheckName, VerdictCheckStatus, VerdictReason } from '../../../shared/types';

export interface OlxCategoryAttribute {
  code: string;
  label: string;
  required: boolean;
  multiple: boolean;
  values: Array<{ code: string; label: string }>;
}
export interface AdvertAttribute {
  code: string;
  value: string;
}
export type { ParcelSize };
export type DeliveryMode = 'BuyWithDelivery' | 'NotEligible' | string;

const DELIVERY_ATTRIBUTE = 'delivery';
const DELIVERY_ON = 'BuyWithDelivery';
const DELIVERY_OFF = 'NotEligible';

function makeCheck(
  check: VerdictCheckName,
  status: VerdictCheckStatus,
  reasons: VerdictReason[],
  now: Date,
  refs: VerdictCheck['refs'],
): VerdictCheck {
  return { check, status, reasons, checkedAt: now.toISOString(), refs };
}

function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsWholeWord(haystack: string, label: string): boolean {
  const needle = normalizeText(label).trim();
  if (needle === '') return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u').test(normalizeText(haystack));
}

function isSet(current: AdvertAttribute[], code: string): boolean {
  return current.some((attribute) => attribute.code === code && attribute.value.trim() !== '');
}

// Attributes Hermes may propose a value for: single-choice, with values to choose from, still empty.
export function fillableAttributes(category: OlxCategoryAttribute[], current: AdvertAttribute[]): OlxCategoryAttribute[] {
  return category.filter(
    (attribute) =>
      attribute.code !== DELIVERY_ATTRIBUTE &&
      !attribute.multiple &&
      attribute.values.length > 0 &&
      !isSet(current, attribute.code),
  );
}

// A value is verifiable when exactly one of its labels appears as a whole word in the advert text.
export function verifiableValues(
  fillable: OlxCategoryAttribute[],
  text: { name: string; description: string },
): AdvertAttribute[] {
  const haystack = `${text.name}\n${text.description}`;
  const found: AdvertAttribute[] = [];
  for (const attribute of fillable) {
    const matches = attribute.values.filter((value) => containsWholeWord(haystack, value.label));
    if (matches.length === 1) found.push({ code: attribute.code, value: matches[0].code });
  }
  return found;
}

export function attributesCheck(input: {
  category: OlxCategoryAttribute[];
  current: AdvertAttribute[];
  proposalOpen: boolean;
  now: Date;
  eventIds: string[];
}): VerdictCheck {
  const { category, current, proposalOpen, now, eventIds } = input;
  const emptyRequired = category.filter(
    (attribute) => attribute.required && attribute.code !== DELIVERY_ATTRIBUTE && !isSet(current, attribute.code),
  );
  const emptyOptional = fillableAttributes(category, current).filter((attribute) => !attribute.required);
  const refs = { eventIds, missingAttributes: [...emptyRequired, ...emptyOptional].map((a) => a.code) };

  if (proposalOpen) {
    return makeCheck(
      'attributes',
      'fix',
      [{ code: 'attributes_proposed', message: 'Hermes proposed values for empty OLX fields' }],
      now,
      refs,
    );
  }
  if (emptyRequired.length > 0) {
    const reasons = emptyRequired.map((attribute) => ({
      code: 'attributes_empty_required',
      message: `Fill the required OLX field: ${attribute.label}`,
    }));
    return makeCheck('attributes', 'needs_human', reasons, now, refs);
  }
  const reasons = emptyOptional.map((attribute) => ({
    code: 'attributes_still_empty',
    message: `Still empty on OLX: ${attribute.label}`,
  }));
  return makeCheck('attributes', 'ready', reasons, now, refs);
}

export function categoryCheck(input: {
  listingCategoryId: string;
  suggestionIds: string[];
  // The owner dismissed the mismatch recommendation for this listing and category.
  keptByOwner?: boolean;
  now: Date;
  eventIds: string[];
}): VerdictCheck {
  const { listingCategoryId, suggestionIds, keptByOwner = false, now, eventIds } = input;
  if (suggestionIds.includes(listingCategoryId)) return makeCheck('category', 'ready', [], now, { eventIds });
  if (suggestionIds.length === 0) {
    return makeCheck(
      'category',
      'needs_human',
      [{ code: 'category_unknown', message: 'OLX gave no category suggestion for this title' }],
      now,
      { eventIds },
    );
  }
  if (keptByOwner) {
    return makeCheck(
      'category',
      'ready',
      [{ code: 'category_kept_by_owner', message: 'You kept this OLX category' }],
      now,
      { eventIds },
    );
  }
  return makeCheck(
    'category',
    'fix',
    [{ code: 'category_mismatch', message: 'OLX suggests another category for this title' }],
    now,
    { eventIds },
  );
}

export function deliveryCheck(input: {
  mode: DeliveryMode | null;
  packageIds: string[];
  categoryOffersDelivery: boolean;
  proposalOpen: boolean;
  now: Date;
  eventIds: string[];
}): VerdictCheck {
  const { mode, packageIds, categoryOffersDelivery, now, eventIds } = input;
  const refs = { eventIds, deliveryMode: mode };
  const done = (status: VerdictCheckStatus, reason?: VerdictReason) =>
    makeCheck('delivery', status, reason ? [reason] : [], now, refs);

  if (mode === null) {
    return done('needs_human', { code: 'probe_failed', message: 'Could not read the advert page on OLX' });
  }
  if (mode === DELIVERY_ON) return done('ready');
  if (mode === DELIVERY_OFF && packageIds.length > 0) {
    return done('needs_human', {
      code: 'delivery_not_offered',
      message: 'OLX does not offer delivery on this advert although packages are set; check it in OLX',
    });
  }
  if (mode !== DELIVERY_OFF) {
    return done('needs_human', {
      code: 'delivery_mode_unknown',
      message: 'OLX reports an unknown delivery state for this advert; check it in OLX',
    });
  }
  if (!categoryOffersDelivery) {
    return done('fix', {
      code: 'delivery_unavailable_in_category',
      message: 'This OLX category has no delivery; fix the category first',
    });
  }
  return done('fix', { code: 'delivery_off', message: 'Buyers cannot order with Przesyłka OLX' });
}

// A package label ends with its parcel size, for example "DPD Kurier S".
export function packagesForSize(deliveryAttribute: OlxCategoryAttribute, size: ParcelSize): string[] {
  return deliveryAttribute.values
    .filter((value) => value.label.trim().split(/\s+/).pop() === size)
    .map((value) => value.code);
}

export function categoryFirstCheck(check: 'attributes' | 'delivery', now: Date): VerdictCheck {
  return makeCheck(check, 'needs_human', [{ code: 'category_first', message: 'Fix the OLX category first' }], now, {
    eventIds: [],
  });
}

export const CATEGORY_OUT_OF_SYNC: VerdictReason = {
  code: 'category_out_of_sync',
  message: 'The OLX category changed since the last sync; sync the listing first',
};

export const ADVERT_DRIFTED: VerdictReason = {
  code: 'advert_drifted',
  message: 'The advert changed on OLX since the last sync; sync the listing first',
};

// A check that stops before any write or proposal and waits for the owner.
export function blockedCheck(check: VerdictCheckName, reason: VerdictReason, now: Date): VerdictCheck {
  return makeCheck(check, 'needs_human', [{ ...reason }], now, { eventIds: [] });
}

// The reason for a value MarketDesk wrote that OLX did not keep.
export function attributeDroppedReason(label: string): VerdictReason {
  return { code: 'attribute_dropped', message: `OLX did not keep ${label}` };
}

export const ATTRIBUTES_WRITE_IN_PROGRESS: VerdictReason = {
  code: 'attributes_write_in_progress',
  message: 'A fill of these OLX fields is in progress',
};

export function attributeIdempotencyKey(listingId: string, values: AdvertAttribute[]): string {
  const pairs = values.map((attribute) => `${attribute.code}=${attribute.value}`).sort();
  return createHash('sha256').update([listingId, ...pairs].join('\n')).digest('hex');
}
