import type { MarketplaceCategoryMetadata } from '../../../shared/types';
import type { OlxCategorySearchResult, OlxTrustedTaxonomyResolver } from './OlxTaxonomyResolver';

// The OLX category guard rejects taxonomy metadata that stays fresh for longer than
// 24 hours, so sandbox metadata uses the same lifetime as the real resolver.
const SANDBOX_TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SEARCH_RESULTS = 20;

// Fixed sandbox taxonomy: the leaves of a small static tree with their full paths.
const SANDBOX_LEAF_CATEGORIES: readonly OlxCategorySearchResult[] = [
  { providerCategoryId: '1001', name: 'Cameras', path: ['Electronics', 'Cameras'] },
  { providerCategoryId: '1002', name: 'Phones', path: ['Electronics', 'Phones'] },
  { providerCategoryId: '1003', name: 'Headphones', path: ['Electronics', 'Audio', 'Headphones'] },
  { providerCategoryId: '1004', name: 'Computers', path: ['Electronics', 'Computers'] },
  { providerCategoryId: '2001', name: 'Clothing', path: ['Fashion', 'Clothing'] },
  { providerCategoryId: '3001', name: 'Furniture', path: ['Home & Garden', 'Furniture'] },
  { providerCategoryId: '4001', name: 'Equipment', path: ['Sports & Hobby', 'Equipment'] },
  { providerCategoryId: '9001', name: 'Other', path: ['Other'] },
];

/**
 * Sandbox stand-in for the OLX Partner taxonomy, used while the OLX adapter is not
 * real. It never calls OLX and needs no access token. Inputs are validated and
 * rejected with the same errors as OlxTaxonomyResolver.
 */
export class StubOlxTaxonomyResolver implements OlxTrustedTaxonomyResolver {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async verify(providerCategoryId: string): Promise<MarketplaceCategoryMetadata> {
    if (!/^[1-9]\d*$/.test(providerCategoryId)) {
      throw new Error('OLX category id must be a positive numeric provider id');
    }
    const leaf = SANDBOX_LEAF_CATEGORIES.find(
      (category) => category.providerCategoryId === providerCategoryId,
    );
    if (!leaf) throw new Error('OLX category is not a verified leaf category');
    const verifiedAt = this.now();
    return {
      providerCategoryId: leaf.providerCategoryId,
      name: leaf.name,
      path: [...leaf.path],
      source: 'provider_taxonomy',
      confidence: 1,
      isLeaf: true,
      taxonomyVerifiedAt: verifiedAt.toISOString(),
      taxonomyStaleAt: new Date(verifiedAt.getTime() + SANDBOX_TAXONOMY_TTL_MS).toISOString(),
      sandbox: true,
    };
  }

  async search(query: string, limit = MAX_SEARCH_RESULTS): Promise<OlxCategorySearchResult[]> {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length < 2 || normalized.length > 80) {
      throw new Error('Search must contain 2–80 characters');
    }
    return SANDBOX_LEAF_CATEGORIES
      .filter((category) => category.name.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => {
        const startsA = a.name.toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
        const startsB = b.name.toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
        return startsA - startsB
          || a.name.localeCompare(b.name)
          || a.providerCategoryId.localeCompare(b.providerCategoryId);
      })
      .slice(0, Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS))
      .map((category) => ({ ...category, path: [...category.path] }));
  }
}
