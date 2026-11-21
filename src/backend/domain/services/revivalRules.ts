// Rules of a revival proposal that need no AI: which product facts are missing before an expired
// advert can come back, and whether a proposed price stays above the known cost price.
import type { Product } from '../entities/Product';
import type { RevivalMissingFact, RevivalPriceGuard } from '../../../shared/types';

export const REVIVAL_REFUSAL_MESSAGE = 'Only an expired listing with an OLX advert can be revived';

export function missingFacts(product: Pick<Product, 'condition' | 'costPrice'>): RevivalMissingFact[] {
  const facts: RevivalMissingFact[] = [];
  if (product.condition === 'unknown') {
    facts.push({ field: 'condition', required: true, note: "Choose the product's condition before publishing to OLX" });
  }
  if (product.costPrice === null) {
    facts.push({ field: 'costPrice', required: false, note: 'Without a cost price the price floor cannot be checked' });
  }
  return facts;
}

export function priceGuard(proposedPrice: number | null, costPrice: number | null): RevivalPriceGuard {
  if (proposedPrice === null) return { status: 'no_proposal', costPrice };
  if (costPrice === null) return { status: 'unchecked', costPrice };
  return { status: proposedPrice < costPrice ? 'below_cost' : 'ok', costPrice };
}
