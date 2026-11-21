-- One row per AI call: attribution, token counts, outcome. Never prompt or response text.
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  analysis_id UUID,
  run_id VARCHAR(128),
  feature VARCHAR(64) NOT NULL,
  operation VARCHAR(64) NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  provider VARCHAR(16) NOT NULL,
  model VARCHAR(128),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_status VARCHAR(16) NOT NULL,
  latency_ms INTEGER NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  http_status SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_created ON ai_usage(workspace_id, created_at DESC);
