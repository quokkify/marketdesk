import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import {
  InMemoryListingRepository,
  InMemoryPriceResearchRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../domain/testkit/support';
import { ServiceUnavailableError, ValidationError } from '../../../domain/shared/DomainError';
import type { PriceComparable, PriceResearch } from '../../../../shared/types';
import type { AICompletionRequest, AITextCompletionClient } from '../../../infrastructure/external/HermesAI';
import type { ResearchNode } from '../../../infrastructure/external/priceResearchPrompts';
import type { AiCallRecord } from '../../ai/AiCallRecord';
import { recordAiCall } from '../../ai/aiUsageScope';
import { createResearchCallLimiter } from '../researchCallLimiter';
import {
  PriceResearchGraph,
  SEARCH_NEEDS_PLN,
  SEARCH_NOT_CONFIGURED,
  type ComparableResearchProfile,
  type NodeStatus,
} from '../PriceResearchGraph';

const WS = 'w1';
const PID = 'p1';
const NOW = new Date('2026-11-22T12:00:00.000Z');
const OWN_URL = 'https://www.olx.pl/d/oferta/aopen-qh11-moj-CID99-ID1own0.html';

const IDENT = {
  model: 'AOPEN QH11',
  specs: '720p native, 200 ANSI lumens, LED',
  classAttributes: [
    { name: 'native resolution', value: '1280x720', unit: null, match: 'equal' },
    { name: 'brightness', value: 200, unit: 'ANSI lumens', match: 'ratio' },
  ],
  successors: ['AOPEN QH15s'],
  sameClassModels: [],
};
const CLASS_720P = [
  { name: 'native resolution', value: '1280x720', unit: null, match: 'equal' },
  { name: 'brightness', value: 250, unit: 'ANSI lumens', match: 'ratio' },
];

const SAME_URL = 'https://www.olx.pl/d/oferta/aopen-qh11-uzywany-CID99-ID1same1.html';
const LAST_NEW_URL = 'https://ceneo.pl/123456';
const EXTRALINK_URL = 'https://x-kom.pl/p/extralink-smartlife-h1';
const BENQ_URL = 'https://mediamarkt.pl/benq-w600';
const MAGCUBIC_URL = 'https://www.olx.pl/d/oferta/magcubic-hy300-CID99-ID1mag1.html';

const TIER_ANSWERS: Record<Exclude<ResearchNode, 'identify'>, unknown[]> = {
  sameModelUsed: [{ tier: 'same_model_used', price: 150, currency: 'PLN', title: 'AOPEN QH11 used', url: SAME_URL }],
  lastNewPrice: [{ tier: 'last_new_price', price: 399, currency: 'PLN', title: 'Ceneo AOPEN QH11', url: LAST_NEW_URL }],
  substitutesNew: [
    { tier: 'substitute_new', price: 273, currency: 'PLN', title: 'Extralink H1, x-kom', url: EXTRALINK_URL, classAttributes: CLASS_720P },
    {
      tier: 'substitute_new', price: 590, currency: 'PLN', title: 'BenQ W600, MediaMarkt', url: BENQ_URL,
      classAttributes: [
        { name: 'native resolution', value: '1920x1080', unit: null, match: 'equal' },
        { name: 'brightness', value: 2500, unit: 'ANSI lumens', match: 'ratio' },
      ],
    },
  ],
  substitutesUsed: [
    { tier: 'substitute_used', price: 180, currency: 'PLN', title: 'Magcubic HY300 used', url: MAGCUBIC_URL, classAttributes: CLASS_720P },
  ],
};

type Handler = (request: AICompletionRequest) => Promise<string>;

function nodeOf(request: AICompletionRequest): ResearchNode {
  const match = /^Node: (\w+)\./.exec(request.prompt);
  if (!match) throw new Error('prompt names no node');
  return match[1] as ResearchNode;
}

class ScriptedResearchClient implements AITextCompletionClient {
  readonly calls: ResearchNode[] = [];
  readonly records: AiCallRecord[] = [];
  active = 0;
  peak = 0;
  constructor(private readonly handlers: Partial<Record<ResearchNode, Handler>> = {}) {}

  async complete(request: AICompletionRequest): Promise<string> {
    const node = nodeOf(request);
    this.calls.push(node);
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      recordAiCall({ record: (r) => this.records.push(r) }, {
        provider: 'hermes', model: null, promptTokens: null, completionTokens: null, totalTokens: null,
        latencyMs: 0, outcome: 'ok', httpStatus: 200, costStatus: 'unknown',
      });
      const handler = this.handlers[node];
      if (handler) return await handler(request);
      return node === 'identify'
        ? JSON.stringify(IDENT)
        : JSON.stringify({ anchors: TIER_ANSWERS[node] });
    } finally {
      this.active -= 1;
    }
  }
}

function profile(client: AITextCompletionClient, toolsets: () => string[] = () => ['web']): ComparableResearchProfile {
  return { client, checkProfile: async () => ({ reachable: true, enabledToolsets: toolsets() }) };
}

function setup(options: {
  client?: ScriptedResearchClient;
  profile?: ComparableResearchProfile | null;
  research?: InMemoryPriceResearchRepository;
  currency?: string;
  limit?: number;
} = {}) {
  const products = new InMemoryProductRepository();
  const listings = new InMemoryListingRepository();
  const research = options.research ?? new InMemoryPriceResearchRepository();
  const client = options.client ?? new ScriptedResearchClient();
  const product = unwrap(Product.create({
    id: PID, workspaceId: WS, sku: 'SKU-1', name: 'AOPEN QH11 projektor',
    description: 'Mini projector, the remote is missing, works fine.',
    costPrice: money(50), sellingPrice: money(200), condition: 'good', category: 'projectors',
    missingAccessories: 'pilot',
  }));
  products.items.set(product.id, product);
  const listing = unwrap(Listing.create({
    id: 'l1', productId: PID, marketplaceId: 'm1', price: money(200, options.currency ?? 'PLN'), externalUrl: OWN_URL,
  }));
  listings.items.set(listing.id, listing);
  const graph = new PriceResearchGraph({
    products, listings, research,
    profile: options.profile === undefined ? profile(client) : options.profile,
    limiter: createResearchCallLimiter(options.limit ?? 3),
    now: () => NOW,
  });
  const transitions: Array<[ResearchNode, NodeStatus]> = [];
  const run = (signal: AbortSignal = new AbortController().signal) => graph.run({
    workspaceId: WS, productId: PID, signal,
    onNode: async (node, status) => { transitions.push([node, status]); },
  });
  return { graph, research, client, run, transitions };
}

function stored(research: InMemoryPriceResearchRepository): PriceResearch | undefined {
  return research.items.get(`${WS}:${PID}`);
}

function autoRow(tier: PriceComparable['tier'], url: string, price: number): PriceComparable {
  return { price, note: `old ${tier}`, url, source: 'auto', tier, seenAt: '2026-11-01' };
}

function seed(research: InMemoryPriceResearchRepository, comparables: PriceComparable[], dismissedUrls: string[] = []): void {
  research.items.set(`${WS}:${PID}`, {
    productId: PID, retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null,
    comparables, specs: null, dismissedUrls, lastAttemptAt: null, lastEstimate: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
  });
}

describe('PriceResearchGraph', () => {
  it('stores class-checked rows of every tier and drops a substitute of another class', async () => {
    const s = setup();
    const result = await s.run();

    expect(result.outcome).toBe('ok');
    expect(result.failedTiers).toEqual([]);
    expect(result.errorCode).toBeNull();
    expect(result.rowsChanged).toBe(true);
    expect(Object.values(result.nodes).every((status) => status === 'done')).toBe(true);
    const saved = stored(s.research)!;
    expect(result.research).toEqual(saved);
    expect(saved.specs).toBe(IDENT.specs);
    expect(saved.comparables.map((row) => row.url)).toEqual(
      expect.arrayContaining([SAME_URL, LAST_NEW_URL, EXTRALINK_URL, MAGCUBIC_URL]),
    );
    expect(saved.comparables.some((row) => row.url === BENQ_URL)).toBe(false);
    expect(saved.comparables.find((row) => row.url === EXTRALINK_URL)).toMatchObject({
      tier: 'substitute_new', source: 'auto', classChecked: true, seenAt: '2026-11-22',
      classAttributes: CLASS_720P,
    });
    expect(s.transitions).toEqual(expect.arrayContaining([
      ['identify', 'running'], ['identify', 'done'], ['substitutesNew', 'running'], ['substitutesNew', 'done'],
    ]));
  });

  it('accounts every call under the research feature with an operation per node', async () => {
    const s = setup();
    await s.run();
    expect(s.client.records.map((r) => r.feature)).toEqual(Array(5).fill('research'));
    expect(s.client.records.map((r) => r.operation).sort()).toEqual([
      'research.identify', 'research.lastNewPrice', 'research.sameModelUsed',
      'research.substitutesNew', 'research.substitutesUsed',
    ]);
  });

  it('keeps no prompt input beyond the sanitized item fields', async () => {
    const prompts: string[] = [];
    const client = new ScriptedResearchClient({
      identify: async (request) => { prompts.push(request.system + request.prompt); return JSON.stringify(IDENT); },
    });
    await setup({ client }).run();
    expect(prompts[0]).not.toContain('pilot');
    expect(prompts[0]).not.toContain('remote is missing');
  });

  it('retries identify once and then succeeds', async () => {
    let attempts = 0;
    const client = new ScriptedResearchClient({
      identify: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('flaky');
        return JSON.stringify(IDENT);
      },
    });
    const s = setup({ client });
    const result = await s.run();
    expect(result.outcome).toBe('ok');
    expect(client.calls.filter((node) => node === 'identify')).toHaveLength(2);
  });

  it('fails without saving when identify fails twice', async () => {
    const client = new ScriptedResearchClient({ identify: async () => 'not json at all' });
    const s = setup({ client });
    const result = await s.run();
    expect(result.outcome).toBe('failed');
    expect(result.nodes.identify).toBe('failed');
    expect(result.errorCode).toBe('unusable_answer');
    expect(result.research).toBeNull();
    expect(client.calls).toEqual(['identify', 'identify']);
    expect(stored(s.research)).toBeUndefined();
  });

  it('saves the other tiers when one tier fails and leaves its stored rows untouched', async () => {
    const research = new InMemoryPriceResearchRepository();
    const oldUsed = autoRow('substitute_used', 'https://www.olx.pl/d/oferta/old-used-CID99-ID1old1.html', 170);
    const oldSame = autoRow('same_model_used', 'https://www.olx.pl/d/oferta/old-same-CID99-ID1old2.html', 140);
    seed(research, [oldSame, oldUsed]);
    const client = new ScriptedResearchClient({ substitutesUsed: async () => { throw new Error('tier down'); } });
    const s = setup({ client, research });

    const result = await s.run();

    expect(result.outcome).toBe('partial');
    expect(result.failedTiers).toEqual(['substitute_used']);
    expect(result.nodes.substitutesUsed).toBe('failed');
    const urls = stored(research)!.comparables.map((row) => row.url);
    expect(urls).toContain(oldUsed.url);
    expect(urls).not.toContain(oldSame.url);
    expect(urls).toContain(SAME_URL);
    expect(urls).not.toContain(MAGCUBIC_URL);
  });

  it('fails without saving when only lastNewPrice succeeds', async () => {
    const down = async (): Promise<string> => { throw new Error('tier down'); };
    const client = new ScriptedResearchClient({ sameModelUsed: down, substitutesNew: down, substitutesUsed: down });
    const s = setup({ client });
    const result = await s.run();
    expect(result.outcome).toBe('failed');
    expect(result.errorCode).toBe('no_substitutes');
    expect(result.failedTiers).toEqual(['same_model_used', 'substitute_new', 'substitute_used']);
    expect(stored(s.research)).toBeUndefined();
  });

  it('fails when every tier fails', async () => {
    const down = async (): Promise<string> => { throw new Error('tier down'); };
    const client = new ScriptedResearchClient({
      sameModelUsed: down, lastNewPrice: down, substitutesNew: down, substitutesUsed: down,
    });
    const result = await setup({ client }).run();
    expect(result.outcome).toBe('failed');
    expect(result.errorCode).toBe('all_tiers_failed');
  });

  it('checks the toolset before every call and fails the tier whose check finds it unsafe', async () => {
    const client = new ScriptedResearchClient();
    let checks = 0;
    const s = setup({
      client,
      profile: profile(client, () => { checks += 1; return checks === 2 ? ['web', 'terminal'] : ['web']; }),
    });
    const result = await s.run();
    expect(checks).toBe(5);
    expect(client.calls).toHaveLength(4);
    expect(result.failedTiers).toHaveLength(1);
    expect(Object.values(result.nodes).filter((status) => status === 'failed')).toHaveLength(1);
  });

  it('fails identify on an unsafe toolset without calling Hermes', async () => {
    const client = new ScriptedResearchClient();
    const s = setup({ client, profile: profile(client, () => ['web', 'terminal']) });
    const result = await s.run();
    expect(result.outcome).toBe('failed');
    expect(result.errorCode).toBe('unsafe_toolset');
    expect(client.calls).toEqual([]);
  });

  it('merges into the rows and dismissals read under the lock at save time', async () => {
    const manual: PriceComparable = { price: 199, note: 'seller manual row', source: 'manual' };
    class EditedDuringRun extends InMemoryPriceResearchRepository {
      override async saveLadderLocked(
        workspaceId: string,
        productId: string,
        apply: Parameters<InMemoryPriceResearchRepository['saveLadderLocked']>[2],
      ): Promise<PriceResearch | null> {
        seed(this, [manual], [EXTRALINK_URL]);
        return super.saveLadderLocked(workspaceId, productId, apply);
      }
    }
    const research = new EditedDuringRun();
    const s = setup({ research });
    const result = await s.run();
    expect(result.outcome).toBe('ok');
    const saved = stored(research)!;
    expect(saved.comparables[0]).toEqual(manual);
    expect(saved.comparables.map((row) => row.url)).not.toContain(EXTRALINK_URL);
    expect(saved.dismissedUrls).toEqual([EXTRALINK_URL]);
  });

  it('reports no change and writes nothing when the run finds the stored ladder again', async () => {
    const s = setup();
    await s.run();
    const first = stored(s.research)!;
    const again = await s.run();
    expect(again.outcome).toBe('ok');
    expect(again.rowsChanged).toBe(false);
    expect(stored(s.research)).toBe(first);
  });

  it('ends on the run budget with the outcome of the finished nodes', async () => {
    const controller = new AbortController();
    const never = (): Promise<string> => new Promise(() => undefined);
    const client = new ScriptedResearchClient({ lastNewPrice: never, substitutesUsed: never });
    const s = setup({ client });
    setTimeout(() => controller.abort(), 30);
    const result = await s.run(controller.signal);
    expect(result.outcome).toBe('partial');
    expect(result.nodes).toMatchObject({
      identify: 'done', sameModelUsed: 'done', substitutesNew: 'done',
      lastNewPrice: 'timeout', substitutesUsed: 'timeout',
    });
    expect(result.failedTiers).toEqual(['last_new_price', 'substitute_used']);
    expect(stored(s.research)!.comparables.map((row) => row.url)).toContain(EXTRALINK_URL);
  });

  it('marks every unfinished node timeout when the budget ends during identify', async () => {
    const controller = new AbortController();
    const client = new ScriptedResearchClient({ identify: () => new Promise(() => undefined) });
    const s = setup({ client });
    setTimeout(() => controller.abort(), 10);
    const result = await s.run(controller.signal);
    expect(result.outcome).toBe('failed');
    expect(result.errorCode).toBe('timeout');
    expect(Object.values(result.nodes)).toEqual(Array(5).fill('timeout'));
    expect(client.calls).toEqual(['identify']);
  });

  it('passes the run signal to every call', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const client = new ScriptedResearchClient({
      identify: async (request) => { signals.push(request.signal); return JSON.stringify(IDENT); },
    });
    const controller = new AbortController();
    await setup({ client }).run(controller.signal);
    expect(signals[0]).toBe(controller.signal);
  });

  it('never runs more client calls at once than the limiter allows', async () => {
    const slow = (node: Exclude<ResearchNode, 'identify'>) => async (): Promise<string> => {
      await new Promise((r) => setTimeout(r, 10));
      return JSON.stringify({ anchors: TIER_ANSWERS[node] });
    };
    const client = new ScriptedResearchClient({
      sameModelUsed: slow('sameModelUsed'), lastNewPrice: slow('lastNewPrice'),
      substitutesNew: slow('substitutesNew'), substitutesUsed: slow('substitutesUsed'),
    });
    const result = await setup({ client, limit: 3 }).run();
    expect(result.outcome).toBe('ok');
    expect(client.peak).toBe(3);
  });

  it('refuses before any call when search is not configured or the listing is not in PLN', async () => {
    await expect(setup({ profile: null }).run()).rejects.toThrow(new ServiceUnavailableError(SEARCH_NOT_CONFIGURED));
    const client = new ScriptedResearchClient();
    await expect(setup({ client, currency: 'EUR' }).run()).rejects.toThrow(new ValidationError(SEARCH_NEEDS_PLN));
    expect(client.calls).toEqual([]);
  });
});
