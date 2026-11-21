import { evaluatePublishEligibility } from '../usecases/PublishListingUseCase';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';
import { ValidationError } from '../../domain/shared/DomainError';
import { unwrap, money } from '../../domain/testkit/support';

const CONDITION_MESSAGE = "Choose the product's condition before publishing to OLX";

function eligibilityFor(condition: 'unknown' | 'good', marketplaceKey: 'olx' | 'ebay' = 'olx') {
  const product = unwrap(
    Product.create({
      id: 'prod-1',
      workspaceId: 'ws-1',
      sku: 'SKU-1',
      name: 'Lamp',
      description: 'A beautiful vintage brass lamp in excellent condition.',
      costPrice: money(50),
      sellingPrice: money(100),
      condition,
      category: 'home',
      images: ['a.jpg'],
    })
  );
  const marketplace = unwrap(
    Marketplace.create({ id: 'mp-1', workspaceId: 'ws-1', key: marketplaceKey, name: 'Market', connected: true })
  );
  const listing = unwrap(
    Listing.create({ id: 'lst-1', productId: 'prod-1', marketplaceId: 'mp-1', price: money(100) })
  );
  return evaluatePublishEligibility(listing, product, marketplace);
}

describe('evaluatePublishEligibility condition rule', () => {
  it('refuses an OLX publish while the condition is unknown', () => {
    const decision = eligibilityFor('unknown');
    expect(decision.canPublish).toBe(false);
    expect(decision.warnings).toEqual([CONDITION_MESSAGE]);
    expect(decision.error).toBeInstanceOf(ValidationError);
    expect(decision.error?.message).toBe(CONDITION_MESSAGE);
  });

  it('accepts an OLX publish with a known condition', () => {
    const decision = eligibilityFor('good');
    expect(decision.canPublish).toBe(true);
    expect(decision.warnings).toEqual([]);
  });

  it('leaves other marketplaces alone', () => {
    expect(eligibilityFor('unknown', 'ebay').canPublish).toBe(true);
  });
});
