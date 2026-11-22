import { HermesDecisionEngine } from '../services/HermesDecisionEngine';
import { Product } from '../entities/Product';
import { Listing } from '../entities/Listing';
import { Workspace } from '../entities/Workspace';
import { HermesEvent } from '../entities/HermesEvent';
import type { HermesGuardrails, PriceComparable, PriceEstimate, PriceResearch } from '../../../shared/types';
import { PRICE_ESTIMATE_UNUSABLE_MESSAGE, type AIProviderSourceAware } from '../ports/IAIProvider';
import { ServiceUnavailableError } from '../shared/DomainError';
import {
  unwrap,
  money,
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryEventRepository,
  RecordingEventPublisher,
  StubAIProvider,
  InMemoryPriceResearchRepository,
  sequentialIdFactory,
} from '../testkit/support';
import type { ListingSeoOutput } from '../agents/MarketDeskAgentCatalog';

const OFFLINE_NOTICE = 'Heuristic offline suggestion; Hermes was not consulted.';

function makeEngine(overrides?: {
  productRepo?: InMemoryProductRepository;
  listingRepo?: InMemoryListingRepository;
  eventRepo?: InMemoryEventRepository;
  publisher?: RecordingEventPublisher;
  ai?: StubAIProvider;
  priceResearchRepo?: InMemoryPriceResearchRepository;
}) {
  const productRepo = overrides?.productRepo ?? new InMemoryProductRepository();
  const listingRepo = overrides?.listingRepo ?? new InMemoryListingRepository();
  const eventRepo = overrides?.eventRepo ?? new InMemoryEventRepository();
  const publisher = overrides?.publisher ?? new RecordingEventPublisher();
  const ai = overrides?.ai ?? new StubAIProvider();
  const engine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    eventRepo,
    publisher,
    ai,
    overrides?.priceResearchRepo ?? new InMemoryPriceResearchRepository(),
    null,
    sequentialIdFactory(),
  );
  return { engine, productRepo, listingRepo, eventRepo, publisher, ai };
}

describe('HermesDecisionEngine.determineAutonomy', () => {
  const { engine } = makeEngine();

  describe('suggest_only', () => {
    it('sends everything to pending_review', () => {
      expect(engine.determineAutonomy('suggest_only', 'create_listing', 'info')).toBe(
        'pending_review',
      );
      expect(
        engine.determineAutonomy('suggest_only', 'competitor_price_detected', 'critical'),
      ).toBe('pending_review');
    });
  });

  describe('full_auto', () => {
    it('auto-applies normal suggestions', () => {
      expect(engine.determineAutonomy('full_auto', 'suggested_better_title', 'info')).toBe(
        'auto_apply',
      );
      expect(engine.determineAutonomy('full_auto', 'suggested_lower_price', 'warning')).toBe(
        'auto_apply',
      );
    });

    it('still routes critical competitor price detections to review', () => {
      expect(
        engine.determineAutonomy('full_auto', 'competitor_price_detected', 'critical'),
      ).toBe('pending_review');
    });
  });

  describe('balanced', () => {
    it('auto-applies safe types only', () => {
      expect(engine.determineAutonomy('balanced', 'create_listing', 'info')).toBe(
        'auto_apply',
      );
      expect(engine.determineAutonomy('balanced', 'update_description', 'info')).toBe(
        'auto_apply',
      );
      expect(engine.determineAutonomy('balanced', 'relist', 'info')).toBe('auto_apply');
    });

    it('routes non-safe types to review', () => {
      expect(engine.determineAutonomy('balanced', 'suggested_lower_price', 'warning')).toBe(
        'pending_review',
      );
      expect(
        engine.determineAutonomy('balanced', 'competitor_price_detected', 'critical'),
      ).toBe('pending_review');
    });
  });
});

describe('HermesDecisionEngine.run', () => {
  function seedProduct(productRepo: InMemoryProductRepository, images: string[]): Product {
    const product = unwrap(
      Product.create({
        id: 'p1',
        workspaceId: 'w1',
        sku: 'SKU-1',
        name: 'Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(50),
        sellingPrice: money(80),
        condition: 'new',
        category: 'electronics',
        images,
      }),
    );
    productRepo.items.set(product.id, product);
    return product;
  }

  it('auto-applies a safe info suggestion under full_auto and persists events', async () => {
    const { engine, productRepo, eventRepo, publisher } = makeEngine();
    seedProduct(productRepo, []); // 0 images -> suggested_more_photos (info, null change)

    const workspace = unwrap(
      Workspace.create({ id: 'w1', name: 'WS', autonomyLevel: 'full_auto' }),
    );

    const events = await engine.run(workspace);

    const photoEvent = events.find((e) => e.type === 'suggested_more_photos');
    expect(photoEvent).toBeDefined();
    expect(photoEvent!.autonomyDecision).toBe('auto_apply');
    expect(photoEvent!.status).toBe('applied');
    expect(eventRepo.savedBatches.length).toBeGreaterThanOrEqual(3);
    expect(publisher.published.some((e) => e.type === 'hermes.run_completed')).toBe(true);
  });

  it('keeps suggestions pending under suggest_only', async () => {
    const { engine, productRepo } = makeEngine();
    seedProduct(productRepo, []);

    const workspace = unwrap(
      Workspace.create({ id: 'w1', name: 'WS', autonomyLevel: 'suggest_only' }),
    );

    const events = await engine.run(workspace);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.autonomyDecision).toBe('pending_review');
      expect(event.status).toBe('pending_review');
    }
  });

  it('suggests more photos without an invented statistic or a promise of sales', async () => {
    const { engine, productRepo } = makeEngine();
    seedProduct(productRepo, ['a.jpg']);

    const events = await engine.run(unwrap(Workspace.create({ id: 'w1', name: 'WS' })));

    expect(events.find((e) => e.type === 'suggested_more_photos')).toMatchObject({
      title: 'Add more photos',
      detail: 'Listings with three or more photos usually get more attention.',
    });
  });

  it('routes unsupported automatic relists to review before execution', async () => {
    const { engine, productRepo, listingRepo } = makeEngine();
    seedProduct(productRepo, ['a.jpg', 'b.jpg', 'c.jpg']);
    const listing = unwrap(
      Listing.create({
        id: 'l-expired',
        productId: 'p1',
        marketplaceId: 'm1',
        price: money(80),
        status: 'expired',
      }),
    );
    listingRepo.items.set(listing.id, listing);
    const workspace = unwrap(
      Workspace.create({ id: 'w1', name: 'WS', autonomyLevel: 'full_auto' }),
    );

    const events = await engine.run(workspace);
    const relist = events.find((event) => event.proposedChange?.kind === 'relist');
    expect(relist).toBeDefined();
    expect(relist?.status).toBe('pending_review');
    expect(relist?.autonomyDecision).toBe('pending_review');
  });

  describe('price floor', () => {
    async function priceProposals(suggestedPrice: number, minAcceptablePrice: number | null) {
      const ai = new StubAIProvider({ suggestedPrice, reasoning: 'stub', confidence: 'high' });
      const { engine, productRepo, listingRepo } = makeEngine({ ai });
      const product = unwrap(
        Product.create({
          id: 'p1',
          workspaceId: 'w1',
          sku: 'SKU-1',
          name: 'Widget',
          description: 'A perfectly reasonable description over twenty chars.',
          costPrice: money(50),
          sellingPrice: money(80),
          minAcceptablePrice: minAcceptablePrice === null ? null : money(minAcceptablePrice),
          condition: 'new',
          category: 'electronics',
          images: ['a.jpg', 'b.jpg', 'c.jpg'],
        }),
      );
      productRepo.items.set(product.id, product);
      const listing = unwrap(
        Listing.create({ id: 'l1', productId: 'p1', marketplaceId: 'm1', price: money(80) }),
      );
      listingRepo.items.set(listing.id, listing);
      const suggestions = await engine.checkConditions(product);
      return suggestions.filter((s) => s.change?.kind === 'price');
    }

    it('clamps a drop below the floor to exactly the floor', async () => {
      const proposals = await priceProposals(60, 70);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].change).toMatchObject({ kind: 'price', from: 80, to: 70 });
    });

    it('proposes no price change for a product already at its floor', async () => {
      expect(await priceProposals(60, 80)).toHaveLength(0);
    });

    it('clamps the estimate start price but keeps the floor price Hermes reported', async () => {
      const proposals = await priceProposals(60, 70);
      expect(proposals[0].change).toMatchObject({ estimate: { startPrice: 70, floorPrice: 60 } });
    });

    it('does not clamp a price increase', async () => {
      const proposals = await priceProposals(95, 70);
      expect(proposals[0].change).toMatchObject({ kind: 'price', to: 95 });
    });
  });

  describe('price estimate', () => {
    const research = {
      productId: 'p1',
      retailPrice: 469.99,
      retailCurrency: 'PLN',
      retailSource: 'MediaMarkt',
      retailCheckedAt: '2026-11-21',
      comparables: [{ price: 250, note: 'Szczecin, used half a year' }],
      specs: null, dismissedUrls: [], lastAttemptAt: null, lastEstimate: null,
      updatedAt: '2026-11-21T00:00:00.000Z',
    };

    async function runWithListingIn(currency: string) {
      const ai = new StubAIProvider();
      const estimatePrice = jest.spyOn(ai, 'estimatePrice');
      const priceResearchRepo = new InMemoryPriceResearchRepository();
      priceResearchRepo.items.set('w1:p1', research);
      const { engine, productRepo, listingRepo } = makeEngine({ ai, priceResearchRepo });
      seedProduct(productRepo, ['a.jpg', 'b.jpg', 'c.jpg']);
      const listing = unwrap(
        Listing.create({
          id: 'l1',
          productId: 'p1',
          marketplaceId: 'm1',
          price: money(80, currency),
        }),
      );
      listingRepo.items.set(listing.id, listing);
      await engine.run(unwrap(Workspace.create({ id: 'w1', name: 'WS' })));
      return estimatePrice;
    }

    it('gives the estimate the saved research when the retail currency matches the listing', async () => {
      const estimatePrice = await runWithListingIn('PLN');

      expect(estimatePrice).toHaveBeenCalledWith(
        expect.objectContaining({
          research: expect.objectContaining({ retailPrice: 469.99, retailCurrency: 'PLN' }),
        }),
      );
    });

    it('drops the retail anchor but keeps the comparables when its currency differs from the listing', async () => {
      const estimatePrice = await runWithListingIn('EUR');

      expect(estimatePrice).toHaveBeenCalledWith(
        expect.objectContaining({
          research: expect.objectContaining({
            retailPrice: null,
            retailCurrency: null,
            retailSource: null,
            retailCheckedAt: null,
            comparables: research.comparables,
          }),
        }),
      );
    });
  });
});

describe('HermesDecisionEngine guardrails (C1 / AMENDMENT FIX #5)', () => {
  const OPEN: HermesGuardrails = {
    maxAutoPriceChangePct: 50,
    minMarginFloor: 0,
    autoCreateListings: true,
    autoAdjustPricing: true,
    autoRelist: true,
    smartTitleAndSEO: true,
  };

  function makeWorkspace(guardrails: HermesGuardrails, level = 'full_auto' as const) {
    return unwrap(
      Workspace.create({
        id: 'w1',
        name: 'WS',
        autonomyLevel: level,
        guardrails,
      }),
    );
  }

  // Seeds a product (name matches the stub title so no title event fires) plus a
  // live listing, and an AI stub that suggests a modest 10% price drop with high
  // confidence — an actionable, <20% change that requiresHumanReview() ignores,
  // so the guardrail is the only thing that can force review.
  function seedPricingScenario(title = 'Widget') {
    const productRepo = new InMemoryProductRepository();
    const listingRepo = new InMemoryListingRepository();
    const eventRepo = new InMemoryEventRepository();
    const publisher = new RecordingEventPublisher();
    const ai = new StubAIProvider(
      { suggestedPrice: 90, reasoning: 'test', confidence: 'high' },
      title, // the default equals the product name -> no suggested_better_title event
    );
    const engine = new HermesDecisionEngine(
      productRepo,
      listingRepo,
      eventRepo,
      publisher,
      ai,
      new InMemoryPriceResearchRepository(),
      null,
      sequentialIdFactory('g'),
    );

    const product = unwrap(
      Product.create({
        id: 'p1',
        workspaceId: 'w1',
        sku: 'SKU-1',
        name: 'Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(50),
        sellingPrice: money(100),
        condition: 'new',
        category: 'electronics',
        images: ['a.jpg', 'b.jpg', 'c.jpg'], // >=3 -> no more-photos event
      }),
    );
    productRepo.items.set(product.id, product);

    const listing = unwrap(
      Listing.create({
        id: 'l1',
        productId: 'p1',
        marketplaceId: 'm1',
        price: money(100),
        status: 'live',
      }),
    );
    listingRepo.items.set(listing.id, listing);

    return { engine, product, productRepo, eventRepo };
  }

  function priceEvent(events: Awaited<ReturnType<HermesDecisionEngine['run']>>) {
    return events.find((e) => e.type === 'suggested_lower_price');
  }

  it('keeps a within-guardrail price from an estimate for review under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    const events = await engine.run(makeWorkspace(OPEN));
    const evt = priceEvent(events);
    expect(evt?.proposedChange).toMatchObject({ kind: 'price', to: 90, estimate: expect.any(Object) });
    expect(evt!.autonomyDecision).toBe('pending_review');
    expect(evt!.status).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('persists failed when automatic application throws', async () => {
    const { engine, productRepo, eventRepo } = seedPricingScenario('Widget Pro');
    jest.spyOn(productRepo, 'save').mockRejectedValueOnce(new Error('database unavailable'));

    const events = await engine.run(makeWorkspace(OPEN));
    expect(events.find((e) => e.type === 'suggested_better_title')?.status).toBe('failed');
    expect(eventRepo.savedBatches.length).toBeGreaterThanOrEqual(3);
  });

  it('passesGuardrails still gates a price change by its switch, maxAutoPriceChangePct and margin', () => {
    const { engine, product } = seedPricingScenario();
    const priceChange = unwrap(
      HermesEvent.create({
        id: 'pc1',
        workspaceId: 'w1',
        productId: 'p1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'lower price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      }),
    );
    expect(engine.passesGuardrails(product, priceChange, makeWorkspace(OPEN))).toBe(true);
    expect(
      engine.passesGuardrails(product, priceChange, makeWorkspace({ ...OPEN, autoAdjustPricing: false })),
    ).toBe(false);
    expect(
      engine.passesGuardrails(product, priceChange, makeWorkspace({ ...OPEN, maxAutoPriceChangePct: 5 })),
    ).toBe(false);
    expect(
      engine.passesGuardrails(product, priceChange, makeWorkspace({ ...OPEN, minMarginFloor: 60 })),
    ).toBe(false);
  });

  it('forces review when autoAdjustPricing is disabled, even under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    const events = await engine.run(makeWorkspace({ ...OPEN, autoAdjustPricing: false }));
    const evt = priceEvent(events);
    expect(evt!.autonomyDecision).toBe('pending_review');
    expect(evt!.status).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100); // unchanged — not applied
  });

  it('forces review when the change exceeds maxAutoPriceChangePct, even under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    // 10% drop exceeds a 5% cap.
    const events = await engine.run(makeWorkspace({ ...OPEN, maxAutoPriceChangePct: 5 }));
    const evt = priceEvent(events);
    expect(evt!.autonomyDecision).toBe('pending_review');
    expect(evt!.status).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('forces review when the new margin is below minMarginFloor, even under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    // to=90, cost=50 -> margin = (90-50)/90 ≈ 44%; floor of 60% is breached.
    const events = await engine.run(makeWorkspace({ ...OPEN, minMarginFloor: 60 }));
    const evt = priceEvent(events);
    expect(evt!.autonomyDecision).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('passesGuardrails honours per-action master switches', () => {
    const { engine, product } = seedPricingScenario();
    const ws = makeWorkspace({ ...OPEN, smartTitleAndSEO: false });
    const titleEvent = unwrap(
      HermesEvent.create({
        id: 't1',
        workspaceId: 'w1',
        productId: 'p1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'better title',
        proposedChange: { kind: 'title', field: 'title', from: 'Widget', to: 'Widget Pro' },
      }),
    );
    expect(engine.passesGuardrails(product, titleEvent, ws)).toBe(false);
  });

  // Reports its source like AIProviderSelector does, and switches source when it
  // answers generateTitle: an outage that starts or ends in the middle of a check.
  class SwitchingSourceStub extends StubAIProvider implements AIProviderSourceAware {
    constructor(
      private source: 'hermes' | 'offline',
      private readonly sourceAfterTitle: 'hermes' | 'offline',
    ) {
      super({ suggestedPrice: 90, reasoning: 'test', confidence: 'high' }, 'Widget - New');
    }

    async activeProvider(): Promise<'hermes' | 'offline'> {
      return this.source;
    }

    async generateTitle(): Promise<string> {
      const title = await super.generateTitle();
      this.source = this.sourceAfterTitle;
      return title;
    }
  }

  function seedSourceScenario(
    before: 'hermes' | 'offline',
    after: 'hermes' | 'offline',
    images = ['a.jpg', 'b.jpg', 'c.jpg'],
  ) {
    const productRepo = new InMemoryProductRepository();
    const listingRepo = new InMemoryListingRepository();
    const ai = new SwitchingSourceStub(before, after);
    const engine = new HermesDecisionEngine(
      productRepo,
      listingRepo,
      new InMemoryEventRepository(),
      new RecordingEventPublisher(),
      ai,
      new InMemoryPriceResearchRepository(),
      null,
      sequentialIdFactory('s'),
    );
    const product = unwrap(
      Product.create({
        id: 'p1',
        workspaceId: 'w1',
        sku: 'SKU-1',
        name: 'Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(50),
        sellingPrice: money(100),
        condition: 'new',
        category: 'electronics',
        images,
      }),
    );
    productRepo.items.set(product.id, product);
    const listing = unwrap(
      Listing.create({
        id: 'l1',
        productId: 'p1',
        marketplaceId: 'm1',
        price: money(100),
        status: 'live',
      }),
    );
    listingRepo.items.set(listing.id, listing);
    return { engine, product };
  }

  it.each([
    { before: 'offline', after: 'offline' },
    { before: 'hermes', after: 'offline' },
    { before: 'offline', after: 'hermes' },
  ] as const)(
    'full_auto workspace with smartTitleAndSEO on does not auto-apply an offline title ($before, then $after)',
    async ({ before, after }) => {
      const { engine, product } = seedSourceScenario(before, after);

      const events = await engine.run(makeWorkspace(OPEN));

      const titleEvent = events.find((e) => e.type === 'suggested_better_title');
      expect(titleEvent?.autonomyDecision).toBe('pending_review');
      expect(titleEvent?.status).toBe('pending_review');
      expect(product.name).toBe('Widget');
    },
  );

  it('full_auto workspace does not auto-apply an offline price change', async () => {
    const { engine, product } = seedSourceScenario('offline', 'offline');

    const events = await engine.run(makeWorkspace(OPEN));

    const evt = priceEvent(events);
    expect(evt?.autonomyDecision).toBe('pending_review');
    expect(evt?.status).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('still auto-applies a Hermes title under full_auto with smartTitleAndSEO on', async () => {
    const { engine, product } = seedSourceScenario('hermes', 'hermes');

    const events = await engine.run(makeWorkspace(OPEN));

    const titleEvent = events.find((e) => e.type === 'suggested_better_title');
    expect(titleEvent?.autonomyDecision).toBe('auto_apply');
    expect(titleEvent?.status).toBe('applied');
    expect(product.name).toBe('Widget - New');
  });

  it('leaves suggestions that no AI produced on the workspace autonomy level while offline', async () => {
    const { engine } = seedSourceScenario('offline', 'offline', ['a.jpg']);

    const events = await engine.run(makeWorkspace(OPEN));

    const photosEvent = events.find((e) => e.type === 'suggested_more_photos');
    expect(photosEvent?.autonomyDecision).toBe('auto_apply');
    expect(photosEvent?.status).toBe('applied');
  });

  it.each([
    { before: 'offline', after: 'offline' },
    { before: 'hermes', after: 'offline' },
    { before: 'offline', after: 'hermes' },
  ] as const)(
    'event produced with the offline provider has source offline and the notice in its detail ($before, then $after)',
    async ({ before, after }) => {
      const { engine } = seedSourceScenario(before, after);

      const events = await engine.run(makeWorkspace(OPEN));

      expect(events.find((e) => e.type === 'suggested_better_title')).toMatchObject({
        source: 'offline',
        detail: `Widget - New. ${OFFLINE_NOTICE}`,
      });
      expect(events.find((e) => e.type === 'suggested_lower_price')).toMatchObject({
        source: 'offline',
        detail: `test. ${OFFLINE_NOTICE}`,
      });
    },
  );

  it('labels events Hermes produced hermes and keeps their detail as Hermes wrote it', async () => {
    const { engine } = seedSourceScenario('hermes', 'hermes');

    const events = await engine.run(makeWorkspace(OPEN));

    expect(events.find((e) => e.type === 'suggested_better_title')).toMatchObject({
      source: 'hermes',
      detail: 'Widget - New',
    });
    expect(events.find((e) => e.type === 'suggested_lower_price')).toMatchObject({
      source: 'hermes',
      detail: 'test',
    });
  });

  it('labels events from a provider that does not report its source hermes', async () => {
    const { engine } = seedPricingScenario();

    const events = await engine.run(makeWorkspace(OPEN));

    expect(priceEvent(events)?.source).toBe('hermes');
  });

  it('gives suggestions that no AI produced no source and no offline notice', async () => {
    const { engine } = seedSourceScenario('offline', 'offline', ['a.jpg']);

    const events = await engine.run(makeWorkspace(OPEN));

    const photosEvent = events.find((e) => e.type === 'suggested_more_photos');
    expect(photosEvent?.source).toBeNull();
    expect(photosEvent?.detail).not.toContain(OFFLINE_NOTICE);
  });
});

describe('HermesDecisionEngine.runProductSeo provider source', () => {
  // Can switch source while it answers analyzeListingSeo: an outage mid-call.
  class SourceStub extends StubAIProvider implements AIProviderSourceAware {
    constructor(
      private source: 'hermes' | 'offline',
      seoOutput?: ListingSeoOutput,
      private readonly sourceAfterSeo: 'hermes' | 'offline' = source,
    ) {
      super(undefined, '', undefined, seoOutput);
    }

    async activeProvider(): Promise<'hermes' | 'offline'> {
      return this.source;
    }

    async analyzeListingSeo(): Promise<ListingSeoOutput> {
      const output = await super.analyzeListingSeo();
      this.source = this.sourceAfterSeo;
      return output;
    }
  }

  function setup(ai: StubAIProvider) {
    const productRepo = new InMemoryProductRepository();
    const eventRepo = new InMemoryEventRepository();
    const listingRepo = new InMemoryListingRepository();
    const engine = new HermesDecisionEngine(
      productRepo,
      listingRepo,
      eventRepo,
      new RecordingEventPublisher(),
      ai,
      new InMemoryPriceResearchRepository(),
      null,
      sequentialIdFactory('seo'),
    );
    const product = unwrap(
      Product.create({
        id: 'p1',
        workspaceId: 'w1',
        sku: 'SKU-1',
        name: 'Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(50),
        sellingPrice: money(100),
        condition: 'new',
        category: 'electronics',
      }),
    );
    productRepo.items.set(product.id, product);
    return {
      engine,
      eventRepo,
      listingRepo,
      workspace: unwrap(Workspace.create({ id: 'w1', name: 'WS' })),
    };
  }

  // Fingerprints, the source and the workspace and product ids are audit data. They stay in
  // the agent recommendation record and never reach the detail a seller reads.
  it('writes a listing SEO detail without fingerprints or ids and keeps them in the record', async () => {
    const { engine, eventRepo, workspace } = setup(new SourceStub('hermes'));

    const [event] = await engine.runProductSeo(workspace, 'p1');

    expect(event?.detail).toBe(
      'More searchable wording for review. Review-only suggestion from listing-seo@1.0.0 ' +
        '(balanced). This may improve discoverability but does not guarantee a sale.',
    );
    expect([...eventRepo.agentRecommendations.values()]).toEqual([
      expect.objectContaining({
        eventId: event?.id,
        workspaceId: 'w1',
        productId: 'p1',
        sourceFingerprint: expect.stringMatching(/\S/),
        recommendationFingerprint: expect.stringMatching(/\S/),
        outcome: 'suggested',
      }),
    ]);
  });

  it('keeps the saved SEO events when the price estimate is unavailable after the SEO answer', async () => {
    const ai = new SourceStub('hermes');
    jest
      .spyOn(ai, 'estimatePrice')
      .mockRejectedValue(new ServiceUnavailableError('Hermes is unavailable'));
    const { engine, eventRepo, listingRepo, workspace } = setup(ai);
    const listing = unwrap(
      Listing.create({ id: 'l1', productId: 'p1', marketplaceId: 'm1', price: money(100) }),
    );
    listingRepo.items.set(listing.id, listing);

    await expect(engine.runProductSeo(workspace, 'p1')).rejects.toThrow('Hermes is unavailable');

    expect([...eventRepo.agentRecommendations.values()]).toEqual([
      expect.objectContaining({ productId: 'p1', outcome: 'suggested' }),
    ]);
    expect([...eventRepo.items.values()]).toEqual([
      expect.objectContaining({ type: 'suggested_better_title' }),
    ]);
  });

  it('labels a listing SEO event from the offline heuristics offline and says so in its detail', async () => {
    const { engine, workspace } = setup(new SourceStub('offline'));

    const [event] = await engine.runProductSeo(workspace, 'p1');

    expect(event?.source).toBe('offline');
    expect(event?.detail).toContain(OFFLINE_NOTICE);
  });

  it.each([
    { before: 'hermes', after: 'offline' },
    { before: 'offline', after: 'hermes' },
  ] as const)(
    'labels listing SEO events offline when the source switches during the call ($before, then $after)',
    async ({ before, after }) => {
      const { engine, workspace } = setup(new SourceStub(before, undefined, after));

      const [event] = await engine.runProductSeo(workspace, 'p1');

      expect(event?.source).toBe('offline');
      expect(event?.detail).toContain(OFFLINE_NOTICE);
    },
  );

  it('labels a listing SEO event from Hermes hermes, with no offline notice', async () => {
    const { engine, workspace } = setup(new SourceStub('hermes'));

    const [event] = await engine.runProductSeo(workspace, 'p1');

    expect(event?.source).toBe('hermes');
    expect(event?.detail).not.toContain(OFFLINE_NOTICE);
  });

  it('does not repeat the offline notice that the heuristics already wrote', async () => {
    const { engine, workspace } = setup(
      new SourceStub('offline', {
        recommendations: [
          {
            field: 'title',
            proposedValue: 'Widget - New',
            rationale: `Added the condition "New". ${OFFLINE_NOTICE}`,
          },
        ],
        disclaimer: OFFLINE_NOTICE,
      }),
    );

    const [event] = await engine.runProductSeo(workspace, 'p1');

    expect(event?.detail?.split(OFFLINE_NOTICE)).toHaveLength(2);
  });
});

describe('HermesDecisionEngine.runProductSeo price estimate', () => {
  function estimate(overrides: Partial<PriceEstimate> = {}): PriceEstimate {
    return {
      startPrice: 90,
      floorPrice: 80,
      retailAnchor: null,
      usedRange: null,
      reasoning: 'Used units sell around 90.',
      confidence: 'medium',
      ...overrides,
    };
  }

  function research(overrides: Partial<PriceResearch> = {}): PriceResearch {
    return {
      productId: 'p1',
      retailPrice: 469.99,
      retailCurrency: 'PLN',
      retailSource: 'MediaMarkt',
      retailCheckedAt: '2026-11-21',
      comparables: [],
      specs: null, dismissedUrls: [], lastAttemptAt: null, lastEstimate: null,
      updatedAt: '2026-11-21T00:00:00.000Z',
      ...overrides,
    };
  }

  async function analyse(
    answer: PriceEstimate | Error,
    options: { price?: number; research?: PriceResearch } = {},
  ) {
    const price = options.price ?? 100;
    const productRepo = new InMemoryProductRepository();
    const listingRepo = new InMemoryListingRepository();
    const eventRepo = new InMemoryEventRepository();
    const priceResearchRepo = new InMemoryPriceResearchRepository();
    if (options.research) priceResearchRepo.items.set('w1:p1', options.research);
    const engine = new HermesDecisionEngine(
      productRepo,
      listingRepo,
      eventRepo,
      new RecordingEventPublisher(),
      new StubAIProvider(undefined, '', undefined, undefined, answer),
      priceResearchRepo,
      null,
      sequentialIdFactory('pe'),
    );
    const product = unwrap(
      Product.create({
        id: 'p1',
        workspaceId: 'w1',
        sku: 'SKU-1',
        name: 'Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(1),
        sellingPrice: money(price),
        condition: 'good',
        category: 'electronics',
      }),
    );
    productRepo.items.set(product.id, product);
    const listing = unwrap(
      Listing.create({ id: 'l1', productId: 'p1', marketplaceId: 'm1', price: money(price) }),
    );
    listingRepo.items.set(listing.id, listing);
    const events = await engine.runProductSeo(
      unwrap(Workspace.create({ id: 'w1', name: 'WS', autonomyLevel: 'full_auto' })),
      'p1',
    );
    const priceEvent = events.find((e) => e.proposedChange?.kind === 'price');
    const notice = events.find((e) => e.type === 'price_estimate_unavailable');
    return { events, priceEvent, notice, product, priceResearchRepo };
  }

  function estimateOf(event: HermesEvent | undefined): PriceEstimate | undefined {
    const change = event?.proposedChange;
    return change?.kind === 'price' ? change.estimate : undefined;
  }

  it('surfaces a medium-confidence estimate as a price event for review carrying the estimate', async () => {
    const { priceEvent, product } = await analyse(estimate());

    expect(priceEvent).toMatchObject({
      type: 'suggested_lower_price',
      status: 'pending_review',
      autonomyDecision: 'pending_review',
      proposedChange: { kind: 'price', from: 100, to: 90 },
    });
    expect(estimateOf(priceEvent)).toMatchObject({ startPrice: 90, floorPrice: 80, confidence: 'medium' });
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('proposes no price when the difference is under 5%', async () => {
    const { priceEvent, notice } = await analyse(estimate({ startPrice: 96 }));
    expect(priceEvent).toBeUndefined();
    expect(notice).toBeUndefined();
  });

  it('proposes no price for a low-confidence estimate', async () => {
    const { priceEvent, notice } = await analyse(estimate({ confidence: 'low' }));
    expect(priceEvent).toBeUndefined();
    expect(notice).toBeUndefined();
  });

  it.each([
    { start: 11.4, surfaced: true },
    { start: 12.6, surfaced: true },
    { start: 11.41, surfaced: false },
  ])('at a current price of 12 a start of $start is surfaced: $surfaced', async ({ start, surfaced }) => {
    const { priceEvent } = await analyse(estimate({ startPrice: start, floorPrice: 10 }), { price: 12 });
    expect(priceEvent !== undefined).toBe(surfaced);
  });

  it('turns an unusable answer into a price_estimate_unavailable notice', async () => {
    const { priceEvent, notice } = await analyse(new Error(PRICE_ESTIMATE_UNUSABLE_MESSAGE));
    expect(priceEvent).toBeUndefined();
    expect(notice).toMatchObject({ detail: PRICE_ESTIMATE_UNUSABLE_MESSAGE, proposedChange: null, source: null });
  });

  it.each([
    'Hermes completion returned a non-JSON success response: <html>raw body</html>',
    'Hermes completion is missing assistant content',
  ])('turns any other estimate failure into the notice with a fixed detail (%s)', async (message) => {
    const { events, notice } = await analyse(new Error(message));
    expect(notice?.detail).toBe(PRICE_ESTIMATE_UNUSABLE_MESSAGE);
    expect(events.find((e) => e.type === 'suggested_better_title')).toBeDefined();
  });

  it("rejects a start above the seller's retail price when the model returns no anchor", async () => {
    const { priceEvent, notice } = await analyse(estimate({ startPrice: 90, retailAnchor: null }), {
      research: research({ retailPrice: 85 }),
    });
    expect(priceEvent).toBeUndefined();
    expect(notice?.type).toBe('price_estimate_unavailable');
  });

  describe('figure labels', () => {
    it("labels the anchor observed when it is the seller's retail price, whatever the model said", async () => {
      const { priceEvent } = await analyse(
        estimate({ retailAnchor: { amount: 469.99, basis: 'estimated' } }),
        { research: research() },
      );
      expect(estimateOf(priceEvent)?.retailAnchor).toEqual({ amount: 469.99, basis: 'observed' });
    });

    it("labels an anchor that differs from the seller's retail price estimated", async () => {
      const { priceEvent } = await analyse(
        estimate({ retailAnchor: { amount: 449, basis: 'observed' } }),
        { research: research() },
      );
      expect(estimateOf(priceEvent)?.retailAnchor).toEqual({ amount: 449, basis: 'estimated' });
    });

    it('labels an anchor estimated when no retail price reached the provider', async () => {
      const { priceEvent } = await analyse(estimate({ retailAnchor: { amount: 469.99, basis: 'observed' } }));
      expect(estimateOf(priceEvent)?.retailAnchor?.basis).toBe('estimated');
    });

    it('labels an anchor estimated when the retail price was in another currency and was dropped', async () => {
      const { priceEvent } = await analyse(
        estimate({ retailAnchor: { amount: 469.99, basis: 'observed' } }),
        { research: research({ retailCurrency: 'EUR' }) },
      );
      expect(estimateOf(priceEvent)?.retailAnchor?.basis).toBe('estimated');
    });

    const comparables = [
      { price: 80, note: 'a' },
      { price: 120, note: 'b' },
    ];

    it('labels a used range within the comparables observed', async () => {
      const { priceEvent } = await analyse(
        estimate({ usedRange: { low: 80, high: 120, basis: 'estimated' } }),
        { research: research({ comparables }) },
      );
      expect(estimateOf(priceEvent)?.usedRange).toEqual({ low: 80, high: 120, basis: 'observed' });
    });

    it('labels a used range reaching outside the comparables estimated', async () => {
      const { priceEvent } = await analyse(
        estimate({ usedRange: { low: 75, high: 120, basis: 'observed' } }),
        { research: research({ comparables }) },
      );
      expect(estimateOf(priceEvent)?.usedRange?.basis).toBe('estimated');
    });

    it('labels a used range estimated when there are no comparables', async () => {
      const { priceEvent } = await analyse(
        estimate({ usedRange: { low: 80, high: 120, basis: 'observed' } }),
        { research: research({ comparables: [] }) },
      );
      expect(estimateOf(priceEvent)?.usedRange?.basis).toBe('estimated');
    });
  });

  describe('price anchor ladder', () => {
    const substitutes: PriceComparable[] = [280, 300, 320].map((price) => ({
      price,
      note: 'new substitute',
      source: 'auto',
      tier: 'substitute_new',
    }));

    it('caps the start price at 70 % of the new substitutes and keeps the estimate it made', async () => {
      const { priceEvent, priceResearchRepo } = await analyse(
        estimate({ startPrice: 299, floorPrice: 250, confidence: 'high' }),
        { price: 400, research: research({ retailPrice: null, retailCurrency: null, comparables: substitutes }) },
      );

      expect(estimateOf(priceEvent)).toMatchObject({ startPrice: 210, floorPrice: 210, confidence: 'medium' });
      const saved = priceResearchRepo.items.get('w1:p1')?.lastEstimate;
      expect(saved).toMatchObject({ hiddenReason: null, researchNote: null });
      expect(saved?.estimate.startPrice).toBe(210);
    });

    it('keeps the estimate with the reason it was hidden', async () => {
      const { priceEvent, priceResearchRepo } = await analyse(estimate({ confidence: 'low' }));

      expect(priceEvent).toBeUndefined();
      expect(priceResearchRepo.items.get('w1:p1')?.lastEstimate?.hiddenReason).toBe('low_confidence');
    });
  });
});
