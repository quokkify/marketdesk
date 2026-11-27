import { Product } from '../../../../domain/entities/Product';
import { Listing } from '../../../../domain/entities/Listing';
import { Marketplace } from '../../../../domain/entities/Marketplace';
import { Workspace } from '../../../../domain/entities/Workspace';
import {
  InMemoryEventRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  sequentialIdFactory,
  unwrap,
} from '../../../../domain/testkit/support';
import type {
  CompletedVerdictFields,
  ISaleVerdictRepository,
} from '../../../../domain/repositories/interfaces/ISaleVerdictRepository';
import type { IMarketplaceAdapter } from '../../../../domain/services/MarketplaceAdapter';
import type { AdvertAttribute, OlxCategoryAttribute } from '../../../../domain/services/advertCompletenessRules';
import { liveOlxScope } from '../../../../domain/services/saleVerdictRules';
import type {
  MarketplaceCategoryMetadata,
  SaleVerdict,
  VerdictCheck,
  VerdictCheckName,
} from '../../../../../shared/types';
import type { AICompletionRequest } from '../../../../infrastructure/external/HermesAI';
import { InvalidStateError } from '../../../../domain/shared/DomainError';
import { AdvertFieldsService } from '../../AdvertFieldsService';
import { CategoryMismatchProposals } from '../../CategoryMismatchProposals';
import { SALE_VERDICT_GRAPH_VERSION, SaleVerdictGraph, type CheckGraph } from '../SaleVerdictGraph';
import { buildCategoryCheck } from '../categoryCheckGraph';
import { buildAttributesCheck } from '../attributesCheckGraph';
import { buildDeliveryCheck } from '../deliveryCheckGraph';

const WS = 'w1';
const PID = 'p1';
const NOW = new Date('2026-11-27T12:00:00.000Z');
const EARLIER = '2026-11-25T08:00:00.000Z';
const ALL: VerdictCheckName[] = ['info', 'price', 'photos', 'category', 'attributes', 'delivery'];
const ADVERT_URL = 'https://www.olx.pl/d/oferta/sluchawki-CID99-ID1.html';

const CATEGORY_ATTRIBUTES: OlxCategoryAttribute[] = [
  {
    code: 'state', label: 'Stan', required: true, multiple: false,
    values: [{ code: 'used', label: 'Używane' }, { code: 'new', label: 'Nowe' }],
  },
  {
    code: 'brand', label: 'Marka', required: false, multiple: false,
    values: [{ code: 'apple', label: 'Apple' }, { code: 'samsung', label: 'Samsung' }],
  },
  {
    code: 'type', label: 'Typ', required: false, multiple: false,
    values: [{ code: 'in_ear', label: 'Dokanałowe' }, { code: 'over_ear', label: 'Nauszne' }],
  },
  {
    code: 'delivery', label: 'Przesyłka', required: false, multiple: true,
    values: [
      { code: 'p-s-inpost', label: 'InPost Paczkomat® 24/7 S' },
      { code: 'p-s-dpd', label: 'DPD Kurier S' },
      { code: 'p-m-inpost', label: 'InPost Paczkomat® 24/7 M' },
      { code: 'p-m-dpd', label: 'DPD Kurier M' },
    ],
  },
];

const category = (id: string): MarketplaceCategoryMetadata => ({
  providerCategoryId: id, name: `Category ${id}`, path: ['Elektronika', `Category ${id}`], source: 'provider_taxonomy',
  confidence: 1, isLeaf: true, taxonomyVerifiedAt: EARLIER, taxonomyStaleAt: '2026-12-25T08:00:00.000Z',
});

class FakeOlxAdapter {
  categoryId = '1973';
  attributes: AdvertAttribute[] = [{ code: 'state', value: 'used' }];
  deliveryPackageIds: string[] = [];
  suggestions = ['1973'];
  // Attribute codes OLX silently drops from an update.
  dropOnUpdate = new Set<string>();
  // The next update fails before OLX applies it.
  failNextUpdate = false;
  // OLX holds another title or price than MarketDesk would send.
  drifted = false;
  readonly reads: Array<{ title: string; price: number }> = [];
  readonly updates: Array<{ attributes?: AdvertAttribute[]; deliveryPackageIds?: string[] }> = [];

  async categorySuggestions(): Promise<string[]> {
    return this.suggestions;
  }
  async categoryAttributes(): Promise<OlxCategoryAttribute[]> {
    return CATEGORY_ATTRIBUTES;
  }
  async advertFields(_externalListingId: string, sent: { title: string; price: number }) {
    this.reads.push(sent);
    return {
      categoryId: this.categoryId,
      attributes: this.attributes.map((a) => ({ ...a })),
      deliveryPackageIds: [...this.deliveryPackageIds],
      drifted: this.drifted,
    };
  }
  async updateAdvertFields(
    _externalListingId: string,
    _current: unknown,
    fields: { attributes?: AdvertAttribute[]; deliveryPackageIds?: string[] },
  ): Promise<void> {
    this.updates.push(fields);
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('OLX update failed');
    }
    for (const attribute of fields.attributes ?? []) {
      if (this.dropOnUpdate.has(attribute.code)) continue;
      this.attributes = [...this.attributes.filter((a) => a.code !== attribute.code), attribute];
    }
  }
}

// Answers the parcel size prompt and the attribute prompt from fixed strings.
class FakeHermes {
  readonly prompts: string[] = [];
  constructor(private readonly answers: { size?: string; attributes?: string }) {}
  async complete(request: AICompletionRequest): Promise<string> {
    this.prompts.push(request.prompt);
    return request.prompt.includes('parcel size') ? (this.answers.size ?? '{}') : (this.answers.attributes ?? '{}');
  }
}

// Only what the graph uses.
function verdictRepository(previous: SaleVerdict | null) {
  const rows: SaleVerdict[] = previous ? [previous] : [];
  const repo = {
    rows,
    async setListing(): Promise<void> {},
    async complete(runId: string, fields: CompletedVerdictFields): Promise<boolean> {
      rows.push({
        id: runId, productId: PID, listingId: 'l1', graphVersion: SALE_VERDICT_GRAPH_VERSION, scope: ALL,
        status: 'completed', overall: fields.overall, checks: fields.checks, researchRunId: null, errorCode: null,
        createdAt: fields.completedAt, completedAt: fields.completedAt,
      });
      return true;
    },
    async findById(_workspaceId: string, runId: string): Promise<SaleVerdict | null> {
      return rows.find((row) => row.id === runId) ?? null;
    },
    async findLatestCompleted(): Promise<SaleVerdict | null> {
      return rows[rows.length - 1] ?? null;
    },
  };
  return repo;
}

function setup(opts: {
  live?: boolean;
  mode?: string | null;
  hermes?: FakeHermes | null;
  previous?: SaleVerdict | null;
  // The OLX category stored on the listing at its last sync.
  storedCategoryId?: string;
} = {}) {
  const products = new InMemoryProductRepository();
  products.items.set(PID, unwrap(Product.create({
    id: PID, workspaceId: WS, sku: 'SKU-1', name: 'Słuchawki Apple AirPods 4',
    description: 'Bezprzewodowe słuchawki, komplet z etui.', costPrice: money(200), sellingPrice: money(400),
    condition: 'good', category: 'headphones',
  })));
  const listings = new InMemoryListingRepository();
  listings.items.set('l1', unwrap(Listing.create({
    id: 'l1', productId: PID, marketplaceId: 'm1', price: money(400),
    status: opts.live === false ? 'draft' : 'live', marketplaceListingId: 'ext-1', externalUrl: ADVERT_URL,
    marketplaceCategory: opts.storedCategoryId ? category(opts.storedCategoryId) : null,
  })));
  const marketplaces = new InMemoryMarketplaceRepository();
  marketplaces.items.set('m1', unwrap(Marketplace.create({ id: 'm1', workspaceId: WS, key: 'olx', name: 'OLX', connected: true })));
  const workspace = unwrap(Workspace.create({ id: WS, name: 'Shop' }));
  const events = new InMemoryEventRepository();
  const adapter = new FakeOlxAdapter();
  const resolve = jest.fn(async () => adapter as unknown as IMarketplaceAdapter);
  const adapters = { resolve };
  const idFactory = sequentialIdFactory('evt');
  const hermes = opts.hermes === undefined ? null : opts.hermes;
  const pageCalls: string[] = [];
  const page = {
    deliveryMode: async (url: string) => {
      pageCalls.push(url);
      return opts.mode === undefined ? 'BuyWithDelivery' : opts.mode;
    },
  };
  const correctionOperations = { createPair: jest.fn(async () => undefined) };
  const proposals = new CategoryMismatchProposals(idFactory, {
    eventRepo: events,
    correctionOperations: correctionOperations as never,
    accounts: { findByMarketplaceId: async () => ({ id: 'acc-1', revision: 1, status: 'connected' }) as never },
  });
  const verdicts = verdictRepository(opts.previous ?? null);
  const ready = (name: VerdictCheckName): CheckGraph => async (ctx) => ({
    check: name, status: 'ready', reasons: [], checkedAt: ctx.now().toISOString(), refs: { eventIds: [] },
  });
  const graph = new SaleVerdictGraph({
    products,
    listings,
    marketplaces,
    workspaces: { findById: async (id: string) => (id === WS ? workspace : null) },
    verdicts: verdicts as unknown as ISaleVerdictRepository,
    adapters,
    checks: {
      info: ready('info'),
      price: ready('price'),
      photos: ready('photos'),
      category: buildCategoryCheck({
        proposals,
        events,
        taxonomy: async () => ({ verify: async (id: string) => category(id) }),
      }),
      attributes: buildAttributesCheck({
        fields: new AdvertFieldsService({ products, listings, marketplaces, adapters }),
        events,
        hermes,
        idFactory,
      }),
      delivery: buildDeliveryCheck({ page, events, hermes, idFactory }),
    },
    now: () => NOW,
  });
  let runs = 0;
  const run = (scope: VerdictCheckName[] = ALL) =>
    graph.run({ workspaceId: WS, productId: PID, runId: `run-${++runs}`, scope, signal: new AbortController().signal });
  const eventsOfType = (type: string) => [...events.items.values()].filter((event) => event.type === type);
  const fields = new AdvertFieldsService({ products, listings, marketplaces, adapters });
  return { run, adapter, events, eventsOfType, pageCalls, resolve, fields };
}

describe('advert completeness checks in the sale verdict', () => {
  it('fixes a category mismatch first and leaves attributes and delivery to wait for it', async () => {
    const { run, adapter, eventsOfType } = setup();
    adapter.suggestions = ['2000'];

    const verdict = await run();

    expect(verdict.checks.category).toMatchObject({ status: 'fix', reasons: [{ code: 'category_mismatch' }] });
    expect(eventsOfType('olx_category_mismatch')).toHaveLength(1);
    expect(verdict.checks.category?.refs.eventIds).toEqual([eventsOfType('olx_category_mismatch')[0]!.id]);
    expect(verdict.checks.attributes).toMatchObject({ status: 'needs_human', reasons: [{ code: 'category_first' }] });
    expect(verdict.checks.delivery).toMatchObject({ status: 'needs_human', reasons: [{ code: 'category_first' }] });
    expect(adapter.updates).toEqual([]);
  });

  it('writes a value found in the title and records it as an applied event', async () => {
    const { run, adapter, eventsOfType } = setup();

    const verdict = await run();

    expect(adapter.updates).toEqual([{ attributes: [{ code: 'brand', value: 'apple' }] }]);
    const filled = eventsOfType('filled_advert_attributes');
    expect(filled).toHaveLength(1);
    expect(filled[0]).toMatchObject({
      status: 'applied',
      autonomyDecision: 'auto_apply',
      source: null,
      title: 'Filled Marka: Apple (found in the title)',
    });
    expect(verdict.checks.category?.status).toBe('ready');
    expect(verdict.checks.attributes).toMatchObject({ status: 'ready' });
    expect(verdict.checks.attributes?.refs.missingAttributes).toEqual(['type']);
    expect(verdict.checks.attributes?.refs.eventIds).toEqual([filled[0]!.id]);
  });

  it('writes the same values once even when a second run still sees them empty', async () => {
    const { run, adapter, eventsOfType } = setup();

    await run();
    // OLX still serves the old advert to the second run.
    adapter.attributes = [{ code: 'state', value: 'used' }];
    await run();

    expect(adapter.updates).toHaveLength(1);
    expect(eventsOfType('filled_advert_attributes')).toHaveLength(1);
  });

  it('reports a value OLX dropped and does not count it as filled', async () => {
    const { run, adapter } = setup();
    adapter.dropOnUpdate.add('brand');

    const verdict = await run();

    expect(adapter.updates).toHaveLength(1);
    expect(verdict.checks.attributes?.reasons).toContainEqual({ code: 'attribute_dropped', message: 'OLX did not keep Marka' });
    expect(verdict.checks.attributes?.refs.missingAttributes).toContain('brand');
  });

  it('asks a human when the advert page cannot be read', async () => {
    const { run, pageCalls } = setup({ mode: null });

    const verdict = await run();

    expect(pageCalls).toEqual([ADVERT_URL]);
    expect(verdict.checks.delivery).toMatchObject({ status: 'needs_human', reasons: [{ code: 'probe_failed' }] });
  });

  it('proposes every package of the parcel size Hermes picked', async () => {
    const hermes = new FakeHermes({ size: '{"size": "M"}', attributes: '{"values": {"type": null}}' });
    const { run, eventsOfType } = setup({ mode: 'NotEligible', hermes });

    const verdict = await run();

    const proposed = eventsOfType('suggested_delivery');
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ status: 'pending_review', autonomyDecision: 'pending_review', source: 'hermes' });
    expect(proposed[0]!.proposedChange).toEqual({
      kind: 'delivery', listingId: 'l1', size: 'M', packageIds: ['p-m-inpost', 'p-m-dpd'],
    });
    expect(verdict.checks.delivery).toMatchObject({ status: 'fix', reasons: [{ code: 'delivery_off' }] });
    expect(verdict.checks.delivery?.refs.eventIds).toEqual([proposed[0]!.id]);
  });

  it('leaves the three checks out without a live OLX listing and drops their stored results', async () => {
    const stored = (name: VerdictCheckName, status: VerdictCheck['status']): VerdictCheck => ({
      check: name, status, reasons: [], checkedAt: EARLIER, refs: { eventIds: [] },
    });
    const previous: SaleVerdict = {
      id: 'run-0', productId: PID, listingId: 'l1', graphVersion: SALE_VERDICT_GRAPH_VERSION, scope: ALL,
      status: 'completed', overall: 'fix', researchRunId: null, errorCode: null,
      checks: {
        info: stored('info', 'ready'),
        price: stored('price', 'ready'),
        photos: stored('photos', 'ready'),
        delivery: stored('delivery', 'fix'),
      },
      createdAt: EARLIER, completedAt: EARLIER,
    };
    const { run, adapter, pageCalls } = setup({ live: false, previous });

    const verdict = await run();

    expect(liveOlxScope(ALL, false)).toEqual(['info', 'price', 'photos']);
    expect(Object.keys(verdict.checks).sort()).toEqual(['info', 'photos', 'price']);
    expect(verdict.overall).toBe('ready');
    expect(adapter.updates).toEqual([]);
    expect(pageCalls).toEqual([]);
  });

  // Regression guard: an empty suggestion list read as a mismatch and raised a critical recreation recommendation.
  it('asks a human about the category when OLX gives no suggestion, and lets the other checks run', async () => {
    const { run, adapter, eventsOfType } = setup();
    adapter.suggestions = [];

    const verdict = await run();

    expect(verdict.checks.category).toMatchObject({
      status: 'needs_human',
      reasons: [{ code: 'category_unknown', message: 'OLX gave no category suggestion for this title' }],
      refs: { eventIds: [] },
    });
    expect(eventsOfType('olx_category_mismatch')).toEqual([]);
    expect(verdict.checks.attributes?.status).toBe('ready');
    expect(adapter.updates).toEqual([{ attributes: [{ code: 'brand', value: 'apple' }] }]);
    expect(verdict.checks.delivery?.status).toBe('ready');
  });

  // Regression guard: the stored category was judged although OLX had moved the advert to another one.
  it('stops all three checks when the stored category differs from the one on OLX', async () => {
    const hermes = new FakeHermes({ size: '{"size": "M"}', attributes: '{"values": {"type": "in_ear"}}' });
    const { run, adapter, events, pageCalls } = setup({ storedCategoryId: '2000', mode: 'NotEligible', hermes });
    adapter.suggestions = ['2000'];

    const verdict = await run();

    const outOfSync = {
      status: 'needs_human',
      reasons: [{ code: 'category_out_of_sync', message: 'The OLX category changed since the last sync; sync the listing first' }],
    };
    expect(verdict.checks.category).toMatchObject(outOfSync);
    expect(verdict.checks.attributes).toMatchObject(outOfSync);
    expect(verdict.checks.delivery).toMatchObject(outOfSync);
    expect(events.items.size).toBe(0);
    expect(adapter.updates).toEqual([]);
    expect(pageCalls).toEqual([]);
    expect(hermes.prompts).toEqual([]);
  });

  it('judges the OLX category when the stored one matches it', async () => {
    const { run, adapter } = setup({ storedCategoryId: '1973' });

    const verdict = await run();

    expect(verdict.checks.category?.status).toBe('ready');
    expect(adapter.updates).toHaveLength(1);
  });

  // Regression guard: the auto-fill PUT replayed MarketDesk's title and price over the ones the seller changed on OLX.
  it('writes nothing and proposes nothing on an advert that drifted on OLX', async () => {
    const hermes = new FakeHermes({ size: '{"size": "M"}', attributes: '{"values": {"type": "in_ear"}}' });
    const { run, adapter, events } = setup({ mode: 'NotEligible', hermes });
    adapter.drifted = true;

    const verdict = await run();

    const drifted = {
      status: 'needs_human',
      reasons: [{ code: 'advert_drifted', message: 'The advert changed on OLX since the last sync; sync the listing first' }],
    };
    expect(verdict.checks.attributes).toMatchObject(drifted);
    expect(verdict.checks.delivery).toMatchObject(drifted);
    expect(adapter.reads[0]).toEqual({ title: 'Słuchawki Apple AirPods 4', price: 400 });
    expect(adapter.updates).toEqual([]);
    expect(events.items.size).toBe(0);
    expect(hermes.prompts).toEqual([]);
  });

  it('refuses an advert field write on a drifted advert with a clear message', async () => {
    const { adapter, fields } = setup();
    adapter.drifted = true;

    const error = await fields.apply(WS, 'l1', { deliveryPackageIds: ['p-m-inpost'] }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidStateError);
    expect((error as Error).message).toBe('The advert changed on OLX since the last sync; sync the listing first');
    expect(adapter.updates).toEqual([]);
  });

  describe('across runs', () => {
    it('accepts a category whose mismatch recommendation the owner dismissed', async () => {
      const { run, adapter, eventsOfType } = setup();
      adapter.suggestions = ['2000'];
      await run();
      unwrap(eventsOfType('olx_category_mismatch')[0]!.dismiss(NOW));

      const verdict = await run();

      expect(verdict.checks.category).toMatchObject({
        status: 'ready',
        reasons: [{ code: 'category_kept_by_owner', message: 'You kept this OLX category' }],
      });
      expect(eventsOfType('olx_category_mismatch')).toHaveLength(1);
      expect(verdict.checks.attributes?.status).toBe('ready');
      expect(adapter.updates).toHaveLength(1);
      expect(verdict.checks.delivery?.status).toBe('ready');
    });

    const resetAdvert = (adapter: FakeOlxAdapter) => {
      adapter.attributes = [{ code: 'state', value: 'used' }];
    };

    it('links the open category recommendation on a repeat mismatch', async () => {
      const { run, adapter, eventsOfType } = setup();
      adapter.suggestions = ['2000'];

      await run();
      const verdict = await run();

      const raised = eventsOfType('olx_category_mismatch');
      expect(raised).toHaveLength(1);
      expect(verdict.checks.category?.refs.eventIds).toEqual([raised[0]!.id]);
    });

    it('retries a failed keyed write on its own event and marks it applied', async () => {
      const { run, adapter, eventsOfType } = setup();
      adapter.failNextUpdate = true;

      const first = await run();
      expect(first.checks.attributes).toMatchObject({ status: 'needs_human', reasons: [{ code: 'check_failed' }] });
      expect(eventsOfType('filled_advert_attributes')[0]?.status).toBe('failed');

      const second = await run();

      const filled = eventsOfType('filled_advert_attributes');
      expect(filled).toHaveLength(1);
      expect(filled[0]!.status).toBe('applied');
      expect(adapter.updates).toHaveLength(2);
      expect(adapter.attributes).toContainEqual({ code: 'brand', value: 'apple' });
      expect(second.checks.attributes?.refs.eventIds).toEqual([filled[0]!.id]);
    });

    it('does not rewrite values an applied keyed event already wrote, and links it', async () => {
      const { run, adapter, eventsOfType } = setup();

      await run();
      resetAdvert(adapter);
      const verdict = await run();

      const filled = eventsOfType('filled_advert_attributes');
      expect(adapter.updates).toHaveLength(1);
      expect(verdict.checks.attributes?.refs.eventIds).toEqual([filled[0]!.id]);
    });

    it('keeps a pending attributes proposal without asking Hermes again', async () => {
      const hermes = new FakeHermes({ attributes: '{"values": {"type": "in_ear"}}' });
      const { run, eventsOfType } = setup({ hermes });

      await run();
      const verdict = await run();

      const proposed = eventsOfType('suggested_advert_attributes');
      expect(proposed).toHaveLength(1);
      expect(proposed[0]!.status).toBe('pending_review');
      expect(hermes.prompts).toHaveLength(1);
      expect(verdict.checks.attributes).toMatchObject({ status: 'fix', reasons: [{ code: 'attributes_proposed' }] });
      expect(verdict.checks.attributes?.refs.eventIds).toEqual([proposed[0]!.id]);
    });

    it('keeps a pending delivery proposal without asking Hermes again', async () => {
      const hermes = new FakeHermes({ size: '{"size": "M"}', attributes: '{"values": {"type": null}}' });
      const { run, eventsOfType } = setup({ mode: 'NotEligible', hermes });

      await run();
      const verdict = await run();

      const proposed = eventsOfType('suggested_delivery');
      expect(proposed).toHaveLength(1);
      expect(proposed[0]!.status).toBe('pending_review');
      expect(hermes.prompts.filter((prompt) => prompt.includes('parcel size'))).toHaveLength(1);
      expect(verdict.checks.delivery?.refs.eventIds).toEqual([proposed[0]!.id]);
    });

    it('never resolves the OLX adapter for a run without an advert check', async () => {
      const { run, resolve } = setup();

      await run(['price']);

      expect(resolve).not.toHaveBeenCalled();
    });
  });
});
