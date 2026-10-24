// Readiness probe for the Hermes Agent API Server. isConfigured() is a local check;
// isReachable() asks GET {apiUrl}/models and caches the answer, so auto mode in
// AIProviderSelector costs at most one short request per minute. Callers that arrive
// while a check runs share it instead of sending their own.

import type { HermesAIConfig } from './HermesAI';

const PROBE_TIMEOUT_MS = 3_000;
const PROBE_CACHE_TTL_MS = 60_000;

export interface HermesReachability {
  reachable: boolean;
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
      this.inFlight = this.requestModels()
        .then((reachable) => {
          const checkedAt = Date.now();
          const result = { reachable, checkedAt: new Date(checkedAt) };
          this.cached = { result, expiresAt: checkedAt + PROBE_CACHE_TTL_MS };
          return result;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  // Every failure (refused connection, timeout, non-2xx answer) means "unreachable":
  // the status endpoint reports it and auto mode routes calls to the offline provider.
  private async requestModels(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: {
          Accept: 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });
      const reachable = response.ok;
      // Releasing the unread body only frees the socket; a failure there says nothing
      // about whether Hermes answered.
      await response.body?.cancel().catch(() => undefined);
      return reachable;
    } catch {
      return false;
    }
  }
}
