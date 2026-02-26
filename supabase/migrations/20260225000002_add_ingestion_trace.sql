-- Add trace column to ingestions table for full AI Transparency
ALTER TABLE public.ingestions ADD COLUMN IF NOT EXISTS trace JSONB DEFAULT '[]'::jsonb;
