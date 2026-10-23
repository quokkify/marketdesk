// Readiness probe for the Hermes Agent API Server. isConfigured() is a local check;
// isReachable() asks GET {apiUrl}/models and caches the answer, so auto mode in
// AIProviderSelector costs at most one short request per minute.

import type { HermesAIConfig } from './HermesAI';

const PROBE_TIMEOUT_MS = 3_000;
const PROBE_CACHE_TTL_MS = 60_000;

export class HermesHealthProbe {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private cached: { reachable: boolean; expiresAt: number } | null = null;

  constructor(config: Pick<HermesAIConfig, 'apiUrl' | 'apiKey'>) {
    this.apiUrl = config.apiUrl.trim().replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
  }

  // A your_-prefixed key is the .env.example placeholder, not a real credential.
  isConfigured(): boolean {
    return this.apiUrl !== '' && this.apiKey !== '' && !this.apiKey.startsWith('your_');
  }

  async isReachable(): Promise<boolean> {
    if (this.cached && Date.now() < this.cached.expiresAt) return this.cached.reachable;
    const reachable = await this.requestModels();
    this.cached = { reachable, expiresAt: Date.now() + PROBE_CACHE_TTL_MS };
    return reachable;
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
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }
}
