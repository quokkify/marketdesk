// Marketplace-agnostic adapter PORT (interface only). Concrete adapters
// (OLXAdapter) are implemented in infrastructure.
// The domain stays completely agnostic to marketplace specifics.

import type { AdvertAttribute, OlxCategoryAttribute } from './advertCompletenessRules';
import type { MarketplaceKey, ListingStatus, MarketplaceCategoryMetadata } from '../../../shared/types';

export interface ListingPublishInput {
  productName: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
  condition: string;
  imageUrls: string[];
}

export interface PublishResult {
  externalListingId: string;
  externalUrl?: string | null;
  publishedAt: Date;
  remoteStatus?: string | null;
  remoteImageUrls?: string[];
}
export interface PreparedMarketplacePublish {
  execute(): Promise<PublishResult>;
}

export interface SyncedListing {
  externalListingId: string;
  externalUrl?: string | null;
  status: ListingStatus;
  remoteStatus?: string;
  missing?: boolean;
  syncFailure?: {
    kind: 'isolated_listing_failure';
    reason: 'provider_rejection';
    note: string;
  };
  views?: number | null;
  watchers?: number | null;
  conversations?: number | null;
  messages?: number | null;
  messageMetricStatus?: 'available' | 'unavailable' | 'error';
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
}

export interface ImportedMarketplaceListing {
  externalListingId: string;
  externalUrl?: string | null;
  title: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  status: ListingStatus;
  remoteStatus?: string | null;
  category?: string | null;
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
  imageUrls: string[];
  remoteUpdatedAt?: Date | null;
  metrics?: { views?: number; watchers?: number; conversations?: number | null; messages?: number | null };
}

export interface ImportDiscoveryOptions {
  pageSize?: number;
  statuses?: string[];
}

export interface MarketplaceThread {
  externalThreadId: string;
  externalBuyerId: string | null;
  // Messages the marketplace counts in the thread; null when it does not say.
  totalCount: number | null;
}

export interface MarketplaceMessage {
  externalMessageId: string;
  direction: 'buyer' | 'seller';
  text: string;
  sentAt: Date;
}

export interface MarketplaceThreadMessages {
  // Oldest first; only the messages with text.
  messages: MarketplaceMessage[];
  // Every message the marketplace returned, the skipped ones (attachments only) included.
  fetchedCount: number;
}

export interface IMarketplaceAdapter {
  getKey(): MarketplaceKey;

  // Publish a new listing to the marketplace.
  publish(input: ListingPublishInput): Promise<PublishResult>;
  // Validate and prepare all local provider payload state before a durable
  // publication fence is claimed. execute() begins the provider request.
  preparePublish?(input: ListingPublishInput): Promise<PreparedMarketplacePublish>;

  // Update fields of an existing marketplace listing.
  updateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
    current: ListingPublishInput,
  ): Promise<void>;

  // Remove/unpublish a listing.
  delist(externalListingId: string): Promise<void>;

  // Bring an expired or user-removed advert back under its existing id. Sends the command only;
  // the caller reads the advert back with fetchListing, which may be retried.
  reactivate?(externalListingId: string): Promise<void>;

  // Pull current stats/status for the given external listing ids.
  sync(externalListingIds: string[]): Promise<SyncedListing[]>;

  // Fetch a single listing's current state.
  fetchListing(externalListingId: string): Promise<SyncedListing | null>;

  // Read-only discovery of adverts owned by the connected marketplace account.
  listOwnedListings(options?: ImportDiscoveryOptions): Promise<ImportedMarketplaceListing[]>;

  // Buyer conversations. Optional: only adapters with a messaging API implement them.
  listThreads?(externalListingId: string): Promise<MarketplaceThread[]>;
  // Reading never marks a thread as read on the marketplace.
  listThreadMessages?(externalThreadId: string): Promise<MarketplaceThreadMessages>;
  // Not retried: the marketplace has no idempotency key, so a retry could double-send.
  sendThreadMessage?(externalThreadId: string, text: string): Promise<{ externalMessageId: string | null }>;

  // Advert completeness: the marketplace catalogue and the advert's own category, attributes and delivery.
  categorySuggestions?(title: string): Promise<string[]>;
  categoryAttributes?(categoryId: string): Promise<OlxCategoryAttribute[]>;
  // `drifted`: OLX holds another title or price than `sent`, the ones MarketDesk would write.
  advertFields?(
    externalListingId: string,
    sent: { title: string; price: number },
  ): Promise<{ categoryId: string; attributes: AdvertAttribute[]; deliveryPackageIds: string[]; drifted: boolean }>;
  // Keeps every other attribute and the delivery packages the seller set; only the given fields change, and
  // never an attribute already set on the advert. Writes nothing when the advert drifted.
  updateAdvertFields?(
    externalListingId: string,
    current: ListingPublishInput,
    fields: { attributes?: AdvertAttribute[]; deliveryPackageIds?: string[] },
  ): Promise<void>;
}
