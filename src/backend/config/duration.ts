const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

// `<integer><unit>` with unit s, m, h or d; anything else is null.
export function parseDurationMs(value: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
