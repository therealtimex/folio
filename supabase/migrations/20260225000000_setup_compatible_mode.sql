-- Keep old ingestions table from previous migration step for Hybrid Routing
-- (Previously this dropped public.ingestions, but we now retain it as Folio's primary UI table).
-- Create rtx_activities table as defined in Compatible Mode docs
-- Added user_id for multi-tenant isolation
CREATE TABLE public.rtx_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_data jsonb NULL,            -- Your input data
  old_data jsonb NULL,            -- Previous data (for updates)
  locked_by text NULL,            -- Machine ID holding the lock
  locked_at timestamp with time zone NULL,
  status text NULL DEFAULT 'pending'::text,
  completed_at timestamp with time zone NULL,
  error_message text NULL,
  attempted_by text[] NULL DEFAULT '{}'::text[],
  retry_count integer NULL DEFAULT 0,
  result jsonb NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT rtx_activities_pkey PRIMARY KEY (id)
);

-- Index for status queries
CREATE INDEX idx_rtx_activities_status ON public.rtx_activities (status);
-- Index for user list queries
CREATE INDEX idx_rtx_activities_user ON public.rtx_activities (user_id, created_at DESC);

-- Ensure all columns are included in Realtime events
ALTER TABLE public.rtx_activities REPLICA IDENTITY FULL;

-- RLS
ALTER TABLE public.rtx_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own activities"
    ON public.rtx_activities FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Database Functions (RPC)

-- Claim Task
CREATE OR REPLACE FUNCTION rtx_fn_claim_task(target_task_id UUID, machine_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  updated_rows INT;
BEGIN
  UPDATE public.rtx_activities
  SET status = 'claimed', locked_by = machine_id, locked_at = now()
  WHERE id = target_task_id 
    AND (status = 'pending' OR status = 'failed' 
         OR ((status = 'claimed' OR status = 'processing') 
             AND locked_at < now() - INTERVAL '5 minutes'))
    AND NOT (machine_id = ANY(attempted_by));

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END;
$$ LANGUAGE plpgsql;

-- Complete Task
CREATE OR REPLACE FUNCTION rtx_fn_complete_task(target_task_id UUID, result_data JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  updated_rows INT;
BEGIN
  UPDATE public.rtx_activities
  SET status = 'completed', result = result_data, completed_at = now()
  WHERE id = target_task_id AND (status = 'claimed' OR status = 'processing');

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END;
$$ LANGUAGE plpgsql;

-- Fail Task
CREATE OR REPLACE FUNCTION rtx_fn_fail_task(target_task_id UUID, machine_id TEXT, error_msg TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  updated_rows INT;
BEGIN
  UPDATE public.rtx_activities
  SET 
    status = 'failed', 
    error_message = error_msg,
    attempted_by = array_append(attempted_by, machine_id),
    retry_count = retry_count + 1,
    locked_by = NULL,
    locked_at = NULL
  WHERE id = target_task_id;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END;
$$ LANGUAGE plpgsql;

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create cleanup function
CREATE OR REPLACE FUNCTION public.rtx_fn_unlock_stale_locks()
RETURNS void AS $$
BEGIN
  UPDATE public.rtx_activities 
  SET status = 'pending', locked_by = NULL, locked_at = NULL
  WHERE (status = 'claimed' OR status = 'processing')
    AND locked_at < now() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- Avoid conflicts if it exists already, just drop it and recreate
DO $$
BEGIN
  PERFORM cron.unschedule('scavenge-stale-locks');
EXCEPTION WHEN OTHERS THEN
  -- ignore
END $$;
SELECT cron.schedule('scavenge-stale-locks', '* * * * *', 'SELECT public.rtx_fn_unlock_stale_locks();');

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rtx_activities;
