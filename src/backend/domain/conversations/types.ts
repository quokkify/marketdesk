export type ThreadStatus = 'open' | 'suspicious' | 'closed';
export type DraftStatus = 'pending' | 'sending' | 'sent' | 'dismissed' | 'superseded' | 'failed';
export type BuyerIntent = 'availability' | 'haggle' | 'logistics' | 'other';
export type DraftSource = 'hermes' | 'offline';
export type ScreeningReason =
  | 'foreign_link'
  | 'payment_data_request'
  | 'messenger_move'
  | 'fake_payment_confirmation'
  | 'prompt_injection'
  | 'repeated_text'
  | 'message_flood';

export interface ConversationThread {
  id: string;
  workspaceId: string;
  listingId: string;
  productId: string;
  externalThreadId: string;
  externalBuyerId: string | null;
  status: ThreadStatus;
  suspiciousReasons: ScreeningReason[];
  lastExternalMessageId: string | null;
  retentionStartsAt: Date | null;
  textPurgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  threadId: string;
  externalMessageId: string;
  direction: 'buyer' | 'seller';
  text: string | null;
  textHash: string | null;
  sentAt: Date;
}

export interface ReplyDraft {
  id: string;
  threadId: string;
  answersMessageId: string;
  intent: BuyerIntent | null;
  proposedText: string | null;
  sentText: string | null;
  filledPrice: number | null;
  status: DraftStatus;
  failureReason: string | null;
  source: DraftSource | null;
  attemptKey: string | null;
  attemptStartedAt: Date | null;
  externalMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
