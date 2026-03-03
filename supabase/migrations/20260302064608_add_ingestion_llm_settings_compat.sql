-- Compatibility migration for environments where this version was already
-- recorded remotely. This keeps local migration history aligned with remote.
--
-- The operations are intentionally idempotent and mirror the ingestion LLM
-- setting columns introduced in nearby migrations.

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS ingestion_llm_provider TEXT,
ADD COLUMN IF NOT EXISTS ingestion_llm_model TEXT;

COMMENT ON COLUMN public.user_settings.ingestion_llm_provider IS
'Optional provider override for ingestion pipeline (triage, baseline extraction, policy processing). Falls back to llm_provider when null.';

COMMENT ON COLUMN public.user_settings.ingestion_llm_model IS
'Optional model override for ingestion pipeline (triage, baseline extraction, policy processing). Falls back to llm_model when null.';
