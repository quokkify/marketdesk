// Writes attributes and delivery packages onto a live OLX advert, then re-reads the advert to tell
// which of the requested attributes OLX actually kept. An advert whose title or price changed on OLX
// since the last sync is never written.
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import { ADVERT_DRIFTED, type AdvertAttribute } from '../../domain/services/advertCompletenessRules';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';
import { buildListingPublishInput } from '../usecases/PublishListingUseCase';

export interface AdvertFieldsServiceDeps {
  products: IProductRepository;
  listings: IListingRepository;
  marketplaces: IMarketplaceRepository;
  adapters: { resolve(marketplace: Marketplace): Promise<IMarketplaceAdapter> };
}

export interface AdvertFieldsChange {
  attributes?: AdvertAttribute[];
  deliveryPackageIds?: string[];
}

export class AdvertFieldsService {
  constructor(private readonly deps: AdvertFieldsServiceDeps) {}

  async apply(
    workspaceId: string,
    listingId: string,
    fields: AdvertFieldsChange,
  ): Promise<{ kept: AdvertAttribute[]; dropped: AdvertAttribute[] }> {
    const listing = await this.deps.listings.findByIdForWorkspace(listingId, workspaceId);
    if (!listing) throw new NotFoundError(`Listing not found: ${listingId}`);
    const externalListingId = listing.marketplaceListingId;
    if (listing.status !== 'live' || !externalListingId) {
      throw new InvalidStateError('Advert fields can only be changed on a live advert');
    }
    const product = await this.deps.products.findByIdForWorkspace(listing.productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${listing.productId}`);
    const marketplace = await this.deps.marketplaces.findByIdForWorkspace(
      listing.marketplaceId,
      workspaceId,
    );
    if (!marketplace) throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
    if (!marketplace.isConnected()) {
      throw new InvalidStateError('The marketplace is not connected');
    }

    const adapter = await this.deps.adapters.resolve(marketplace);
    if (!adapter.updateAdvertFields || !adapter.advertFields) {
      throw new InvalidStateError('This marketplace cannot change advert fields');
    }
    const current = buildListingPublishInput(product, listing);
    const sent = { title: current.productName, price: current.price };
    if ((await adapter.advertFields(externalListingId, sent)).drifted) {
      throw new InvalidStateError(ADVERT_DRIFTED.message);
    }
    await adapter.updateAdvertFields(externalListingId, current, fields);

    const requested = fields.attributes ?? [];
    const reread = await adapter.advertFields(externalListingId, sent);
    const present = new Set(reread.attributes.map((a) => JSON.stringify([a.code, a.value])));
    const kept: AdvertAttribute[] = [];
    const dropped: AdvertAttribute[] = [];
    for (const attribute of requested) {
      (present.has(JSON.stringify([attribute.code, attribute.value])) ? kept : dropped).push(attribute);
    }
    return { kept, dropped };
  }
}
