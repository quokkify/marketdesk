// Pure reader of a public OLX advert page: only the delivery mode (`BuyWithDelivery`, `NotEligible`, ...)
// leaves this module. The page embeds its data as a JSON string literal in window.__PRERENDERED_STATE__.

import { z } from 'zod';

const STATE_LITERAL = /__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\[\s\S])*")/;

const stateSchema = z.object({
  ad: z.object({
    ad: z.object({ delivery: z.object({ rock: z.object({ mode: z.string() }) }) }),
  }),
});

export function parseOlxAdvertDelivery(html: string): string | null {
  const literal = STATE_LITERAL.exec(html)?.[1];
  if (literal === undefined) return null;
  let state: unknown;
  try {
    state = JSON.parse(JSON.parse(literal) as string);
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(state);
  return parsed.success ? parsed.data.ad.ad.delivery.rock.mode : null;
}
