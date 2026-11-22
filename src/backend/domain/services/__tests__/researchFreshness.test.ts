import { isResearchFresh, RESEARCH_MAX_AGE_DAYS } from '../researchFreshness';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-22T12:00:00.000Z');

describe('isResearchFresh', () => {
  it('is stale when no attempt was ever recorded', () => {
    expect(isResearchFresh(null, NOW)).toBe(false);
  });

  it('is fresh just under the maximum age', () => {
    const attempt = new Date(NOW.getTime() - (RESEARCH_MAX_AGE_DAYS * DAY_MS - 60 * 60 * 1000));
    expect(isResearchFresh(attempt.toISOString(), NOW)).toBe(true);
  });

  it('is stale at exactly the maximum age', () => {
    const attempt = new Date(NOW.getTime() - RESEARCH_MAX_AGE_DAYS * DAY_MS);
    expect(isResearchFresh(attempt.toISOString(), NOW)).toBe(false);
  });

  it('is stale when the stored timestamp is unreadable', () => {
    expect(isResearchFresh('not a date', NOW)).toBe(false);
  });
});
