-- Lowest price the seller accepts in negotiation, in minor units; NULL means no discount.
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_acceptable_price_minor BIGINT;
