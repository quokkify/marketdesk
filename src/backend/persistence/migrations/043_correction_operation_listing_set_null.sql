-- Migration 043: a product can be deleted after its listing was delisted.
-- Deleting a product cascades to its listings. A delist leaves a correction
-- operation whose listing_id referenced the listing with ON DELETE RESTRICT, so
-- every later delete of that product failed. The operation stays as audit history:
-- its listing_id becomes NULL and its result keeps the listing and product ids.
-- Reruns take no DDL lock once the column and the constraint are relaxed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'category_correction_operations'::regclass
       AND attname = 'listing_id'
       AND attnotnull
  ) THEN
    ALTER TABLE category_correction_operations ALTER COLUMN listing_id DROP NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'category_correction_operations'::regclass
       AND conname = 'category_correction_operations_listing_id_fkey'
       AND confdeltype <> 'n'
  ) THEN
    ALTER TABLE category_correction_operations
      DROP CONSTRAINT category_correction_operations_listing_id_fkey,
      ADD CONSTRAINT category_correction_operations_listing_id_fkey
        FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL NOT VALID;
  END IF;
END
$$;
