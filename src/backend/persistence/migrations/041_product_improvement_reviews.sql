-- Latest bounded seller improvement review per tenant/product/listing scope.
-- Domain facts and decisions are committed together; no LangGraph execution checkpoint.
CREATE TABLE IF NOT EXISTS product_improvement_reviews (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  listing_scope TEXT NOT NULL DEFAULT '',
  session_id UUID NOT NULL,
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  PRIMARY KEY (workspace_id, product_id, listing_scope)
);
