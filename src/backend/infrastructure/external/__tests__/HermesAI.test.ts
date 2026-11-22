import {
  HermesAI,
  AITextCompletionClient,
  AICompletionRequest,
  loadHermesConfig,
} from '../HermesAI';
import { Product } from '../../../domain/entities/Product';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { Money } from '../../../domain/valueObjects/Money';
import { SELLER_DATA_RULE, sellerDataBlock } from '../sellerData';

function money(amount: number): Money {
  const r = Money.of(amount, 'PLN');
  if (r.isErr()) throw r.error;
  return r.value;
}

function buildProduct(): Product {
  const r = Product.create({
    id: 'p1',
    workspaceId: 'w1',
    sku: 'SKU-1',
    name: 'Retro Sneakers',
    description: 'Classic retro sneakers, lightly worn, great condition overall.',
    costPrice: money(80),
    sellingPrice: money(120),
    condition: 'good',
    category: 'clothing',
    images: ['https://img/a.jpg'],
    tags: ['retro', 'sneakers'],
  });
  if (r.isErr()) throw r.error;
  return r.value;
}

function buildMarketplace(): Marketplace {
  const r = Marketplace.create({ id: 'm1', workspaceId: 'w1', key: 'olx', name: 'OLX' });
  if (r.isErr()) throw r.error;
  return r.value;
}

function fakeClient(reply: string | ((req: AICompletionRequest) => string)): {
  client: AITextCompletionClient;
  calls: AICompletionRequest[];
} {
  const calls: AICompletionRequest[] = [];
  const client: AITextCompletionClient = {
    complete: async (req) => {
      calls.push(req);
      return typeof reply === 'function' ? reply(req) : reply;
    },
  };
  return { client, calls };
}

function parseBlock(prompt: string): Record<string, unknown> {
  const match = /<seller_data>\n([\s\S]*)\n<\/seller_data>/.exec(prompt);
  if (!match) throw new Error('no seller_data block');
  return JSON.parse(match[1]);
}

describe('HermesAI (IAIProvider)', () => {
  it('generateTitle returns a cleaned single-line title and includes marketplace context', async () => {
    const { client, calls } = fakeClient('  "Retro Sneakers — Classic Lightly Worn"  ');
    const ai = new HermesAI(client);

    const title = await ai.generateTitle(buildProduct(), buildMarketplace());

    expect(title).toBe('Retro Sneakers — Classic Lightly Worn');
    expect(parseBlock(calls[0].prompt)).toMatchObject({
      name: 'Retro Sneakers',
      marketplace: 'OLX',
    });
    const outside = calls[0].prompt.replace(/<seller_data>[\s\S]*<\/seller_data>/, '');
    expect(outside).not.toContain('OLX');
    expect(outside).not.toContain('Retro Sneakers');
    expect(calls[0].system).toContain(SELLER_DATA_RULE);
  });

  it('generateTitle falls back to the product name on empty model output', async () => {
    const { client } = fakeClient('   ');
    const ai = new HermesAI(client);
    const title = await ai.generateTitle(buildProduct(), null);
    expect(title).toBe('Retro Sneakers');
  });

  it('analyzeListing sends seller fields only inside the data block', async () => {
    const { client, calls } = fakeClient(JSON.stringify({ score: 50, suggestions: [] }));
    const ai = new HermesAI(client);

    await ai.analyzeListing(buildProduct());

    const outside = calls[0].prompt.replace(/<seller_data>[\s\S]*<\/seller_data>/, '');
    expect(outside).not.toContain('Classic retro sneakers');
    expect(outside).not.toContain('Retro Sneakers');
    expect(outside).not.toContain('retro');
    expect(Object.keys(parseBlock(calls[0].prompt))).toEqual(
      expect.arrayContaining(['name', 'description', 'category', 'condition', 'tags', 'imageCount'])
    );
    expect(calls[0].system).toContain(SELLER_DATA_RULE);
  });

  it('analyzeListing clamps the score and returns string suggestions', async () => {
    const { client } = fakeClient(
      JSON.stringify({ score: 250, suggestions: ['Add more photos', 42, 'Improve title'] })
    );
    const ai = new HermesAI(client);

    const analysis = await ai.analyzeListing(buildProduct());

    expect(analysis.score).toBe(100); // clamped from 250
    expect(analysis.suggestions).toEqual(['Add more photos', 'Improve title']);
  });

  it('sends listing-seo only strict sanitized JSON and varies the safe preset instruction', async () => {
    const reply = JSON.stringify({
      recommendations: [
        {
          field: 'title',
          proposedValue: 'Retro Sneakers Classic',
          rationale: 'Clearer search terms.',
        },
      ],
      disclaimer: 'Review only; results are not guaranteed.',
    });
    const { client, calls } = fakeClient(reply);
    const ai = new HermesAI(client);
    const input = {
      product: {
        id: 'p1',
        name: 'Retro Sneakers',
        description: 'Classic lightly worn sneakers.',
        category: 'clothing',
        condition: 'good' as const,
        tags: ['retro'],
        imageCount: 1,
      },
      listing: null,
    };

    await ai.analyzeListingSeo(input, 'precise');
    await ai.analyzeListingSeo(input, 'creative');

    expect(calls[0].prompt).toBe(sellerDataBlock(input));
    expect(calls[0].system).toContain(SELLER_DATA_RULE);
    expect(calls[1].system).toContain(SELLER_DATA_RULE);
    expect(calls[0].system).not.toBe(calls[1].system);
    expect(calls[0]).not.toHaveProperty('temperature');
    expect(calls[0].prompt).not.toMatch(/token|credential|\/srv\//i);
    expect(calls[0].jsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('fails closed when listing-seo returns invalid output instead of fabricating success', async () => {
    const { client } = fakeClient(
      JSON.stringify({ recommendations: [], disclaimer: '', marketplaceMutation: 'publish' })
    );
    const ai = new HermesAI(client);

    await expect(
      ai.analyzeListingSeo(
        {
          product: {
            id: 'p1',
            name: 'Retro Sneakers',
            description: 'Classic lightly worn sneakers.',
            category: 'clothing',
            condition: 'good',
            tags: ['retro'],
            imageCount: 1,
          },
          listing: null,
        },
        'balanced'
      )
    ).rejects.toThrow('Hermes listing-seo output failed strict schema validation');
  });
});

describe('loadHermesConfig', () => {
  const original = process.env.HERMES_REQUEST_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) delete process.env.HERMES_REQUEST_TIMEOUT_MS;
    else process.env.HERMES_REQUEST_TIMEOUT_MS = original;
  });

  it('gives up on a Hermes request after 30 seconds by default', () => {
    delete process.env.HERMES_REQUEST_TIMEOUT_MS;

    expect(loadHermesConfig().timeoutMs).toBe(30000);
  });

  it('uses HERMES_REQUEST_TIMEOUT_MS when it is set', () => {
    process.env.HERMES_REQUEST_TIMEOUT_MS = '45000';

    expect(loadHermesConfig().timeoutMs).toBe(45000);
  });
});
