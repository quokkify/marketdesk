-- Price research runs: the state of the background research job, kept apart from the research row
-- so run-state writes never touch product_price_research.updated_at. History is kept.
CREATE TABLE IF NOT EXISTS price_research_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  trigger VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  nodes JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome VARCHAR(20),
  failed_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code VARCHAR(60),
  consecutive_failures INT NOT NULL DEFAULT 0,
  queued_at TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  lease_until TIMESTAMP,
  next_auto_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_price_research_runs_product_queued ON price_research_runs(product_id, queued_at DESC);
-- At most one queued or running run per product: the insert of a second one does nothing.
CREATE UNIQUE INDEX IF NOT EXISTS ux_price_research_runs_one_active ON price_research_runs(product_id) WHERE status IN ('queued', 'running');
