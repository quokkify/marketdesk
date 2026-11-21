-- The seller's price research for one product: a retail anchor and prices of comparable adverts.
CREATE TABLE IF NOT EXISTS product_price_research (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  retail_price NUMERIC(12,2),
  retail_currency VARCHAR(3),
  retail_source VARCHAR(200),
  retail_checked_at DATE,
  comparables JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
