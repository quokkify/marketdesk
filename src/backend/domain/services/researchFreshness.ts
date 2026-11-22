export const RESEARCH_MAX_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// A ladder is fresh while the last research attempt, successful or not, is younger than the maximum age.
export function isResearchFresh(lastAttemptAt: string | null, now: Date): boolean {
  if (lastAttemptAt === null) return false;
  const attempted = Date.parse(lastAttemptAt);
  if (Number.isNaN(attempted)) return false;
  return now.getTime() - attempted < RESEARCH_MAX_AGE_DAYS * DAY_MS;
}
