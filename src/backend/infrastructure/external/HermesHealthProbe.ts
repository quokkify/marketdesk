// Readiness probe for the Hermes Agent API Server. isConfigured() is a local check;
// isReachable() asks GET {apiUrl}/models and, when that answers, GET {apiUrl}/toolsets
// to learn whether any toolset is enabled (an unreadable answer counts as unsafe). The
// answer is cached, so auto mode in AIProviderSelector costs at most two short requests
// per minute. Callers that arrive while a check runs share it instead of sending their own.

import type { HermesAIConfig } from './HermesAI';

const PROBE_TIMEOUT_MS = 3_000;
const PROBE_CACHE_TTL_MS = 60_000;

export interface HermesReachability {
  reachable: boolean;
  toolsSafe: boolean;
  enabledToolsets: string[];
  checkedAt: Date;
}

export class HermesHealthProbe {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private cached: { result: HermesReachability; expiresAt: number } | null = null;
  private inFlight: Promise<HermesReachability> | null = null;

  constructor(config: Pick<HermesAIConfig, 'apiUrl' | 'apiKey'>) {
    this.apiUrl = config.apiUrl.trim().replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
  }

  // A your_-prefixed key is the .env.example placeholder, not a real credential.
  isConfigured(): boolean {
    return this.apiUrl !== '' && this.apiKey !== '' && !this.apiKey.startsWith('your_');
  }

  async isReachable(): Promise<boolean> {
    return (await this.reachability()).reachable;
  }

  // The current answer and when Hermes was actually asked.
  reachability(): Promise<HermesReachability> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return Promise.resolve(this.cached.result);
    }
    if (!this.inFlight) {
      this.inFlight = this.check()
        .then((answer) => {
          const checkedAt = Date.now();
          const result = { ...answer, checkedAt: new Date(checkedAt) };
          this.cached = { result, expiresAt: checkedAt + PROBE_CACHE_TTL_MS };
          return result;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  // Every failure (refused connection, timeout, non-2xx answer) on /models means
  // "unreachable": the status endpoint reports it and auto mode routes calls to the
  // offline provider. /toolsets is asked only once /models answered.
  private async check(): Promise<Omit<HermesReachability, 'checkedAt'>> {
    const models = await this.request('/models');
    if (!models) {
      return { reachable: false, toolsSafe: false, enabledToolsets: [] };
    }
    // Releasing the unread body only frees the socket; a failure there says nothing
    // about whether Hermes answered.
    await models.body?.cancel().catch(() => undefined);
    return { reachable: true, ...(await this.requestToolsets()) };
  }

  // Fails closed: any error, non-2xx, non-JSON or list-less answer is "not safe".
  private async requestToolsets(): Promise<{ toolsSafe: boolean; enabledToolsets: string[] }> {
    const unsafe = { toolsSafe: false, enabledToolsets: [] };
    try {
      const response = await this.request('/toolsets');
      if (!response) {
        return unsafe;
      }
      const body: unknown = await response.json();
      const list = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
      if (!Array.isArray(list)) {
        return unsafe;
      }
      const enabledToolsets = list
        .filter((entry) => (entry as { enabled?: unknown } | null)?.enabled === true)
        .map((entry) => String((entry as { name?: unknown }).name));
      return { toolsSafe: enabledToolsets.length === 0, enabledToolsets };
    } catch {
      return unsafe;
    }
  }

  // The response when Hermes answered 2xx; null on a thrown error or any other status.
  private async request(path: string): Promise<Response | null> {
    try {
      const response = await fetch(`${this.apiUrl}${path}`, {
        method: 'GET',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: {
          Accept: 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      return response;
    } catch {
      return null;
    }
  }
}
