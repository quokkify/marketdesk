-- Who wrote a reply draft: Hermes or the offline fallback; the UI shows a notice for offline drafts.
ALTER TABLE reply_drafts ADD COLUMN IF NOT EXISTS source VARCHAR(16);
