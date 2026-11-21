// Job handler: one conversation-reply graph run per queued buyer message. Every returned outcome
// (drafted, no safe draft, suspicious, skipped) completes the job; a thrown error, such as an
// unavailable AI provider, fails it so the queue retries.

import type { ConversationReplyJob } from '../../../application/ports/IJobQueue';
import type { ConversationReplyGraph, ReplyRunOutcome } from '../../../application/services/ConversationReplyGraph';

export class ConversationReplyHandler {
  // A fresh graph per job, so its repository's transactions belong to that run only.
  constructor(private readonly createGraph: () => Pick<ConversationReplyGraph, 'run'>) {}

  async handle(job: ConversationReplyJob): Promise<ReplyRunOutcome> {
    return this.createGraph().run({
      workspaceId: job.workspaceId,
      threadId: job.threadId,
      messageId: job.messageId,
    });
  }
}
