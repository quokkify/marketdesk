// Framework-free state machine behind OlxCategoryPicker: debounce, minimum length,
// stale-answer discard and disposal live here so they can be tested without a DOM.
import type { OlxCategorySearchResult } from '../../state/api/listingsApi.js';
import type { WizardOlxCategory } from './productFormModel.js';

export type OlxCategorySearchState = {
  query: string;
  status: 'idle' | 'searching' | 'results' | 'empty' | 'unavailable';
  results: OlxCategorySearchResult[];
};

export interface OlxCategorySearchOptions {
  search: (query: string) => Promise<OlxCategorySearchResult[]>;
  onState: (state: OlxCategorySearchState) => void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const MIN_SEED_WORD_LENGTH = 3;

export function seedSearchTerm(seed: string | undefined): string | null {
  return seed?.split(/\s+/).find((word) => word.length >= MIN_SEED_WORD_LENGTH) ?? null;
}

export function seedOnMount(
  value: WizardOlxCategory | null,
  seed: string | undefined
): string | undefined {
  return value === null ? seed : undefined;
}

export function createOlxCategorySearch(options: OlxCategorySearchOptions) {
  const { search, onState, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sequence = 0;
  let disposed = false;

  const emit = (state: OlxCategorySearchState) => {
    if (!disposed) onState(state);
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = (query: string) => {
    const current = ++sequence;
    emit({ query, status: 'searching', results: [] });
    let pending: Promise<OlxCategorySearchResult[]>;
    try {
      pending = search(query.trim());
    } catch {
      emit({ query, status: 'unavailable', results: [] });
      return;
    }
    pending.then(
      (results) => {
        if (current !== sequence) return;
        emit({ query, status: results.length > 0 ? 'results' : 'empty', results });
      },
      () => {
        if (current !== sequence) return;
        emit({ query, status: 'unavailable', results: [] });
      }
    );
  };

  return {
    setQuery(query: string) {
      if (disposed) return;
      clearTimer();
      sequence++;
      if (query.trim().length < MIN_QUERY_LENGTH) {
        emit({ query, status: 'idle', results: [] });
        return;
      }
      emit({ query, status: 'searching', results: [] });
      timer = setTimeout(() => {
        timer = null;
        run(query);
      }, debounceMs);
    },
    searchSeed(seed: string) {
      const term = seedSearchTerm(seed);
      if (disposed || term === null) return;
      clearTimer();
      run(term);
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
