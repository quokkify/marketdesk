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
import { ServiceUnavailableError } from '../../../domain/shared/DomainError';
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

  it.each([
    { before: 'hermes', after: 'offline' },
    { before: 'offline', after: 'hermes' },
  ] as const)(
    'labels the draft offline when the source switches while the draft is prepared ($before, then $after)',
    async ({ before, after }) => {
      const switching = new SourceAwareStub(
        before,
        'Canon AE-1 film camera',
        { score: 70, suggestions: [] },
        after,
      );

      const draft = unwrap(await new ProductAIDraftService(switching).generateDraft(titleRequest));

      expect(draft).toMatchObject({ source: 'offline', confidence: null });
      expect(draft.notes[0]).toBe(OFFLINE_NOTICE);
    },
  );

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

    // The stub declares no parameters, so the recorded call is read as unknown arguments.
    const [product] = (analyzeListing.mock.calls[0] ?? []) as unknown as [Product?];
    expect(product?.description).toBe('');
  });

  it('labels a photo draft fallback offline, with no confidence', async () => {
    const draft = unwrap(
      await new ProductAIDraftService(failingHermes).generateDraft(photosRequest),
    );

    expect(draft).toMatchObject({ mode: 'photos', source: 'offline', confidence: null });
    expect(draft.fields.images).toEqual(['https://example.test/camera.jpg']);
  });

  // A cost of 0 would show the whole price as profit and a 100% margin on review.
  it.each([
    { draft: 'title', request: titleRequest },
    { draft: 'photos', request: photosRequest },
  ])('keeps an unknown cost null in a $draft draft', async ({ request }) => {
    const draft = unwrap(await new ProductAIDraftService().generateDraft(request));

    expect(draft.fields.costPrice).toBeNull();
  });

  it('keeps a cost the seller entered, zero included', async () => {
    for (const costPrice of [0, 42.5]) {
      const draft = unwrap(
        await new ProductAIDraftService().generateDraft({ ...titleRequest, existingFields: { costPrice } }),
      );

      expect(draft.fields.costPrice).toBe(costPrice);
    }
  });
});

describe('ProductAIDraftService provider failure log', () => {
  function failingWith(error: Error): IAIProvider {
    const fail = async (): Promise<never> => {
      throw error;
    };
    return {
      suggestPrice: fail,
      generateTitle: fail,
      analyzeListing: fail,
      analyzeListingSeo: fail,
    };
  }

  it('logs one warning that names the failure and its cause', async () => {
    const warn = jest.fn();
    const outage = new ServiceUnavailableError(
      'Hermes AI is not reachable in this environment',
      new Error('Hermes API request timed out after 30000ms'),
    );

    const draft = unwrap(
      await new ProductAIDraftService(failingWith(outage), { warn }).generateDraft(titleRequest),
    );

    expect(draft.notes[0]).toBe(FALLBACK_TITLE_NOTE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {
        error: {
          name: 'ServiceUnavailableError',
          message: 'Hermes AI is not reachable in this environment',
          cause: 'Error: Hermes API request timed out after 30000ms',
        },
      },
      'AI draft enrichment failed; the draft keeps only its deterministic fields',
    );
  });

  it('logs neither request data nor other properties of the error', async () => {
    const warn = jest.fn();
    const failure = Object.assign(new Error('Request failed with status 401'), {
      config: { headers: { Authorization: 'Bearer leaky-token' } },
    });

    await new ProductAIDraftService(failingWith(failure), { warn }).generateDraft({
      ...titleRequest,
      existingFields: { description: 'Serial number SN-0042 is on the base.' },
    });

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('Request failed with status 401');
    expect(logged).not.toContain('leaky-token');
    expect(logged).not.toContain('SN-0042');
  });

  it('logs nothing when the provider answers', async () => {
    const warn = jest.fn();

    await new ProductAIDraftService(new StubAIProvider(undefined, 'Canon AE-1'), { warn })
      .generateDraft(titleRequest);

    expect(warn).not.toHaveBeenCalled();
  });
});
