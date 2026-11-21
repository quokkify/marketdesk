// Job handler: one conversation-reply graph run per queued buyer message. Every returned outcome
// (drafted, no safe draft, suspicious, skipped) completes the job. A domain error that a retry cannot
// fix (thread, product or message text gone) completes it too, reported by code only. An unavailable
// AI provider or any other error (such as a database failure) fails it so the queue retries.

import type { ConversationReplyJob } from '../../../application/ports/IJobQueue';
import type { ConversationReplyGraph, ReplyRunOutcome } from '../../../application/services/ConversationReplyGraph';
import { DomainError, NotFoundError, ServiceUnavailableError } from '../../../domain/shared/DomainError';

export type ReplyDropCode = 'reply_target_missing' | 'reply_run_rejected';

export type ReplyJobResult = ReplyRunOutcome | { kind: 'dropped'; code: ReplyDropCode };

export class ConversationReplyHandler {
  // A fresh graph per job, so its repository's transactions belong to that run only.
  constructor(
    private readonly createGraph: () => Pick<ConversationReplyGraph, 'run'>,
    private readonly onDropped?: (failure: { threadId: string; code: ReplyDropCode }) => void,
  ) {}

  async handle(job: ConversationReplyJob): Promise<ReplyJobResult> {
    try {
      return await this.createGraph().run({
        workspaceId: job.workspaceId,
        threadId: job.threadId,
        messageId: job.messageId,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableError || !(error instanceof DomainError)) throw error;
      const code: ReplyDropCode = error instanceof NotFoundError ? 'reply_target_missing' : 'reply_run_rejected';
      this.onDropped?.({ threadId: job.threadId, code });
      return { kind: 'dropped', code };
    }
  }
}
