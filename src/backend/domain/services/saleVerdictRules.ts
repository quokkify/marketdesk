// Pure rules of the sale verdict: each check maps existing facts to ready, fix or needs_human,
// and the combiner folds fresh checks over the previous ones. No I/O and no AI here.
import type {
  HermesEventType,
  ProductRecheckItem,
  StoredPriceEstimate,
  VerdictCheck,
  VerdictCheckName,
  VerdictCheckStatus,
  VerdictOverall,
  VerdictReason,
} from '../../../shared/types';

export const MIN_PHOTOS = 1;

const INFO_KEYS: ReadonlySet<ProductRecheckItem['key']> = new Set([
  'title',
  'description',
  'required_fields',
  'category',
  'marketplace',
]);

export type PriceCheckInput =
  | { kind: 'no_listing' }
  | { kind: 'not_pln' }
  | { kind: 'not_configured' }
  | { kind: 'research_running' }
  | { kind: 'failed' }
  | {
      kind: 'estimated';
      currentPrice: number;
      stored: StoredPriceEstimate | null;
      suggestionType: HermesEventType | null;
      eventIds: string[];
    };

// The price check exists only for PLN listings.
const PRICE_CHECK_CURRENCY = 'PLN';

type VerdictChecks = Partial<Record<VerdictCheckName, VerdictCheck>>;

function makeCheck(
  check: VerdictCheckName,
  status: VerdictCheckStatus,
  reasons: VerdictReason[],
  now: Date,
  refs: VerdictCheck['refs'] = { eventIds: [] },
): VerdictCheck {
  return { check, status, reasons, checkedAt: now.toISOString(), refs };
}

export function photosCheck(imageCount: number, now: Date): VerdictCheck {
  if (imageCount < MIN_PHOTOS) {
    return makeCheck(
      'photos',
      'fix',
      [{ code: 'photos_missing', message: 'Add at least one photo of the product', field: 'images' }],
      now,
      { eventIds: [], photoCount: imageCount },
    );
  }
  return makeCheck('photos', 'ready', [], now, { eventIds: [], photoCount: imageCount });
}

export function infoCheckFromRecheck(items: ProductRecheckItem[], now: Date): VerdictCheck {
  const flagged = items.filter((item) => INFO_KEYS.has(item.key) && item.status !== 'ready');
  const reasons: VerdictReason[] = flagged.map((item) => ({
    code: `info_${item.key}`,
    message: item.message,
    field: item.editField,
  }));
  const status: VerdictCheckStatus = flagged.some((item) => item.status === 'review')
    ? 'needs_human'
    : flagged.length > 0
      ? 'fix'
      : 'ready';
  return makeCheck('info', status, reasons, now);
}

export function checkFailed(check: VerdictCheckName, now: Date): VerdictCheck {
  return makeCheck(
    check,
    'needs_human',
    [{ code: 'check_failed', message: 'This check could not be completed, please review it manually' }],
    now,
  );
}

const PRICE_NEEDS_HUMAN: Record<'no_listing' | 'not_pln' | 'not_configured', VerdictReason> = {
  no_listing: { code: 'no_listing', message: 'Create a listing to check the price' },
  not_pln: { code: 'not_pln', message: 'The fair price check supports only PLN listings' },
  not_configured: { code: 'not_configured', message: 'Price research is not configured' },
};

export function priceCheckFromEstimate(input: PriceCheckInput, now: Date): VerdictCheck {
  switch (input.kind) {
    case 'no_listing':
    case 'not_pln':
    case 'not_configured':
      return makeCheck('price', 'needs_human', [PRICE_NEEDS_HUMAN[input.kind]], now);
    case 'failed':
      return checkFailed('price', now);
    case 'research_running':
      return makeCheck('price', 'pending', [], now);
    case 'estimated':
      return estimatedPriceCheck(input, now);
  }
}

function estimatedPriceCheck(
  input: Extract<PriceCheckInput, { kind: 'estimated' }>,
  now: Date,
): VerdictCheck {
  const { currentPrice, stored, suggestionType, eventIds } = input;
  const baseRefs = {
    eventIds,
    researchUpdatedAt: stored?.researchUpdatedAt ?? null,
    currentPrice,
    currency: PRICE_CHECK_CURRENCY,
  };
  const result = (status: VerdictCheckStatus, reason: VerdictReason, proposedPrice: number | null = null) =>
    makeCheck('price', status, [reason], now, { ...baseRefs, proposedPrice });

  if (suggestionType === 'price_estimate_unavailable' || stored === null) {
    return result('needs_human', {
      code: 'estimate_unavailable',
      message: 'A fair price could not be estimated, set the price manually',
    });
  }
  if (stored.hiddenReason === 'low_confidence') {
    return result('needs_human', {
      code: 'weak_research',
      message: 'Price research is too weak to judge the price, check it manually',
    });
  }
  const { startPrice, floorPrice } = stored.estimate;
  if (currentPrice > startPrice && suggestionType === 'suggested_lower_price') {
    return result('fix', {
      code: 'above_ceiling',
      message: `The price is above the fair ceiling of ${startPrice}`,
      field: 'sellingPrice',
    }, startPrice);
  }
  if (currentPrice < floorPrice) {
    return result('fix', {
      code: 'below_floor',
      message: `The price is below the fair floor of ${floorPrice}`,
      field: 'sellingPrice',
    });
  }
  return result('ready', { code: 'fair_price', message: 'The price is within the fair range' });
}

export function combineVerdict(
  fresh: VerdictCheck[],
  previous: VerdictChecks,
): { checks: VerdictChecks; overall: VerdictOverall } {
  const checks: VerdictChecks = { ...previous };
  for (const check of fresh) checks[check.check] = check;

  // A pending check is not judged yet, so the overall cannot be ready: it counts as needs_human.
  const statuses = Object.values(checks).map((check) => (check.status === 'pending' ? 'needs_human' : check.status));
  let overall: VerdictOverall = 'ready';
  if (statuses.length === 0 || statuses.includes('needs_human')) overall = 'needs_human';
  else if (statuses.includes('fix')) overall = 'fix';
  return { checks, overall };
}
