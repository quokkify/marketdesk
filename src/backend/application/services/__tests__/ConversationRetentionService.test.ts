import {
  CONVERSATION_TEXT_RETENTION_DAYS,
  ConversationRetentionService,
} from '../ConversationRetentionService';

interface FakeThread {
  retentionStartsAt: Date | null;
  purged: boolean;
}

// Mirrors the repository contract: only threads whose retention start is before the cutoff are purged.
function fakeRepo(threads: FakeThread[]) {
  const cutoffs: Date[] = [];
  return {
    cutoffs,
    async purgeExpiredText(before: Date): Promise<number> {
      cutoffs.push(before);
      let touched = 0;
      for (const t of threads) {
        if (t.retentionStartsAt && t.retentionStartsAt < before) {
          t.purged = true;
          touched += 1;
        }
      }
      return touched;
    },
  };
}

const NOW = new Date('2026-12-01T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('ConversationRetentionService', () => {
  it('uses a 30 day window', () => {
    expect(CONVERSATION_TEXT_RETENTION_DAYS).toBe(30);
  });

  it('purgesAfterThirtyDays', async () => {
    const thread = { retentionStartsAt: new Date(NOW.getTime() - 31 * DAY_MS), purged: false };
    const repo = fakeRepo([thread]);
    const purged = await new ConversationRetentionService(repo).purge(NOW);
    expect(purged).toBe(1);
    expect(thread.purged).toBe(true);
    expect(repo.cutoffs[0].toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('keepsTextBeforeThirtyDays', async () => {
    const thread = { retentionStartsAt: new Date(NOW.getTime() - 29 * DAY_MS), purged: false };
    const purged = await new ConversationRetentionService(fakeRepo([thread])).purge(NOW);
    expect(purged).toBe(0);
    expect(thread.purged).toBe(false);
  });

  it('ignoresThreadsWithoutRetentionStart', async () => {
    const thread = { retentionStartsAt: null, purged: false };
    const purged = await new ConversationRetentionService(fakeRepo([thread])).purge(NOW);
    expect(purged).toBe(0);
    expect(thread.purged).toBe(false);
  });
});
