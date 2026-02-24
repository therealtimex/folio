-- Create policies table for user-managed FPE policies
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    policy_id TEXT NOT NULL,  -- the metadata.id from the YAML (e.g. "tesla-invoice-handler")
    metadata JSONB NOT NULL,
    spec JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 100,
    api_version TEXT NOT NULL DEFAULT 'folio/v1',
    kind TEXT NOT NULL DEFAULT 'Policy',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, policy_id)
);

-- Enable RLS
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own policies
CREATE POLICY "Users can read own policies"
    ON policies FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own policies"
    ON policies FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own policies"
    ON policies FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own policies"
    ON policies FOR DELETE
    USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policies_updated_at
    BEFORE UPDATE ON policies
    FOR EACH ROW EXECUTE FUNCTION update_policies_updated_at();
