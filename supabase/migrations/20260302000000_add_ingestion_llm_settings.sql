-- Separate ingestion model settings from chat model settings.
-- Backward compatibility is handled in application logic by falling back to llm_provider/llm_model.

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS ingestion_llm_provider TEXT,
ADD COLUMN IF NOT EXISTS ingestion_llm_model TEXT;

COMMENT ON COLUMN public.user_settings.ingestion_llm_provider IS
'Optional provider override for ingestion pipeline (triage, baseline extraction, policy processing). Falls back to llm_provider when null.';

COMMENT ON COLUMN public.user_settings.ingestion_llm_model IS
'Optional model override for ingestion pipeline (triage, baseline extraction, policy processing). Falls back to llm_model when null.';
