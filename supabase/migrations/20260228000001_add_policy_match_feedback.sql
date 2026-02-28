-- Stores explicit user feedback when they manually map an ingestion to a policy.
-- Used to improve future policy matching via lightweight similarity scoring.
CREATE TABLE IF NOT EXISTS public.policy_match_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ingestion_id UUID NOT NULL REFERENCES public.ingestions(id) ON DELETE CASCADE,
    policy_id TEXT NOT NULL,
    policy_name TEXT,
    feedback_type TEXT NOT NULL DEFAULT 'manual_match' CHECK (feedback_type IN ('manual_match')),
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, ingestion_id, policy_id)
);

CREATE INDEX IF NOT EXISTS policy_match_feedback_user_policy_idx
    ON public.policy_match_feedback(user_id, policy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS policy_match_feedback_user_created_idx
    ON public.policy_match_feedback(user_id, created_at DESC);

ALTER TABLE public.policy_match_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own policy match feedback"
    ON public.policy_match_feedback FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own policy match feedback"
    ON public.policy_match_feedback FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own policy match feedback"
    ON public.policy_match_feedback FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own policy match feedback"
    ON public.policy_match_feedback FOR DELETE
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_policy_match_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS policy_match_feedback_updated_at ON public.policy_match_feedback;
CREATE TRIGGER policy_match_feedback_updated_at
    BEFORE UPDATE ON public.policy_match_feedback
    FOR EACH ROW EXECUTE FUNCTION update_policy_match_feedback_updated_at();
