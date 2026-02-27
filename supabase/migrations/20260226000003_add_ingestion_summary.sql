-- Add AI-generated prose summary column to ingestions.
-- Populated on first modal open, cleared when a re-run resets extraction.
ALTER TABLE public.ingestions
    ADD COLUMN IF NOT EXISTS summary text NULL;
