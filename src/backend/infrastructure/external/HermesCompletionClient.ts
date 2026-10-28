// Hermes API Server-backed implementation of the AITextCompletionClient boundary.
//
// The MarketDesk app runs in Docker and calls the Hermes Agent gateway/API server
// on the same VPS. Hermes then decides which configured model/provider/tools to
// use; MarketDesk no longer owns a direct Claude/Anthropic integration.

import type {
  AITextCompletionClient,
  AICompletionRequest,
  HermesAIConfig,
} from './HermesAI';
import { loadHermesConfig } from './HermesAI';
import { ServiceUnavailableError } from '../../domain/shared/DomainError';

// Stable client-facing message: the cause keeps the detail for the server log.
const HERMES_UNREACHABLE = 'Hermes AI is not reachable in this environment';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class HermesCompletionClient implements AITextCompletionClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: HermesAIConfig = loadHermesConfig()) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
    this.timeoutMs = config.timeoutMs;
  }

  // Transport failures, timeouts and non-2xx answers mean Hermes is unavailable (503).
  // A 2xx answer that is not usable stays a plain error: Hermes did answer.
  async complete(request: AICompletionRequest): Promise<string> {
    let response: Response;
    let body: ChatCompletionResponse | null;
    try {
      response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(request.sessionKey ? { 'X-Hermes-Session-Key': request.sessionKey } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          max_tokens: request.maxTokens ?? this.defaultMaxTokens,
          messages: [
            { role: 'system', content: this.withJsonSchemaInstruction(request) },
            { role: 'user', content: request.prompt },
          ],
        }),
      });
      body = await this.parseResponseBody(response);
    } catch (error) {
      throw new ServiceUnavailableError(
        HERMES_UNREACHABLE,
        this.isTimeoutError(error)
          ? new Error(`Hermes API request timed out after ${this.timeoutMs}ms`)
          : error,
      );
    }

    if (!response.ok) {
      const message = body?.error?.message || `Hermes API request failed with ${response.status}`;
      throw new ServiceUnavailableError(HERMES_UNREACHABLE, new Error(message));
    }
    if (body === null) {
      throw new Error('Hermes API returned a non-JSON success response');
    }
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Hermes API response did not include assistant content');
    }
    return content;
  }

  // null when the body is not JSON. A failure to read the body (dropped connection,
  // timeout) is rethrown, because Hermes did not deliver an answer.
  private async parseResponseBody(response: Response): Promise<ChatCompletionResponse | null> {
    try {
      return (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      // By name: the parser's SyntaxError can come from another realm than ours.
      if ((error as { name?: unknown } | null)?.name === 'SyntaxError') return null;
      throw error;
    }
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof DOMException
      ? error.name === 'TimeoutError' || error.name === 'AbortError'
      : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  }

  private withJsonSchemaInstruction(request: AICompletionRequest): string {
    if (!request.jsonSchema) return request.system;

    return [
      request.system,
      'Return only valid JSON. Do not include markdown fences, comments, prose, or extra keys.',
      `The JSON must match this schema: ${JSON.stringify(request.jsonSchema)}.`,
    ].join('\n');
  }
}
