-- Listing response runs: the state and result of the listing response graph for a live listing. History is kept.
CREATE TABLE IF NOT EXISTS listing_response_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  graph_version VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL,
  stage VARCHAR(30),
  signal JSONB,
  probes JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  fingerprint VARCHAR(64) NOT NULL,
  error_code VARCHAR(60),
  queued_at TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  lease_until TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listing_response_runs_listing_queued ON listing_response_runs(listing_id, queued_at DESC);
-- At most one queued or running run per listing: the insert of a second one does nothing.
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_response_runs_one_active ON listing_response_runs(listing_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_listing_response_runs_completed ON listing_response_runs(workspace_id, listing_id, completed_at DESC) WHERE status = 'completed';
