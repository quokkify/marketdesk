import { OLXAdapter } from '../OLXAdapter';
import {
  MarketplaceHttpClient,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
} from '../MarketplaceHttpClient';
import { MarketplaceAuthenticationError, MarketplaceRateLimitError } from '../MarketplaceError';
import { appendSandboxBuyerMessage, resetSandboxConversations } from '../olxSandboxConversations';

const fastOptions = { sleep: async () => {}, maxRetries: 2, baseRetryDelayMs: 0 };

function fakeClient(handler: (config: HttpRequestConfig) => HttpResponse | Promise<HttpResponse>) {
  const request = jest.fn(handler);
  return { client: { request } as unknown as MarketplaceHttpClient, request };
}

describe('OLXAdapter thread reading', () => {
  it('lists threads from a bare array, preferring uuid over id and stringifying the buyer id', async () => {
    const { client, request } = fakeClient(async () => ({
      status: 200,
      data: [
        { uuid: 'thr-1', id: 5, advert_id: 'A1', interlocutor_id: 77 },
        { id: 6, advert_id: 'A1' },
        { uuid: 'other', advert_id: 'A2', interlocutor_id: 1 },
      ],
    }));
    const threads = await new OLXAdapter(client, fastOptions).listThreads('A1');
    expect(threads).toEqual([
      { externalThreadId: 'thr-1', externalBuyerId: '77' },
      { externalThreadId: '6', externalBuyerId: null },
    ]);
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'GET', query: { advert_id: 'A1', offset: 0 } });
  });

  it('lists threads from the { data } envelope and follows pagination', async () => {
    const { client, request } = fakeClient(async (config) => ({
      status: 200,
      data: config.query?.offset === 0
        ? { data: [{ uuid: 't1', advert_id: 7 }], links: { next: 'x' } }
        : { data: [{ uuid: 't2', advert_id: 7 }], links: { next: null } },
    }));
    const threads = await new OLXAdapter(client, fastOptions).listThreads('7');
    expect(threads.map((thread) => thread.externalThreadId)).toEqual(['t1', 't2']);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('maps message direction, skips unknown types and non-string text, and sorts oldest first', async () => {
    const { client, request } = fakeClient(async () => ({
      status: 200,
      data: {
        data: [
          { uuid: 'm2', type: 'sent', text: 'reply', created_at: '2026-11-20T10:05:00Z' },
          { id: 9, type: 'received', text: 'hello', created_at: '2026-11-20T10:00:00Z' },
          { uuid: 'm3', type: 'system', text: 'x', created_at: '2026-11-20T10:06:00Z' },
          { uuid: 'm4', type: 'received', text: null, created_at: '2026-11-20T10:07:00Z' },
        ],
      },
    }));
    const messages = await new OLXAdapter(client, fastOptions).listThreadMessages('thr 1');
    expect(messages).toEqual([
      { externalMessageId: '9', direction: 'buyer', text: 'hello', sentAt: new Date('2026-11-20T10:00:00Z') },
      { externalMessageId: 'm2', direction: 'seller', text: 'reply', sentAt: new Date('2026-11-20T10:05:00Z') },
    ]);
    expect(request.mock.calls[0][0].url).toMatch(/\/threads\/thr%201\/messages$/);
  });

  it('accepts a bare array of messages', async () => {
    const { client } = fakeClient(async () => ({
      status: 200,
      data: [{ uuid: 'm1', type: 'received', text: 'hi', created_at: '2026-11-20T10:00:00Z' }],
    }));
    expect(await new OLXAdapter(client, fastOptions).listThreadMessages('t')).toHaveLength(1);
  });

  it('never calls mark-as-read while reading', async () => {
    const { client, request } = fakeClient(async () => ({ status: 200, data: [] }));
    const adapter = new OLXAdapter(client, fastOptions);
    await adapter.listThreads('A1');
    await adapter.listThreadMessages('t');
    expect(request.mock.calls.every(([config]) => config.method === 'GET')).toBe(true);
  });

  it('maps provider failures to marketplace errors without message text', async () => {
    const { client } = fakeClient(async () => { throw new HttpError(401, 'nope'); });
    await expect(new OLXAdapter(client, fastOptions).listThreadMessages('t'))
      .rejects.toBeInstanceOf(MarketplaceAuthenticationError);
  });
});

describe('OLXAdapter sendThreadMessage', () => {
  it('posts only { text } and returns the id when the response carries one', async () => {
    const { client, request } = fakeClient(async () => ({ status: 200, data: { data: { uuid: 'new-1' } } }));
    const result = await new OLXAdapter(client, fastOptions).sendThreadMessage('thr-1', 'Hello there');
    expect(result).toEqual({ externalMessageId: 'new-1' });
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/\/threads\/thr-1\/messages$/),
      body: { text: 'Hello there' },
    });
  });

  it('returns a null id for an empty response', async () => {
    const { client } = fakeClient(async () => ({ status: 204, data: undefined as unknown }));
    expect(await new OLXAdapter(client, fastOptions).sendThreadMessage('t', 'x'))
      .toEqual({ externalMessageId: null });
  });

  it('does not retry a failed send and keeps the message text out of the error', async () => {
    const { client, request } = fakeClient(async () => { throw new HttpError(429, 'slow down'); });
    const error = await new OLXAdapter(client, fastOptions)
      .sendThreadMessage('t', 'secret buyer reply').catch((e) => e);
    expect(error).toBeInstanceOf(MarketplaceRateLimitError);
    expect(error.message).not.toContain('secret buyer reply');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('OLXAdapter sandbox stub conversations', () => {
  beforeEach(() => resetSandboxConversations());

  it('gives every advert three fixture threads with one buyer message each', async () => {
    const adapter = new OLXAdapter(undefined, fastOptions);
    const threads = await adapter.listThreads('adv-9');
    expect(threads.map((thread) => thread.externalThreadId)).toEqual([
      'sbx-adv-9-buyer', 'sbx-adv-9-haggle', 'sbx-adv-9-scam',
    ]);
    const texts = await Promise.all(threads.map(async (thread) =>
      (await adapter.listThreadMessages(thread.externalThreadId)).map((m) => [m.direction, m.text])));
    expect(texts).toEqual([
      [['buyer', 'Hi, is it still available?']],
      [['buyer', 'Would you take 50 zł?']],
      [['buyer', 'Paid via OLX delivery, confirm here: https://olx-dostawa.pl/odbierz']],
    ]);
  });

  it('keeps fixture timestamps stable across repeated reads', async () => {
    const adapter = new OLXAdapter(undefined, fastOptions);
    await adapter.listThreads('adv-1');
    const first = await adapter.listThreadMessages('sbx-adv-1-buyer');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await adapter.listThreads('adv-1');
    expect(await adapter.listThreadMessages('sbx-adv-1-buyer')).toEqual(first);
  });

  it('appends a sent message on send and a buyer message on the test helper', async () => {
    const adapter = new OLXAdapter(undefined, fastOptions);
    await adapter.listThreads('adv-2');
    const sent = await adapter.sendThreadMessage('sbx-adv-2-haggle', 'Sure, 60 zł');
    expect(sent).toEqual({ externalMessageId: 'sbx-msg-1' });
    appendSandboxBuyerMessage('sbx-adv-2-haggle', 'Deal');
    const messages = await adapter.listThreadMessages('sbx-adv-2-haggle');
    expect(messages.map((m) => [m.direction, m.text])).toEqual([
      ['buyer', 'Would you take 50 zł?'], ['seller', 'Sure, 60 zł'], ['buyer', 'Deal'],
    ]);
  });
});
