-- Sale verdict runs: the state and result of the verdict graph for a product. History is kept.
CREATE TABLE IF NOT EXISTS product_sale_verdicts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  listing_id UUID,
  graph_version VARCHAR(40) NOT NULL,
  scope TEXT[] NOT NULL,
  status VARCHAR(20) NOT NULL,
  overall VARCHAR(20),
  checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(60),
  queued_at TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  lease_until TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_sale_verdicts_product_queued ON product_sale_verdicts(product_id, queued_at DESC);
-- At most one queued or running run per product: the insert of a second one does nothing.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_sale_verdicts_one_active ON product_sale_verdicts(product_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_product_sale_verdicts_completed ON product_sale_verdicts(workspace_id, product_id, completed_at DESC) WHERE status = 'completed';
