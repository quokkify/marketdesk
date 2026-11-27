// What the advert checks read from OLX about one live advert: its category, attributes and delivery
// packages, the category's attribute list, and OLX's category suggestions for the title. Loaded at
// most once per verdict run and shared by the category, attributes and delivery checks. It holds
// seller text (the title), so it stays out of graph state.
// The category is OLX's own. When the stored category differs from it (outOfSync) the catalogue is
// not read and every check waits for a sync; a drifted advert (another title or price on OLX than
// MarketDesk would send) is never written.

import type { Listing } from '../../../domain/entities/Listing';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import type { IMarketplaceAdapter } from '../../../domain/services/MarketplaceAdapter';
import type { AdvertAttribute, OlxCategoryAttribute } from '../../../domain/services/advertCompletenessRules';
import { InvalidStateError } from '../../../domain/shared/DomainError';
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
  // OLX suggests categories for the title and the advert's is not among them.
  categoryMismatch: boolean;
  outOfSync: boolean;
  drifted: boolean;
}

type OlxAdvertAdapter = Required<
  Pick<IMarketplaceAdapter, 'advertFields' | 'categoryAttributes' | 'categorySuggestions'>
>;

function offersAdvertFields(adapter: IMarketplaceAdapter): adapter is IMarketplaceAdapter & OlxAdvertAdapter {
  return Boolean(adapter.advertFields && adapter.categoryAttributes && adapter.categorySuggestions);
}

// The route runs the advert checks only with a snapshot loader, so its absence is a wiring error.
export async function requireOlxSnapshot(ctx: CheckContext): Promise<OlxAdvertSnapshot> {
  if (!ctx.olx) throw new Error('The advert checks need a live OLX advert');
  return ctx.olx();
}

// The loader resolves the authenticated adapter and runs its reads on the first call, so a run
// without an advert check never fetches an OLX token; every later call gets the same promise.
export function olxAdvertSnapshotLoader(
  resolveAdapter: () => Promise<IMarketplaceAdapter>,
  listing: Listing,
  externalListingId: string,
  title: string,
): () => Promise<OlxAdvertSnapshot> {
  let snapshot: Promise<OlxAdvertSnapshot> | null = null;
  const load = async (): Promise<OlxAdvertSnapshot> => {
    const adapter = await resolveAdapter();
    if (!offersAdvertFields(adapter)) throw new InvalidStateError('This marketplace cannot read advert fields');
    const fields = await adapter.advertFields(externalListingId, { title, price: listing.price.amount });
    const listingCategoryId = fields.categoryId;
    const stored = listing.marketplaceCategory?.providerCategoryId;
    const outOfSync = stored !== undefined && stored !== listingCategoryId;
    const [categoryAttributes, suggestionIds] = outOfSync
      ? [[], []]
      : await Promise.all([adapter.categoryAttributes(listingCategoryId), adapter.categorySuggestions(title)]);
    return {
      listingCategoryId,
      title,
      externalListingId,
      externalUrl: listing.externalUrl,
      attributes: fields.attributes,
      deliveryPackageIds: fields.deliveryPackageIds,
      categoryAttributes,
      suggestionIds,
      categoryMismatch: suggestionIds.length > 0 && !suggestionIds.includes(listingCategoryId),
      outOfSync,
      drifted: fields.drifted,
    };
  };
  return () => (snapshot ??= load());
}

// The owner dismissed the latest category mismatch recommendation for this listing and category.
export async function categoryKeptByOwner(
  events: Pick<IEventRepository, 'findByProduct'>,
  ctx: CheckContext,
  snapshot: OlxAdvertSnapshot,
): Promise<boolean> {
  const { listing } = ctx;
  if (!snapshot.categoryMismatch || !listing) return false;
  const latest = (await events.findByProduct(ctx.workspace.id, ctx.product.id, ['olx_category_mismatch'])).find(
    (event) =>
      event.proposedChange?.kind === 'category_recreation' &&
      event.proposedChange.listingId === listing.id &&
      event.proposedChange.currentCategory.providerCategoryId === snapshot.listingCategoryId,
  );
  return latest?.status === 'dismissed';
}

// A category mismatch the owner has not kept stops the attributes and delivery checks.
export async function categoryBlocks(
  events: Pick<IEventRepository, 'findByProduct'>,
  ctx: CheckContext,
  snapshot: OlxAdvertSnapshot,
): Promise<boolean> {
  return snapshot.categoryMismatch && !(await categoryKeptByOwner(events, ctx, snapshot));
}
