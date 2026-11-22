// Process-wide cap on concurrent research calls: every graph run shares one limiter, so parallel
// tier nodes of several runs never put more than `max` calls on the research profile at once.

export interface ResearchCallLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createResearchCallLimiter(max: number): ResearchCallLimiter {
  if (!Number.isInteger(max) || max < 1) throw new Error(`Research call limit must be a positive integer, got ${max}`);
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active < max) active += 1;
      else await new Promise<void>((resolve) => waiting.push(resolve));
      try {
        return await fn();
      } finally {
        // A finished call hands its slot straight to the next waiting one.
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      }
    },
  };
}
