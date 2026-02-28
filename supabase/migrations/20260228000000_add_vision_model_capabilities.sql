-- Migration: Persist learned vision capability state per user model
-- Created: 2026-02-28

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS vision_model_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_settings.vision_model_capabilities IS
'Learned VLM capability map keyed by provider:model with state/TTL metadata.';
