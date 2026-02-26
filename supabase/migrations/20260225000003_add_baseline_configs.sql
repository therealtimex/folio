-- Versioned baseline extraction configuration per user.
-- Each row is immutable once referenced by an ingestion record,
-- enabling full auditability of which prompt config produced each extraction.

CREATE TABLE public.baseline_configs (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version    integer     NOT NULL,
  context    text        NULL,           -- free-text injected into the extraction system prompt
  fields     jsonb       NOT NULL DEFAULT '[]', -- array of BaselineField definitions
  is_active  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT baseline_configs_pkey            PRIMARY KEY (id),
  CONSTRAINT baseline_configs_user_version_key UNIQUE (user_id, version)
);

-- Fast lookup of a user's active config
CREATE INDEX idx_baseline_configs_user_active
  ON public.baseline_configs (user_id, is_active);

-- RLS
ALTER TABLE public.baseline_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own baseline configs"
  ON public.baseline_configs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Record which config version produced each ingestion's extraction.
-- NULL means the ingestion was processed before this feature existed
-- or that the default built-in fields were used.
ALTER TABLE public.ingestions
  ADD COLUMN baseline_config_id uuid NULL
    REFERENCES public.baseline_configs(id) ON DELETE SET NULL;
