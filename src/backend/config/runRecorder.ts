import path from 'path';
import type { env } from './env.js';
import { noopRunRecorder, type IRunRecorder } from '../application/ports/IRunRecorder.js';
import { FileRunRecorder } from '../infrastructure/runRecorder/FileRunRecorder.js';
import { SecretRegistry, secretRegistry } from '../infrastructure/runRecorder/SecretRegistry.js';

export type RunRecorderState =
  | { enabled: true; dir: string }
  | {
      enabled: false;
      reason: 'production' | 'test' | 'not-development' | 'switched-off' | 'not-writable';
      detail?: string;
    };

export function resolveRunRecorder(
  e: { nodeEnv: string; runRecorder: { mode: string; dir: string } },
  probe: (dir: string) => { ok: true } | { ok: false; reason: string } = FileRunRecorder.probe,
): RunRecorderState {
  if (e.nodeEnv === 'production') return { enabled: false, reason: 'production' };
  if (e.nodeEnv === 'test') return { enabled: false, reason: 'test' };
  if (e.nodeEnv !== 'development') return { enabled: false, reason: 'not-development' };
  if (e.runRecorder.mode.trim().toLowerCase() === 'off') {
    return { enabled: false, reason: 'switched-off' };
  }
  const dir = path.resolve(process.cwd(), e.runRecorder.dir);
  const result = probe(dir);
  if (!result.ok) return { enabled: false, reason: 'not-writable', detail: result.reason };
  return { enabled: true, dir };
}

export function createRunRecorder(
  state: RunRecorderState,
  onFault: (error: unknown) => void,
): IRunRecorder {
  if (!state.enabled) return noopRunRecorder;
  return new FileRunRecorder({ dir: state.dir, onFault });
}

export function envSecretEntries(e: typeof env): Array<[label: string, value: string | undefined]> {
  return [
    ['ENV:DATABASE_URL', e.database.url],
    ['ENV:DB_PASSWORD', e.database.password],
    ['ENV:REDIS_URL', e.redis.url],
    ['ENV:REDIS_PASSWORD', e.redis.password],
    ['ENV:JWT_SECRET', e.jwt.secret],
    ['ENV:JWT_REFRESH_SECRET', e.jwt.refreshSecret],
    ['ENV:HERMES_API_KEY', e.hermes.apiKey],
    ['ENV:HERMES_WEBHOOK_SECRET', e.hermes.webhookSecret],
    ['ENV:OLX_CLIENT_SECRET', e.marketplaces.olx.clientSecret],
    ['ENV:OLX_ACCESS_TOKEN', e.marketplaces.olx.accessToken],
    ['ENV:OLX_REFRESH_TOKEN', e.marketplaces.olx.refreshToken],
    ['ENV:MARKETPLACE_CREDENTIALS_KEY', e.marketplaceCredentialsKey],
  ];
}

export function registerEnvSecrets(e: typeof env, registry: SecretRegistry = secretRegistry): void {
  for (const [label, value] of envSecretEntries(e)) registry.register(value, label);
}
