-- At most one pending reply draft per thread; concurrent graph runs cannot leave two.
CREATE UNIQUE INDEX IF NOT EXISTS ux_reply_drafts_one_pending ON reply_drafts(thread_id) WHERE status = 'pending';
