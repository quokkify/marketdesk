// ProductAIDraftService prepares review-only product drafts. A draft must say whether
// Hermes produced it, and must not dress up fallback or heuristic output as Hermes
// output: no invented confidence, no placeholder description.

import { ProductAIDraftService } from '../ProductAIDraftService';
import type { Product } from '../../../domain/entities/Product';
import type {
  AIProviderSourceAware,
  IAIProvider,
  ListingAnalysis,
} from '../../../domain/ports/IAIProvider';
import { StubAIProvider, unwrap } from '../../../domain/testkit/support';

const OFFLINE_NOTICE = 'Heuristic offline suggestion; Hermes was not consulted.';
const HERMES_TITLE_NOTE =
  'Hermes provider generated the draft title and listing-quality notes for review.';
const FALLBACK_TITLE_NOTE =
  'Hermes provider was unavailable; deterministic fallback fields were prepared for review.';

// Reports its source like AIProviderSelector does. The source can change while the
// provider answers analyzeListing: an outage that starts in the middle of a draft.
class SourceAwareStub extends StubAIProvider implements AIProviderSourceAware {
  constructor(
    private source: 'hermes' | 'offline',
    title: string,
    analysis: ListingAnalysis,
    private readonly sourceAfterAnalysis: 'hermes' | 'offline' = source,
  ) {
    super(undefined, title, analysis);
  }

  async activeProvider(): Promise<'hermes' | 'offline'> {
    return this.source;
  }

  async analyzeListing(): Promise<ListingAnalysis> {
    const analysis = await super.analyzeListing();
    this.source = this.sourceAfterAnalysis;
    return analysis;
  }
}

const failingHermes: IAIProvider = {
  suggestPrice: async () => {
    throw new Error('Hermes AI is not reachable in this environment');
  },
  generateTitle: async () => {
    throw new Error('Hermes AI is not reachable in this environment');
  },
  analyzeListing: async () => {
    throw new Error('Hermes AI is not reachable in this environment');
  },
  analyzeListingSeo: async () => {
    throw new Error('Hermes AI is not reachable in this environment');
  },
};

const titleRequest = { mode: 'title' as const, title: 'Vintage Canon camera', workspaceId: 'w1' };
const photosRequest = {
  mode: 'photos' as const,
  imageUrls: ['https://example.test/camera.jpg'],
  workspaceId: 'w1',
};

describe('ProductAIDraftService', () => {
  it.each([
    { provider: 'a failing Hermes provider', ai: failingHermes },
    { provider: 'no provider', ai: undefined },
  ])('draft fallback has null confidence and heuristic source with $provider', async ({ ai }) => {
    const draft = unwrap(await new ProductAIDraftService(ai).generateDraft(titleRequest));

    expect(draft).toMatchObject({ source: 'offline', confidence: null });
    expect(draft.fields.name).toBe('Vintage Canon camera');
    expect(draft.notes[0]).toBe(FALLBACK_TITLE_NOTE);
  });

  it('labels a draft from the offline heuristics offline, with no confidence', async () => {
    const heuristics = new SourceAwareStub('offline', 'Vintage Canon camera - Good condition', {
      score: 80,
      suggestions: ['Add tags so buyers can find the product.'],
    });

    const draft = unwrap(await new ProductAIDraftService(heuristics).generateDraft(titleRequest));

    expect(draft).toMatchObject({ source: 'offline', confidence: null });
    expect(draft.fields.name).toBe('Vintage Canon camera - Good condition');
    expect(draft.notes).toEqual([
      OFFLINE_NOTICE,
      'Add tags so buyers can find the product.',
      'This is a review draft only; publishing still requires the normal confirmation flow.',
    ]);
  });

  it('keeps the Hermes source and its assessment as the confidence', async () => {
    const hermes = new SourceAwareStub('hermes', 'Canon AE-1 film camera', {
      score: 70,
      suggestions: ['Mention the lens.'],
    });

    const draft = unwrap(await new ProductAIDraftService(hermes).generateDraft(titleRequest));

    expect(draft).toMatchObject({ source: 'hermes', confidence: 0.7 });
    expect(draft.fields.name).toBe('Canon AE-1 film camera');
    expect(draft.notes[0]).toBe(HERMES_TITLE_NOTE);
  });

  it('labels the draft offline when Hermes goes offline while the draft is prepared', async () => {
    const switching = new SourceAwareStub(
      'hermes',
      'Canon AE-1 film camera',
      { score: 70, suggestions: [] },
      'offline',
    );

    const draft = unwrap(await new ProductAIDraftService(switching).generateDraft(titleRequest));

    expect(draft).toMatchObject({ source: 'offline', confidence: null });
    expect(draft.notes[0]).toBe(OFFLINE_NOTICE);
  });

  it('treats a provider that does not report its source as Hermes', async () => {
    const hermes = new StubAIProvider(undefined, 'Canon AE-1 film camera', {
      score: 60,
      suggestions: [],
    });

    const draft = unwrap(await new ProductAIDraftService(hermes).generateDraft(titleRequest));

    expect(draft).toMatchObject({ source: 'hermes', confidence: 0.6 });
  });

  it('writes no placeholder description and flags the description for review', async () => {
    const titleDraft = unwrap(await new ProductAIDraftService().generateDraft(titleRequest));
    const photosDraft = unwrap(await new ProductAIDraftService().generateDraft(photosRequest));

    for (const draft of [titleDraft, photosDraft]) {
      expect(draft.fields).not.toHaveProperty('description');
      expect(draft.uncertainFields).toContain('description');
    }
  });

  it('keeps the seller description and still flags it for review', async () => {
    const draft = unwrap(
      await new ProductAIDraftService().generateDraft({
        ...titleRequest,
        existingFields: { description: '  Working   camera with a 50 mm lens.  ' },
      }),
    );

    expect(draft.fields.description).toBe('Working camera with a 50 mm lens.');
    expect(draft.uncertainFields).toContain('description');
  });

  it('gives the provider the real, empty description instead of a placeholder', async () => {
    const hermes = new StubAIProvider(undefined, 'Canon AE-1 film camera');
    const analyzeListing = jest.spyOn(hermes, 'analyzeListing');

    await new ProductAIDraftService(hermes).generateDraft(titleRequest);

    const product = analyzeListing.mock.calls[0]?.[0] as Product | undefined;
    expect(product?.description).toBe('');
  });

  it('labels a photo draft fallback offline, with no confidence', async () => {
    const draft = unwrap(
      await new ProductAIDraftService(failingHermes).generateDraft(photosRequest),
    );

    expect(draft).toMatchObject({ mode: 'photos', source: 'offline', confidence: null });
    expect(draft.fields.images).toEqual(['https://example.test/camera.jpg']);
  });
});
