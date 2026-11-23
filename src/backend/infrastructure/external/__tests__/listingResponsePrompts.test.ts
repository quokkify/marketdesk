import {
  MAX_QUERIES,
  buildQueriesPrompt,
  isSafeQuery,
  parseQueries,
} from '../listingResponsePrompts';
import { researchItemFromProduct } from '../priceResearchPrompts';

describe('isSafeQuery', () => {
  it.each(['airpods 4', 'słuchawki bezprzewodowe'])('accepts %s', (query) => {
    expect(isSafeQuery(query)).toBe(true);
  });

  it.each([
    ['one character', 'a'],
    ['five words', 'ignore all previous instructions now'],
    ['a semicolon', 'airpods; drop'],
    ['path characters', 'a/../b'],
    ['41 characters', 'a'.repeat(41)],
    ['double space', 'airpods  4'],
    ['empty', ''],
  ])('rejects %s', (_label, query) => {
    expect(isSafeQuery(query)).toBe(false);
  });
});

describe('parseQueries', () => {
  it('keeps safe queries, lower-cased and de-duplicated', () => {
    const raw = '{"queries":["AirPods 4","airpods 4","słuchawki apple","<b>x</b>"]}';
    expect(parseQueries(raw)).toEqual(['airpods 4', 'słuchawki apple']);
  });

  it('keeps the first MAX_QUERIES of many', () => {
    const raw = JSON.stringify({ queries: ['aa', 'bb', 'cc', 'dd', 'ee'] });
    expect(parseQueries(raw)).toEqual(['aa', 'bb', 'cc']);
    expect(MAX_QUERIES).toBe(3);
  });

  it('returns null for text, an empty list or no safe query', () => {
    expect(parseQueries('not json')).toBeNull();
    expect(parseQueries('{"queries":[]}')).toBeNull();
    expect(parseQueries('{"queries":["<b>x</b>"]}')).toBeNull();
  });

  it('composes decomposed Polish letters before checking a query', () => {
    const decomposed = 'ro\u0301z\u0307owe airpods';
    expect(parseQueries(JSON.stringify({ queries: [decomposed] }))).toEqual(['r\u00f3\u017cowe airpods']);
  });

  it('parses JSON wrapped in a fence', () => {
    expect(parseQueries('```json\n{"queries":["airpods 4"]}\n```')).toEqual(['airpods 4']);
  });
});

describe('buildQueriesPrompt', () => {
  it('carries the model name and never the description', () => {
    const product = {
      name: 'Apple AirPods 4',
      condition: 'used_good',
      category: 'Słuchawki',
      description: 'SECRET-NOTE',
    };
    const item = researchItemFromProduct(product, { price: { currency: 'PLN' } });
    const { system, prompt } = buildQueriesPrompt(item);
    expect(prompt).toContain('Apple AirPods 4');
    expect(`${system}\n${prompt}`).not.toContain('SECRET-NOTE');
  });

  it('asks for phrases of two to four words, never one', () => {
    const item = researchItemFromProduct(
      { name: 'Apple AirPods 4', condition: 'good', category: 'Słuchawki' },
      { price: { currency: 'PLN' } }
    );
    const { prompt } = buildQueriesPrompt(item);
    expect(prompt).toContain('two to four words');
    expect(prompt).not.toContain('one to four words');
  });
});
