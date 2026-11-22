-- The market search a sale verdict run started or ran. No foreign key: research runs and verdict runs
-- both go with their product.
ALTER TABLE product_sale_verdicts ADD COLUMN IF NOT EXISTS research_run_id UUID;
