import fs from 'node:fs';
import path from 'node:path';

describe('Hermes event source migration', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'src/backend/persistence/migrations/042_hermes_event_source.sql'),
    'utf8'
  );
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'src/backend/persistence/schema.sql'),
    'utf8'
  );

  it('adds a nullable source column and its check idempotently', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS source VARCHAR(20);');
    expect(migration).toContain("WHERE conname = 'hermes_events_source_valid'");
    expect(migration).toContain("CHECK (source IN ('hermes', 'offline'))");
    expect(migration).not.toMatch(/NOT NULL|DEFAULT/);
  });

  it('keeps schema.sql in step with the migration', () => {
    const table = schema.match(/CREATE TABLE IF NOT EXISTS hermes_events \([\s\S]*?\n\);/)?.[0];

    expect(table).toContain(
      "source VARCHAR(20) CONSTRAINT hermes_events_source_valid CHECK (source IN ('hermes', 'offline'))"
    );
  });
});
