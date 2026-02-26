-- Ingestion log table: tracks every document processed through Folio's Policy Engine
-- (Restoring this table for the Hybrid Routing Architecture, since the previous
-- compatible_mode migration erroneously dropped it).
CREATE TABLE IF NOT EXISTS ingestions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source          text NOT NULL DEFAULT 'upload',   -- 'upload' | 'dropzone' | 'email' | 'url'
    filename        text NOT NULL,
    mime_type       text,
    file_size       bigint,
    status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'matched' | 'no_match' | 'error'
    policy_id       text,                             -- matched policy id (nullable)
    policy_name     text,                             -- denormalised for display
    extracted       jsonb DEFAULT '{}'::jsonb,        -- key/value pairs extracted by FPE
    actions_taken   jsonb DEFAULT '[]'::jsonb,        -- list of actions executed
    error_message   text,
    storage_path    text,                             -- file path pointer for Hybrid Routing or Supabase Storage ID
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for per-user list queries
CREATE INDEX IF NOT EXISTS ingestions_user_id_idx ON ingestions(user_id, created_at DESC);

-- RLS
ALTER TABLE ingestions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users can manage their own ingestions"
        ON ingestions FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_ingestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ingestions_updated_at ON ingestions;
CREATE TRIGGER ingestions_updated_at
    BEFORE UPDATE ON ingestions
    FOR EACH ROW EXECUTE FUNCTION update_ingestions_updated_at();
