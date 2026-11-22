-- Tiered price anchors: product specs, sellers' dismissed anchor links, the last search attempt and its estimate.
ALTER TABLE product_price_research ADD COLUMN IF NOT EXISTS specs VARCHAR(300);
ALTER TABLE product_price_research ADD COLUMN IF NOT EXISTS dismissed_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE product_price_research ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP;
ALTER TABLE product_price_research ADD COLUMN IF NOT EXISTS last_estimate JSONB;
