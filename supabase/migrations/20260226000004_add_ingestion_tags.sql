-- Add LLM-generated + human-curated tags to ingestions.
-- GIN index enables efficient array-containment queries (e.g. @> '{tax-deductible}').
ALTER TABLE public.ingestions
    ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS ingestions_tags_gin_idx
    ON public.ingestions USING gin(tags);
