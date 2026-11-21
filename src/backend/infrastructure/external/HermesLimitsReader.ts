// Reads the account limits that the host writes with `hermes usage --json` (a timer replaces the file
// atomically every few minutes). The file is read on every call. Anything that cannot be trusted as a recent,
// complete reading is `unknown`, never old numbers shown as fresh; old but intact numbers are `stale`.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { HermesLimits, HermesLimitWindow } from '../../../shared/types';

export const LIMITS_STALE_AFTER_MS = 15 * 60_000;
// A fetch time slightly ahead of this clock is ordinary skew between the host and the container.
export const LIMITS_CLOCK_SKEW_MS = 60_000;
const RESET_HINT = '/usage reset';
const MAX_REASON_LENGTH = 200;

const text = z.string().nullable().catch(null);

// Keys are documented as stable and new keys may appear, so unknown keys are ignored and a malformed
// optional field degrades to null instead of discarding the whole reading.
const windowSchema = z.object({
  label: z.string(),
  used_percent: z.number().finite().nullable().catch(null),
  resets_at: text,
});

const fileSchema = z.object({
  provider: text,
  plan: text,
  fetched_at: z.string().nullable().catch(null),
  windows: z.array(z.unknown()).catch([]),
  details: z.array(z.unknown()).catch([]),
  unavailable_reason: text,
});

function limits(overrides: Partial<HermesLimits>): HermesLimits {
  return {
    state: 'unknown',
    scope: 'account',
    provider: null,
    plan: null,
    fetchedAt: null,
    ageSeconds: null,
    windows: [],
    details: [],
    reason: null,
    ...overrides,
  };
}

// The failure text comes from a file the host writes and reaches every signed-in user.
function cleanReason(reason: string): string {
  const flat = reason.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_REASON_LENGTH ? `${flat.slice(0, MAX_REASON_LENGTH - 1)}…` : flat;
}

function unknown(reason: string): HermesLimits {
  return limits({ state: 'unknown', reason });
}

function parseWindows(raw: unknown[]): HermesLimitWindow[] {
  const windows: HermesLimitWindow[] = [];
  for (const item of raw) {
    const parsed = windowSchema.safeParse(item);
    if (!parsed.success) continue;
    windows.push({
      label: parsed.data.label,
      usedPercent: parsed.data.used_percent,
      resetsAt: parsed.data.resets_at,
    });
  }
  return windows;
}

export class HermesLimitsReader {
  constructor(private readonly filePath: string) {}

  async read(now: Date): Promise<HermesLimits> {
    if (!this.filePath.trim()) return limits({ state: 'not_configured' });

    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch {
      return unknown('Limits file is missing or unreadable');
    }

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      return unknown('Limits file is empty or not valid JSON');
    }

    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) return unknown('Limits file has an unexpected shape');
    const file = parsed.data;

    if (file.unavailable_reason) {
      return unknown(cleanReason(file.unavailable_reason) || 'Limits are unavailable');
    }

    const fetchedMs = file.fetched_at ? Date.parse(file.fetched_at) : NaN;
    if (Number.isNaN(fetchedMs)) return unknown('Limits file has no valid fetch time');

    const ageMs = now.getTime() - fetchedMs;
    if (ageMs < -LIMITS_CLOCK_SKEW_MS) return unknown('Limits file is dated in the future');

    return limits({
      state: ageMs > LIMITS_STALE_AFTER_MS ? 'stale' : 'fresh',
      provider: file.provider,
      plan: file.plan,
      fetchedAt: new Date(fetchedMs).toISOString(),
      ageSeconds: Math.max(0, Math.floor(ageMs / 1000)),
      windows: parseWindows(file.windows),
      details: file.details.filter(
        (line): line is string => typeof line === 'string' && !line.includes(RESET_HINT)
      ),
    });
  }
}
