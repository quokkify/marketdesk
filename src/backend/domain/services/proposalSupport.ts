// Pieces shared by the engine's own run and the SEO / price proposal services.

import type { HermesEventType } from '../../../shared/types';
import { OFFLINE_AI_NOTICE, type AIProviderSourceAware } from '../ports/IAIProvider';
import type { PriceSuggestion } from './PriceEstimateService';

export type IdFactory = () => string;

// Structural, so the container can pass its logger.
export interface HermesEngineLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export const PRICE_ESTIMATE_PENDING: PriceSuggestion = {
  type: 'price_estimate_unavailable',
  severity: 'info',
  title: 'Price estimate pending',
  detail: 'Searching prices, about 2–4 min. The estimate appears when it finishes.',
  change: null,
};

// One pending price event per product: a new one closes the earlier pending ones (applied or
// otherwise resolved events are never touched). The job's "unavailable" notice closes only earlier
// notices, so a background failure never takes away a priced suggestion the seller can still act on.
export const PRICE_EVENT_TYPES: readonly HermesEventType[] = [
  'suggested_lower_price',
  'suggested_higher_price',
  'price_estimate_unavailable',
];
export const PRICE_NOTICE_TYPES: readonly HermesEventType[] = ['price_estimate_unavailable'];

// Adds the offline notice unless the provider already wrote it into the detail.
export function withOfflineNotice(detail: string): string {
  if (detail.includes(OFFLINE_AI_NOTICE)) return detail;
  const text = detail.trim();
  if (text === '') return OFFLINE_AI_NOTICE;
  return /[.!?]$/.test(text) ? `${text} ${OFFLINE_AI_NOTICE}` : `${text}. ${OFFLINE_AI_NOTICE}`;
}

export async function aiAnswersOffline(ai: object): Promise<boolean> {
  const { activeProvider } = ai as Partial<AIProviderSourceAware>;
  return typeof activeProvider === 'function' && (await activeProvider.call(ai)) === 'offline';
}
