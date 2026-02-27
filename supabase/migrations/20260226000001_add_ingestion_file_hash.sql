-- Add file_hash column to ingestions for duplicate detection.
-- SHA-256 hex digest (64 chars) of the raw file bytes.
-- Nullable so existing rows are unaffected.
ALTER TABLE ingestions ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Partial index: only non-null hashes, scoped per user — makes the
-- duplicate lookup (user_id + file_hash) fast without indexing NULLs.
CREATE INDEX IF NOT EXISTS idx_ingestions_user_file_hash
    ON ingestions (user_id, file_hash)
    WHERE file_hash IS NOT NULL;
