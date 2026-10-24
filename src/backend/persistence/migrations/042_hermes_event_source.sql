-- Migration 042: who produced an AI-made Hermes event.
-- 'hermes' for the Hermes Agent API, 'offline' for the built-in heuristics used when
-- Hermes is not available. NULL for suggestions no AI produced and for older rows.
ALTER TABLE hermes_events
  ADD COLUMN IF NOT EXISTS source VARCHAR(20);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hermes_events_source_valid') THEN
    ALTER TABLE hermes_events ADD CONSTRAINT hermes_events_source_valid
      CHECK (source IN ('hermes', 'offline'));
  END IF;
END $$;
