-- Accessories the item lacks, free text; used only by the price estimate. NULL means none.
ALTER TABLE products ADD COLUMN IF NOT EXISTS missing_accessories VARCHAR(200);
