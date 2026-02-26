-- Create processing_events table for granular logging
CREATE TABLE IF NOT EXISTS processing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingestion_id UUID REFERENCES ingestions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('info', 'analysis', 'action', 'error')),
    agent_state TEXT, -- e.g., 'Triage', 'Baseline Extraction', 'Policy Matching', 'Action Execution'
    details JSONB, -- Stores LLM inputs/outputs, reasoning, confidence
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE processing_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can access their own processing events
CREATE POLICY "Users can access their own processing events" ON processing_events
    FOR ALL USING (auth.uid() = user_id);

-- Enable Realtime for this table (standard Supabase publication)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'processing_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE processing_events;
  END IF;
END
$$;
