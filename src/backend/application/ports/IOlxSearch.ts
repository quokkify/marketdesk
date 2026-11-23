import type { ProbeCard } from '../../../shared/types';

export interface OlxSearchPage {
  total: number | null;
  totalPages: number | null;
  cards: ProbeCard[];
}

export interface IOlxSearch {
  /** page is 1-based; rejects on any failure. */
  page(query: string, page: number, signal: AbortSignal): Promise<OlxSearchPage>;
}
