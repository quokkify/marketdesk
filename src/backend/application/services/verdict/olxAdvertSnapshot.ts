// What the advert checks read from OLX about one live advert: its category, attributes and delivery
// packages, the category's attribute list, and OLX's category suggestions for the title. Loaded at
// most once per verdict run and shared by the category, attributes and delivery checks. It holds
// seller text (the title), so it stays out of graph state.

import type { Listing } from '../../../domain/entities/Listing';
import type { IMarketplaceAdapter } from '../../../domain/services/MarketplaceAdapter';
import type { AdvertAttribute, OlxCategoryAttribute } from '../../../domain/services/advertCompletenessRules';
import type { CheckContext } from './SaleVerdictGraph';

export interface OlxAdvertSnapshot {
  listingCategoryId: string;
  title: string;
  externalListingId: string;
  externalUrl: string | null;
  attributes: AdvertAttribute[];
  deliveryPackageIds: string[];
  categoryAttributes: OlxCategoryAttribute[];
  suggestionIds: string[];
  categoryMismatch: boolean;
}

export type OlxAdvertAdapter = Required<
  Pick<IMarketplaceAdapter, 'advertFields' | 'categoryAttributes' | 'categorySuggestions'>
>;

export function offersAdvertFields(adapter: IMarketplaceAdapter): adapter is IMarketplaceAdapter & OlxAdvertAdapter {
  return Boolean(adapter.advertFields && adapter.categoryAttributes && adapter.categorySuggestions);
}

// The route runs the advert checks only with a snapshot loader, so its absence is a wiring error.
export async function requireOlxSnapshot(ctx: CheckContext): Promise<OlxAdvertSnapshot> {
  if (!ctx.olx) throw new Error('The advert checks need a live OLX advert');
  return ctx.olx();
}

// The loader runs its reads on the first call; every later call gets the same promise.
export function olxAdvertSnapshotLoader(
  adapter: OlxAdvertAdapter,
  listing: Listing,
  externalListingId: string,
  title: string,
): () => Promise<OlxAdvertSnapshot> {
  let snapshot: Promise<OlxAdvertSnapshot> | null = null;
  const load = async (): Promise<OlxAdvertSnapshot> => {
    const fields = await adapter.advertFields(externalListingId);
    const listingCategoryId = listing.marketplaceCategory?.providerCategoryId ?? fields.categoryId;
    const [categoryAttributes, suggestionIds] = await Promise.all([
      adapter.categoryAttributes(listingCategoryId),
      adapter.categorySuggestions(title),
    ]);
    return {
      listingCategoryId,
      title,
      externalListingId,
      externalUrl: listing.externalUrl,
      attributes: fields.attributes,
      deliveryPackageIds: fields.deliveryPackageIds,
      categoryAttributes,
      suggestionIds,
      categoryMismatch: !suggestionIds.includes(listingCategoryId),
    };
  };
  return () => (snapshot ??= load());
}
