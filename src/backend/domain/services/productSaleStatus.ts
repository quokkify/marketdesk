// A live marketplace listing puts its product on sale. Product status moves forward only, so only a
// draft changes; active, attention and sold products stay as they are. Publishing already applies
// this rule (ListingService); sync and reactivation bring listings live without publishing.
import type { Product } from '../entities/Product';
import type { Listing } from '../entities/Listing';
import { Ok, type Result } from '../shared/Result';

export function activateDraftWithLiveListing(
  product: Product,
  listings: readonly Listing[]
): Result<boolean> {
  if (product.status !== 'draft') return Ok(false);
  const hasLiveListing = listings.some(
    (listing) => listing.productId === product.id && listing.status === 'live'
  );
  if (!hasLiveListing) return Ok(false);
  const activated = product.activate();
  return activated.isErr() ? activated : Ok(true);
}
