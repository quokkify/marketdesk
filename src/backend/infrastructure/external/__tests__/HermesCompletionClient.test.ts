import { HermesCompletionClient } from '../HermesCompletionClient';
import { ServiceUnavailableError } from '../../../domain/shared/DomainError';

const originalFetch = globalThis.fetch;
const HERMES_UNREACHABLE = 'Hermes AI is not reachable in this environment';

function testClient(timeoutMs = 5000): HermesCompletionClient {
  return new HermesCompletionClient({
    apiUrl: 'http://127.0.0.1:8642/v1',
    apiKey: '',
    model: 'hermes-agent',
    maxTokens: 123,
    timeoutMs,
  });
}

async function completionFailure(client: HermesCompletionClient): Promise<unknown> {
  try {
    await client.complete({ system: 's', prompt: 'p' });
  } catch (error) {
    return error;
  }
  throw new Error('Expected the Hermes completion to fail');
}

describe('HermesCompletionClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts OpenAI-compatible chat completions to Hermes API Server', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '  Done  ' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://host.docker.internal:8642/v1/',
      apiKey: 'secret-key',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    const result = await client.complete({
      system: 'System prompt',
      prompt: 'User prompt',
      jsonSchema: { type: 'object', required: ['ok'] },
    });

    expect(result).toBe('Done');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host.docker.internal:8642/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
    });
    expect(init?.headers).not.toHaveProperty('X-Hermes-Session-Key');

    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('hermes-agent');
    expect(body.max_tokens).toBe(123);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Return only valid JSON');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'User prompt' });
  });

  it.each([
    {
      answer: 'a 503 answer with an error message',
      reply: () =>
        new Response(JSON.stringify({ error: { message: 'Hermes unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      detail: 'Hermes unavailable',
    },
    {
      answer: 'a 502 answer without a JSON body',
      reply: () => new Response('Bad gateway', { status: 502 }),
      detail: 'Hermes API request failed with 502',
    },
  ])('reports $answer as Hermes being unavailable and keeps the detail as the cause', async ({ reply, detail }) => {
    globalThis.fetch = jest.fn(async () => reply()) as typeof fetch;

    const error = await completionFailure(testClient());

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: HERMES_UNREACHABLE });
    expect((error as ServiceUnavailableError).cause).toEqual(new Error(detail));
  });

  it('transport errors become ServiceUnavailableError', async () => {
    const refused = new TypeError('fetch failed');
    globalThis.fetch = jest.fn(async () => {
      throw refused;
    }) as typeof fetch;

    const error = await completionFailure(testClient());

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).toMatchObject({ message: HERMES_UNREACHABLE });
    expect((error as ServiceUnavailableError).cause).toBe(refused);
  });

  it('reports a connection dropped while reading the answer as Hermes being unavailable', async () => {
    const answer = new Response(JSON.stringify({ choices: [] }), { status: 200 });
    const dropped = new TypeError('terminated');
    jest.spyOn(answer, 'json').mockRejectedValue(dropped);
    globalThis.fetch = jest.fn(async () => answer) as typeof fetch;

    const error = await completionFailure(testClient());

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ServiceUnavailableError).cause).toBe(dropped);
  });

  it('throws when a successful Hermes response has no assistant content', async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: '',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    await expect(client.complete({ system: 's', prompt: 'p' })).rejects.toThrow(
      'Hermes API response did not include assistant content',
    );
  });

  it('throws when a successful Hermes response is not JSON', async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ) as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: '',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    await expect(client.complete({ system: 's', prompt: 'p' })).rejects.toThrow(
      'Hermes API returned a non-JSON success response',
    );
  });

  it('sends a Hermes session key only when request scope is provided', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'secret-key',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    await client.complete({ system: 's', prompt: 'p', sessionKey: 'workspace:42:user:7' });

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'X-Hermes-Session-Key': 'workspace:42:user:7',
    });
  });

  it('reports a timeout as Hermes being unavailable and names the timeout in the cause', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    }) as typeof fetch;

    const error = await completionFailure(testClient(50));

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).toMatchObject({ message: HERMES_UNREACHABLE });
    expect((error as ServiceUnavailableError).cause).toEqual(
      new Error('Hermes API request timed out after 50ms'),
    );
  });

  it.each([
    { answer: 'no assistant content', body: JSON.stringify({ choices: [] }) },
    { answer: 'a non-JSON body', body: 'not json' },
  ])('keeps a 200 answer with $answer a plain error, because Hermes did answer', async ({ body }) => {
    globalThis.fetch = jest.fn(async () => new Response(body, { status: 200 })) as typeof fetch;

    const error = await completionFailure(testClient());

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServiceUnavailableError);
  });
});
