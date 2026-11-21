import { ConversationReplyHandler } from '../JobHandlers/ConversationReplyHandler';
import { ServiceUnavailableError } from '../../../domain/shared/DomainError';

describe('ConversationReplyHandler', () => {
  const job = { workspaceId: 'w1', threadId: 't1', messageId: 'm1' };

  it('builds a graph per job and runs it with the job ids only', async () => {
    const run = jest.fn(async () => ({ kind: 'drafted' as const, draftId: 'd1' }));
    const createGraph = jest.fn(() => ({ run }));
    const handler = new ConversationReplyHandler(createGraph);

    const outcome = await handler.handle({ ...job, extra: 'ignored' } as typeof job);
    await handler.handle(job);

    expect(outcome).toEqual({ kind: 'drafted', draftId: 'd1' });
    expect(createGraph).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(job);
  });

  it('completes the job on a skipped or suspicious outcome', async () => {
    const handler = new ConversationReplyHandler(() => ({
      run: async () => ({ kind: 'skipped' as const, reason: 'daily_cap' as const }),
    }));
    await expect(handler.handle(job)).resolves.toEqual({ kind: 'skipped', reason: 'daily_cap' });
  });

  it('lets an unavailable AI fail the job so the queue retries it', async () => {
    const handler = new ConversationReplyHandler(() => ({
      run: async () => { throw new ServiceUnavailableError('AI provider unavailable'); },
    }));
    await expect(handler.handle(job)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
