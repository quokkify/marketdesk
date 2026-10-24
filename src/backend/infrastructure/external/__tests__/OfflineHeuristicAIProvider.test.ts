// Built-in heuristics used when the Hermes Agent API is not configured or not
// reachable. Expected values are hand-checked literals derived from the C1 brief.

import { OfflineHeuristicAIProvider } from '../OfflineHeuristicAIProvider';
import { Product, type CreateProductProps } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import {
  listingSeoOutputSchema,
  type ListingSeoInput,
} from '../../../domain/agents/MarketDeskAgentCatalog';
import { money, unwrap } from '../../../domain/testkit/support';

const endsWithOfflineNotice = expect.stringMatching(
  / Heuristic offline suggestion; Hermes was not consulted\.$/,
);

function buildProduct(overrides: Partial<CreateProductProps> = {}): Product {
  return unwrap(
    Product.create({
      id: 'p1',
      workspaceId: 'w1',
      sku: 'SKU-1',
      name: 'Leather sneaker',
      description: 'Classic leather sneakers in size 42, lightly worn, with no scuffs, tears, stain.',
      costPrice: money(80),
      sellingPrice: money(120),
      condition: 'good',
      category: 'clothing',
      images: ['a.jpg', 'b.jpg', 'c.jpg'],
      tags: ['sneakers'],
      ...overrides,
    }),
  );
}

function buildListing(price: number): Listing {
  return unwrap(
    Listing.create({ id: 'l1', productId: 'p1', marketplaceId: 'm1', price: money(price) }),
  );
}

describe('OfflineHeuristicAIProvider', () => {
  const provider = new OfflineHeuristicAIProvider();

  it('reports itself as the offline source, so its results are never labelled Hermes', async () => {
    await expect(provider.activeProvider()).resolves.toBe('offline');
  });

  describe('suggestPrice', () => {
    it('prices an unpriced listing at cost plus 30 percent, rounded to whole zloty', async () => {
      const suggestion = await provider.suggestPrice({
        listing: buildListing(0),
        recentViews: 0,
        conversionRate: 0,
        costPrice: 15.5,
      });

      expect(suggestion).toEqual({
        suggestedPrice: 20,
        confidence: 'low',
        reasoning: endsWithOfflineNotice,
      });
      expect(suggestion.reasoning).not.toMatch(/unknown/);
    });

    it('suggests 1 PLN for an unpriced listing whose cost is unknown', async () => {
      const suggestion = await provider.suggestPrice({
        listing: buildListing(0),
        recentViews: 0,
        conversionRate: 0,
      });

      expect(suggestion).toEqual({
        suggestedPrice: 1,
        confidence: 'low',
        reasoning: endsWithOfflineNotice,
      });
      expect(suggestion.reasoning).toMatch(/product cost is unknown/);
    });

    it.each([
      { recentViews: 50, conversionRate: 0 },
      { recentViews: 200, conversionRate: 0.02 },
    ])(
      'keeps the exact current price at $recentViews views and conversion $conversionRate',
      async ({ recentViews, conversionRate }) => {
        const suggestion = await provider.suggestPrice({
          listing: buildListing(29.99),
          recentViews,
          conversionRate,
          costPrice: 10,
        });

        expect(suggestion).toEqual({
          suggestedPrice: 29.99,
          confidence: 'low',
          reasoning: endsWithOfflineNotice,
        });
      },
    );

    it('cuts the price by 10 percent when more than 50 views brought no sales', async () => {
      const suggestion = await provider.suggestPrice({
        listing: buildListing(120),
        recentViews: 51,
        conversionRate: 0,
        costPrice: 80,
      });

      expect(suggestion).toEqual({
        suggestedPrice: 108,
        confidence: 'low',
        reasoning: endsWithOfflineNotice,
      });
      expect(suggestion.reasoning).not.toMatch(/unknown/);
    });

    it('cuts the price by 10 percent with only a 1 PLN floor when the cost is unknown', async () => {
      const suggestion = await provider.suggestPrice({
        listing: buildListing(120),
        recentViews: 51,
        conversionRate: 0,
      });

      expect(suggestion).toEqual({
        suggestedPrice: 108,
        confidence: 'low',
        reasoning: endsWithOfflineNotice,
      });
      expect(suggestion.reasoning).toMatch(/product cost is unknown/);
    });

    it('stops the cut at cost plus 5 percent, rounded up to whole zloty', async () => {
      // 104 * 1.05 = 109.2 rounds up to 110, above the 10% cut to 108.
      const suggestion = await provider.suggestPrice({
        listing: buildListing(120),
        recentViews: 80,
        conversionRate: 0,
        costPrice: 104,
      });

      expect(suggestion).toEqual({
        suggestedPrice: 110,
        confidence: 'low',
        reasoning: endsWithOfflineNotice,
      });
    });

    it.each([
      { branch: 'a 10 percent cut', price: 120, costPrice: 80, recentViews: 51 },
      { branch: 'a cut down to the floor', price: 120, costPrice: 104, recentViews: 80 },
      { branch: 'a kept price', price: 100, costPrice: 96, recentViews: 80 },
    ])(
      'regression: says no sale is recorded yet instead of claiming views brought no sales ($branch)',
      async ({ price, costPrice, recentViews }) => {
        // Callers pass conversionRate 0 when no sale is recorded, not when sales were measured.
        const suggestion = await provider.suggestPrice({
          listing: buildListing(price),
          recentViews,
          conversionRate: 0,
          costPrice,
        });

        expect(suggestion.reasoning).toMatch(/no recorded sale yet/);
        expect(suggestion.reasoning).not.toMatch(/brought no sales/);
      },
    );

    it.each([
      { branch: 'an unpriced listing', price: 0, recentViews: 0, suggestedPrice: 1 },
      { branch: 'a cut with a 1 PLN floor', price: 120, recentViews: 51, suggestedPrice: 108 },
    ])(
      'regression: describes a recorded cost of 0 as no positive cost, not as unknown ($branch)',
      async ({ price, recentViews, suggestedPrice }) => {
        const suggestion = await provider.suggestPrice({
          listing: buildListing(price),
          recentViews,
          conversionRate: 0,
          costPrice: 0,
        });

        expect(suggestion.suggestedPrice).toBe(suggestedPrice);
        expect(suggestion.reasoning).toMatch(/no positive product cost is recorded/i);
        expect(suggestion.reasoning).not.toMatch(/unknown/);
      },
    );

    it.each([
      { price: 100, costPrice: 96 },
      { price: 105, costPrice: 100 },
    ])(
      'keeps the price $price when no cut stays above cost $costPrice plus 5 percent',
      async ({ price, costPrice }) => {
        const suggestion = await provider.suggestPrice({
          listing: buildListing(price),
          recentViews: 80,
          conversionRate: 0,
          costPrice,
        });

        expect(suggestion).toEqual({
          suggestedPrice: price,
          confidence: 'low',
          reasoning: endsWithOfflineNotice,
        });
        expect(suggestion.reasoning).toMatch(/current price is kept/);
      },
    );
  });

  describe('generateTitle', () => {
    it('tidies spacing, capitalizes the first letter and appends the missing condition', async () => {
      const title = await provider.generateTitle(
        buildProduct({ name: 'retro   sneakers  size 42' }),
        null,
      );

      expect(title).toBe('Retro sneakers size 42 - Good condition');
    });

    it('does not repeat a condition the title already names', async () => {
      const title = await provider.generateTitle(
        buildProduct({ name: 'Desk lamp, like new', condition: 'like_new' }),
        null,
      );

      expect(title).toBe('Desk lamp, like new');
    });

    it('leaves a first word that carries its own capitals untouched', async () => {
      const title = await provider.generateTitle(
        buildProduct({ name: 'iPhone 13 128 GB', condition: 'new' }),
        null,
      );

      expect(title).toBe('iPhone 13 128 GB - New');
    });

    it('shortens a long title at a word boundary to fit 70 characters with the condition', async () => {
      const title = await provider.generateTitle(
        buildProduct({
          name: 'Vintage leather messenger bag with brass buckles, adjustable shoulder strap and laptop sleeve',
          condition: 'fair',
        }),
        null,
      );

      expect(title).toBe('Vintage leather messenger bag with brass buckles - Fair condition');
    });

    it('offline title never stacks condition suffixes', async () => {
      const product = buildProduct({ name: 'Camera', condition: 'good' });

      const first = await provider.generateTitle(product, null);
      unwrap(product.rename(first));
      unwrap(product.updateCondition('fair'));
      const second = await provider.generateTitle(product, null);

      expect(first).toBe('Camera - Good condition');
      expect(second).toBe('Camera - Fair condition');
    });

    it('collapses condition suffixes that already stacked into the current one', async () => {
      const title = await provider.generateTitle(
        buildProduct({ name: 'Camera - Good condition - Fair condition', condition: 'fair' }),
        null,
      );

      expect(title).toBe('Camera - Fair condition');
    });

    it('appends nothing when the title already names another condition', async () => {
      const title = await provider.generateTitle(
        buildProduct({ name: 'Like new desk lamp', condition: 'good' }),
        null,
      );

      expect(title).toBe('Like new desk lamp');
    });

    it.each([
      { name: 'New Balance 574 sneakers', condition: 'good', expected: 'New Balance 574 sneakers - Good condition' },
      { name: 'New Era cap', condition: 'like_new', expected: 'New Era cap - Like new' },
      { name: 'New Balance 574', condition: 'new', expected: 'New Balance 574 - New' },
    ] as const)(
      'regression: the bare word "new" does not count as a named condition ($name)',
      async ({ name, condition, expected }) => {
        // Only full condition phrases ("Like new", "Good condition") count: "New" starts brands.
        const title = await provider.generateTitle(buildProduct({ name, condition }), null);

        expect(title).toBe(expected);
      },
    );

    it('appends nothing when the condition is unknown', async () => {
      const title = await provider.generateTitle(
        buildProduct({ name: 'Desk lamp', condition: 'unknown' }),
        null,
      );

      expect(title).toBe('Desk lamp');
    });
  });

  describe('analyzeListing', () => {
    it('scores a listing that meets every threshold 100 with no suggestions', async () => {
      const analysis = await provider.analyzeListing(buildProduct());

      expect(analysis).toEqual({ score: 100, suggestions: [] });
    });

    it('deducts 20 points for each element just below its threshold', async () => {
      const analysis = await provider.analyzeListing(
        buildProduct({
          name: 'Leather boots!',
          description: 'Classic leather sneakers in size 42, lightly worn, with no scuffs, tear, stain.',
          images: ['a.jpg', 'b.jpg'],
          tags: [],
        }),
      );

      expect(analysis.score).toBe(20);
      expect(analysis.suggestions).toEqual([
        expect.stringMatching(/at least 3 photos/i),
        expect.stringMatching(/description/i),
        expect.stringMatching(/tags/i),
        expect.stringMatching(/title/i),
      ]);
    });

    it('counts a listing without photos as both missing photos and too few photos', async () => {
      const analysis = await provider.analyzeListing(buildProduct({ images: [] }));

      expect(analysis.score).toBe(60);
      expect(analysis.suggestions).toEqual([
        expect.stringMatching(/has no photos/i),
        expect.stringMatching(/at least 3 photos/i),
      ]);
    });
  });

  describe('analyzeListingSeo', () => {
    it('recommends the tidied title and description, each labelled as offline', async () => {
      const messyDescription = '  classic retro sneakers.   Lightly worn.\n\n\n\nNo box.  ';
      const input: ListingSeoInput = {
        product: {
          id: 'p1',
          name: 'retro   sneakers',
          description: messyDescription,
          category: 'clothing',
          condition: 'good',
          tags: ['retro'],
          imageCount: 2,
        },
        listing: {
          id: 'l1',
          title: 'retro   sneakers',
          description: messyDescription,
          marketplace: 'olx',
        },
      };

      const output = await provider.analyzeListingSeo(input, 'balanced');

      expect(output).toEqual({
        recommendations: [
          {
            field: 'title',
            proposedValue: 'Retro sneakers - Good condition',
            rationale: endsWithOfflineNotice,
          },
          {
            field: 'description',
            proposedValue: 'Classic retro sneakers. Lightly worn.\n\nNo box.',
            rationale: endsWithOfflineNotice,
          },
        ],
        disclaimer: 'Heuristic offline suggestion; Hermes was not consulted.',
      });
      expect(listingSeoOutputSchema.safeParse(output).success).toBe(true);
    });

    it('returns no recommendations when the heuristic changes nothing', async () => {
      const input: ListingSeoInput = {
        product: {
          id: 'p1',
          name: 'Retro sneakers - Good condition',
          description: 'Classic retro sneakers. Lightly worn.',
          category: 'clothing',
          condition: 'good',
          tags: ['retro'],
          imageCount: 3,
        },
        listing: null,
      };

      const output = await provider.analyzeListingSeo(input, 'precise');

      expect(output).toEqual({
        recommendations: [],
        disclaimer: 'Heuristic offline suggestion; Hermes was not consulted.',
      });
    });
  });
});
