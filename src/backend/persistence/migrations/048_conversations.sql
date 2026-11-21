-- OLX buyer conversations and the reply drafts written for them. Text columns are personal
-- data of the buyer: purged after the retention window, counters and hashes only keep structure.
CREATE TABLE IF NOT EXISTS conversation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  external_thread_id VARCHAR(128) NOT NULL,
  external_buyer_id VARCHAR(128),
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  suspicious_reasons TEXT[] NOT NULL DEFAULT '{}',
  last_external_message_id VARCHAR(128),
  retention_starts_at TIMESTAMPTZ,
  text_purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_product ON conversation_threads(product_id, workspace_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  external_message_id VARCHAR(128) NOT NULL,
  direction VARCHAR(8) NOT NULL,
  text TEXT,
  text_hash VARCHAR(64),
  sent_at TIMESTAMPTZ NOT NULL,
  UNIQUE (thread_id, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_sent ON conversation_messages(thread_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_hash ON conversation_messages(text_hash) WHERE text_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS reply_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  answers_message_id UUID NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  intent VARCHAR(16),
  proposed_text TEXT,
  sent_text TEXT,
  filled_price BIGINT,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  failure_reason VARCHAR(255),
  attempt_key VARCHAR(128),
  attempt_started_at TIMESTAMPTZ,
  external_message_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reply_drafts_thread_status ON reply_drafts(thread_id, status);
