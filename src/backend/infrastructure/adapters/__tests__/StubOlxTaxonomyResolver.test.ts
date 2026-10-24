import { StubOlxTaxonomyResolver } from '../StubOlxTaxonomyResolver';
import { OlxTaxonomyResolver } from '../OlxTaxonomyResolver';
import type { MarketplaceHttpClient } from '../MarketplaceHttpClient';
import { evaluateOlxCategory } from '../../../domain/services/OlxCategoryGuard';

const NOW = new Date('2026-10-24T09:00:00.000Z');

describe('StubOlxTaxonomyResolver', () => {
  it("search('head') returns the Headphones leaf", async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.search('head')).resolves.toEqual([
      { providerCategoryId: '1003', name: 'Headphones', path: ['Electronics', 'Audio', 'Headphones'] },
    ]);
  });

  it('ranks leaves whose name starts with the query before other matches', async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.search('PH')).resolves.toEqual([
      { providerCategoryId: '1002', name: 'Phones', path: ['Electronics', 'Phones'] },
      { providerCategoryId: '1003', name: 'Headphones', path: ['Electronics', 'Audio', 'Headphones'] },
    ]);
  });

  it('returns at most the requested number of matches', async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.search('er', 1)).resolves.toEqual([
      { providerCategoryId: '1001', name: 'Cameras', path: ['Electronics', 'Cameras'] },
    ]);
  });

  it('rejects a search shorter than two characters like the real resolver', async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.search(' h ')).rejects.toThrow('Search must contain 2–80 characters');
  });

  it("verify('1003') returns leaf metadata", async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.verify('1003')).resolves.toEqual({
      providerCategoryId: '1003',
      name: 'Headphones',
      path: ['Electronics', 'Audio', 'Headphones'],
      source: 'provider_taxonomy',
      confidence: 1,
      isLeaf: true,
      taxonomyVerifiedAt: '2026-10-24T09:00:00.000Z',
      taxonomyStaleAt: '2026-10-25T09:00:00.000Z',
    });
  });

  it.each<[string, string[]]>([
    ['1001', ['Electronics', 'Cameras']],
    ['1002', ['Electronics', 'Phones']],
    ['1003', ['Electronics', 'Audio', 'Headphones']],
    ['1004', ['Electronics', 'Computers']],
    ['2001', ['Fashion', 'Clothing']],
    ['3001', ['Home & Garden', 'Furniture']],
    ['4001', ['Sports & Hobby', 'Equipment']],
    ['9001', ['Other']],
  ])('verifies leaf %s with its fixed sandbox path', async (providerCategoryId, path) => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.verify(providerCategoryId)).resolves.toMatchObject({
      providerCategoryId,
      name: path[path.length - 1],
      path,
      isLeaf: true,
    });
  });

  it("verify('1000') rejects with the same error as the real resolver for a non-leaf category", async () => {
    const realResolver = new OlxTaxonomyResolver(
      {
        request: (async () => ({
          status: 200,
          data: { id: 1000, name: 'Electronics', leaf: false },
        })) as MarketplaceHttpClient['request'],
      },
      'https://example.test/api',
      () => NOW,
    );
    const realError = await realResolver.verify('1000').then(
      () => { throw new Error('the real resolver accepted a non-leaf category'); },
      (error: unknown) => error as Error,
    );

    const stubError = await new StubOlxTaxonomyResolver(() => NOW).verify('1000').then(
      () => { throw new Error('the stub resolver accepted a non-leaf category'); },
      (error: unknown) => error as Error,
    );

    expect(stubError.constructor).toBe(realError.constructor);
    expect(stubError.message).toBe(realError.message);
    expect(stubError.message).toBe('OLX category is not a verified leaf category');
  });

  it('rejects an id outside the sandbox taxonomy as an unverified leaf', async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.verify('5555')).rejects.toThrow(
      new Error('OLX category is not a verified leaf category'),
    );
  });

  it('rejects a malformed id with the real resolver message', async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);

    await expect(resolver.verify('01')).rejects.toThrow(
      'OLX category id must be a positive numeric provider id',
    );
  });

  it('returns metadata that the OLX category guard accepts for publication', async () => {
    const resolver = new StubOlxTaxonomyResolver(() => NOW);
    const category = await resolver.verify('1001');

    const decision = evaluateOlxCategory(
      {
        name: 'Mirrorless camera',
        description: 'Mirrorless camera body with a charger and two batteries.',
        category: 'electronics',
      },
      category,
      NOW,
    );

    expect(decision).toEqual({ allowed: true, requiresReview: false });
  });
});
