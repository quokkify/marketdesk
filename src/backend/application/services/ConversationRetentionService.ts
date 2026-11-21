import type { IConversationRepository } from '../../domain/repositories/interfaces/IConversationRepository';

export const CONVERSATION_TEXT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export class ConversationRetentionService {
  constructor(private readonly conversations: Pick<IConversationRepository, 'purgeExpiredText'>) {}

  async purge(now: Date): Promise<number> {
    const before = new Date(now.getTime() - CONVERSATION_TEXT_RETENTION_DAYS * DAY_MS);
    return this.conversations.purgeExpiredText(before);
  }
}
