import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('correction operation listing migration (043)', () => {
  const migration = read('src/backend/persistence/migrations/043_correction_operation_listing_set_null.sql');
  const schema = read('src/backend/persistence/schema.sql');

  it('relaxes listing_id to ON DELETE SET NULL and takes no DDL lock on reruns', () => {
    expect(migration).toContain("attname = 'listing_id'");
    expect(migration).toContain('AND attnotnull');
    expect(migration).toContain('ALTER COLUMN listing_id DROP NOT NULL');
    expect(migration).toContain("conname = 'category_correction_operations_listing_id_fkey'");
    expect(migration).toContain("confdeltype <> 'n'");
    expect(migration).toContain(
      'FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL NOT VALID'
    );
  });

  // schema.sql declares the foreign key validated, so one run must converge without waiting for
  // migration 026 to replay.
  it('validates the re-added foreign key in the same run, only while it is not validated', () => {
    expect(migration).toMatch(
      /conname = 'category_correction_operations_listing_id_fkey'\s+AND NOT convalidated\s+\) THEN\s+ALTER TABLE category_correction_operations\s+VALIDATE CONSTRAINT category_correction_operations_listing_id_fkey;/
    );
  });

  it('keeps schema.sql in step with the migration', () => {
    const table = schema.match(
      /CREATE TABLE IF NOT EXISTS category_correction_operations \([\s\S]*?\n\);/
    )?.[0];

    expect(table).toContain('listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,');
  });
});
