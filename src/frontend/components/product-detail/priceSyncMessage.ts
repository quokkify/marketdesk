import type { PriceSync } from '@shared/types';

const NOT_CONNECTED_REASONS = new Set(['marketplace_not_connected', 'marketplace_account_not_connected']);

export function priceSyncMessage(sync: PriceSync | undefined, priceText: string): string {
  if (sync && sync.marketplaceUpdates.length > 0) {
    return `Price ${priceText} saved and sent to OLX.`;
  }
  const skipped = sync?.skippedLiveListings[0];
  if (skipped) {
    const reason = NOT_CONNECTED_REASONS.has(skipped.reason) ? 'OLX is not connected' : skipped.reason;
    return `Price ${priceText} saved. Not sent to OLX: ${reason}.`;
  }
  return `Price ${priceText} saved.`;
}
