import type { OlxCategorySearchResult } from '../../state/api/listingsApi';
import {
  createOlxCategorySearch,
  seedOnMount,
  seedSearchTerm,
  type OlxCategorySearchState,
} from './olxCategorySearch';

const chair: OlxCategorySearchResult = {
  providerCategoryId: '1',
  name: 'Fotele',
  path: ['Dom i Ogród', 'Meble', 'Fotele'],
};

function setup(search: jest.Mock) {
  const states: OlxCategorySearchState[] = [];
  const controller = createOlxCategorySearch({ search, onState: (s) => states.push(s) });
  return { controller, states };
}

describe('olxCategorySearch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('searches once with the latest query after a 300 ms pause', async () => {
    const search = jest.fn().mockResolvedValue([chair]);
    const { controller, states } = setup(search);
    controller.setQuery('fo');
    jest.advanceTimersByTime(100);
    controller.setQuery('fot');
    jest.advanceTimersByTime(299);
    expect(search).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('fot');
    await Promise.resolve();
    expect(states[states.length - 1]).toEqual({ query: 'fot', status: 'results', results: [chair] });
  });

  it('never searches for a single character', () => {
    const search = jest.fn().mockResolvedValue([]);
    const { controller, states } = setup(search);
    controller.setQuery('f');
    jest.advanceTimersByTime(1000);
    expect(search).not.toHaveBeenCalled();
    expect(states[states.length - 1]).toMatchObject({ query: 'f', status: 'idle' });
  });

  it('reports an empty answer', async () => {
    const { controller, states } = setup(jest.fn().mockResolvedValue([]));
    controller.setQuery('zzz');
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    expect(states[states.length - 1]).toMatchObject({ status: 'empty', results: [] });
  });

  it('reports a rejected search as unavailable', async () => {
    const { controller, states } = setup(jest.fn().mockRejectedValue(new Error('503')));
    controller.setQuery('fot');
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
    expect(states[states.length - 1]).toMatchObject({ status: 'unavailable' });
  });

  it('ignores a slow first answer that arrives after a second query', async () => {
    let resolveFirst: (r: OlxCategorySearchResult[]) => void = () => undefined;
    const search = jest
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([chair]);
    const { controller, states } = setup(search);
    controller.setQuery('fot');
    jest.advanceTimersByTime(300);
    controller.setQuery('fote');
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    resolveFirst([{ ...chair, providerCategoryId: 'old' }]);
    await Promise.resolve();
    const last = states[states.length - 1]!;
    expect(last).toMatchObject({ query: 'fote', status: 'results' });
    expect(last.results[0]?.providerCategoryId).toBe('1');
  });

  it('derives the seed term and searches it immediately', () => {
    expect(seedSearchTerm('Fotel IKEA')).toBe('Fotel');
    expect(seedSearchTerm('A BC')).toBeNull();
    expect(seedSearchTerm(undefined)).toBeNull();
    const search = jest.fn().mockResolvedValue([]);
    const { controller } = setup(search);
    controller.searchSeed('Fotel IKEA');
    expect(search).toHaveBeenCalledWith('Fotel');
  });

  it('emits nothing after dispose', async () => {
    let resolveFirst: (r: OlxCategorySearchResult[]) => void = () => undefined;
    const search = jest.fn().mockImplementation(() => new Promise((r) => (resolveFirst = r)));
    const { controller, states } = setup(search);
    controller.setQuery('fot');
    jest.advanceTimersByTime(300);
    const count = states.length;
    controller.dispose();
    resolveFirst([chair]);
    await Promise.resolve();
    controller.setQuery('fote');
    jest.advanceTimersByTime(300);
    expect(states.length).toBe(count);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('shows the searching state and drops old results as soon as a new query is typed', async () => {
    let resolveFirst: (r: OlxCategorySearchResult[]) => void = () => undefined;
    const search = jest
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([chair]);
    const { controller, states } = setup(search);
    controller.setQuery('fot');
    jest.advanceTimersByTime(300);
    controller.setQuery('stol');
    expect(states[states.length - 1]).toEqual({ query: 'stol', status: 'searching', results: [] });
    resolveFirst([{ ...chair, providerCategoryId: 'old' }]);
    await Promise.resolve();
    expect(states[states.length - 1]).toEqual({ query: 'stol', status: 'searching', results: [] });
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    expect(states[states.length - 1]).toEqual({ query: 'stol', status: 'results', results: [chair] });
  });

  it('reports a synchronous throw from search as unavailable', () => {
    const search = jest.fn(() => {
      throw new Error('no marketplace');
    });
    const { controller, states } = setup(search);
    controller.searchSeed('Fotel');
    expect(states[states.length - 1]).toEqual({ query: 'Fotel', status: 'unavailable', results: [] });
  });

  it('searches the seed on mount only when no category is chosen', () => {
    expect(seedOnMount(null, 'Fotel IKEA')).toBe('Fotel IKEA');
    expect(seedOnMount({ providerCategoryId: '1', name: 'Fotele', path: chair.path }, 'Fotel IKEA'))
      .toBeUndefined();
    expect(seedOnMount(null, undefined)).toBeUndefined();
  });
});
