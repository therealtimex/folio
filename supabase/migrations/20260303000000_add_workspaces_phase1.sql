-- Phase 1 multi-user foundations:
-- - Introduce workspaces + workspace_members
-- - Scope policies, ingestions, and policy learning feedback by workspace_id
-- - Keep user_id for actor/audit trails and backward compatibility

-- ---------------------------------------------------------------------------
-- Workspace primitives
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_id_status_idx
    ON public.workspace_members(user_id, status);

CREATE INDEX IF NOT EXISTS workspace_members_workspace_id_status_idx
    ON public.workspace_members(workspace_id, status);

DROP TRIGGER IF EXISTS workspaces_updated_at ON public.workspaces;
CREATE TRIGGER workspaces_updated_at
    BEFORE UPDATE ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS workspace_members_updated_at ON public.workspace_members;
CREATE TRIGGER workspace_members_updated_at
    BEFORE UPDATE ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read workspaces" ON public.workspaces;
CREATE POLICY "Members can read workspaces"
    ON public.workspaces FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.workspace_members wm
            WHERE wm.workspace_id = workspaces.id
              AND wm.user_id = auth.uid()
              AND wm.status = 'active'
        )
    );

DROP POLICY IF EXISTS "Users can create owned workspaces" ON public.workspaces;
CREATE POLICY "Users can create owned workspaces"
    ON public.workspaces FOR INSERT
    WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can update workspaces" ON public.workspaces;
CREATE POLICY "Admins can update workspaces"
    ON public.workspaces FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM public.workspace_members wm
            WHERE wm.workspace_id = workspaces.id
              AND wm.user_id = auth.uid()
              AND wm.status = 'active'
              AND wm.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners can delete workspaces" ON public.workspaces;
CREATE POLICY "Owners can delete workspaces"
    ON public.workspaces FOR DELETE
    USING (
        EXISTS (
            SELECT 1
            FROM public.workspace_members wm
            WHERE wm.workspace_id = workspaces.id
              AND wm.user_id = auth.uid()
              AND wm.status = 'active'
              AND wm.role = 'owner'
        )
    );

DROP POLICY IF EXISTS "Users can read their workspace memberships" ON public.workspace_members;
CREATE POLICY "Users can read their workspace memberships"
    ON public.workspace_members FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their workspace memberships" ON public.workspace_members;
CREATE POLICY "Users can manage their workspace memberships"
    ON public.workspace_members FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_workspace_member(
    p_workspace_id UUID,
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = p_user_id
          AND wm.status = 'active'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Backfill one default workspace per existing user
-- ---------------------------------------------------------------------------

WITH users_without_workspace AS (
    SELECT u.id AS user_id
    FROM auth.users u
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.user_id = u.id
          AND wm.status = 'active'
    )
)
INSERT INTO public.workspaces (name, owner_user_id)
SELECT
    COALESCE(
        NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
        NULLIF(SPLIT_PART(COALESCE(u.email, ''), '@', 1), ''),
        'Workspace'
    ) || '''s Workspace',
    uw.user_id
FROM users_without_workspace uw
JOIN auth.users u ON u.id = uw.user_id
LEFT JOIN public.profiles p ON p.id = uw.user_id;

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
SELECT w.id, w.owner_user_id, 'owner', 'active'
FROM public.workspaces w
WHERE NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = w.id
      AND wm.user_id = w.owner_user_id
);

-- ---------------------------------------------------------------------------
-- Workspace scoping columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE public.ingestions ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE public.policy_match_feedback ADD COLUMN IF NOT EXISTS workspace_id UUID;

WITH user_primary_workspace AS (
    SELECT DISTINCT ON (wm.user_id)
        wm.user_id,
        wm.workspace_id
    FROM public.workspace_members wm
    WHERE wm.status = 'active'
    ORDER BY
        wm.user_id,
        CASE wm.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            ELSE 2
        END,
        wm.created_at,
        wm.workspace_id
)
UPDATE public.policies p
SET workspace_id = upw.workspace_id
FROM user_primary_workspace upw
WHERE p.workspace_id IS NULL
  AND p.user_id = upw.user_id;

WITH user_primary_workspace AS (
    SELECT DISTINCT ON (wm.user_id)
        wm.user_id,
        wm.workspace_id
    FROM public.workspace_members wm
    WHERE wm.status = 'active'
    ORDER BY
        wm.user_id,
        CASE wm.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            ELSE 2
        END,
        wm.created_at,
        wm.workspace_id
)
UPDATE public.ingestions i
SET workspace_id = upw.workspace_id
FROM user_primary_workspace upw
WHERE i.workspace_id IS NULL
  AND i.user_id = upw.user_id;

UPDATE public.policy_match_feedback pmf
SET workspace_id = i.workspace_id
FROM public.ingestions i
WHERE pmf.workspace_id IS NULL
  AND pmf.ingestion_id = i.id;

WITH user_primary_workspace AS (
    SELECT DISTINCT ON (wm.user_id)
        wm.user_id,
        wm.workspace_id
    FROM public.workspace_members wm
    WHERE wm.status = 'active'
    ORDER BY
        wm.user_id,
        CASE wm.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            ELSE 2
        END,
        wm.created_at,
        wm.workspace_id
)
UPDATE public.policy_match_feedback pmf
SET workspace_id = upw.workspace_id
FROM user_primary_workspace upw
WHERE pmf.workspace_id IS NULL
  AND pmf.user_id = upw.user_id;

ALTER TABLE public.policies
    ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.ingestions
    ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.policy_match_feedback
    ALTER COLUMN workspace_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'policies_workspace_id_fkey'
    ) THEN
        ALTER TABLE public.policies
            ADD CONSTRAINT policies_workspace_id_fkey
            FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ingestions_workspace_id_fkey'
    ) THEN
        ALTER TABLE public.ingestions
            ADD CONSTRAINT ingestions_workspace_id_fkey
            FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'policy_match_feedback_workspace_id_fkey'
    ) THEN
        ALTER TABLE public.policy_match_feedback
            ADD CONSTRAINT policy_match_feedback_workspace_id_fkey
            FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE public.policies
    DROP CONSTRAINT IF EXISTS policies_user_id_policy_id_key;

ALTER TABLE public.policies
    DROP CONSTRAINT IF EXISTS policies_workspace_id_policy_id_key;

ALTER TABLE public.policies
    ADD CONSTRAINT policies_workspace_id_policy_id_key UNIQUE (workspace_id, policy_id);

ALTER TABLE public.policy_match_feedback
    DROP CONSTRAINT IF EXISTS policy_match_feedback_user_id_ingestion_id_policy_id_key;

ALTER TABLE public.policy_match_feedback
    DROP CONSTRAINT IF EXISTS policy_match_feedback_workspace_id_ingestion_id_policy_id_key;

ALTER TABLE public.policy_match_feedback
    ADD CONSTRAINT policy_match_feedback_workspace_id_ingestion_id_policy_id_key
    UNIQUE (workspace_id, ingestion_id, policy_id);

CREATE INDEX IF NOT EXISTS policies_workspace_id_priority_idx
    ON public.policies(workspace_id, priority DESC);

CREATE INDEX IF NOT EXISTS ingestions_workspace_id_created_at_idx
    ON public.ingestions(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestions_workspace_file_hash
    ON public.ingestions(workspace_id, file_hash)
    WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS policy_match_feedback_workspace_policy_idx
    ON public.policy_match_feedback(workspace_id, policy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS policy_match_feedback_workspace_created_idx
    ON public.policy_match_feedback(workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Update RLS for workspace-scoped tables
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can read own policies" ON public.policies;
DROP POLICY IF EXISTS "Users can insert own policies" ON public.policies;
DROP POLICY IF EXISTS "Users can update own policies" ON public.policies;
DROP POLICY IF EXISTS "Users can delete own policies" ON public.policies;
DROP POLICY IF EXISTS "Workspace members can read policies" ON public.policies;
DROP POLICY IF EXISTS "Workspace members can insert policies" ON public.policies;
DROP POLICY IF EXISTS "Workspace members can update policies" ON public.policies;
DROP POLICY IF EXISTS "Workspace members can delete policies" ON public.policies;

CREATE POLICY "Workspace members can read policies"
    ON public.policies FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert policies"
    ON public.policies FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());

CREATE POLICY "Workspace members can update policies"
    ON public.policies FOR UPDATE
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can delete policies"
    ON public.policies FOR DELETE
    USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can manage their own ingestions" ON public.ingestions;
DROP POLICY IF EXISTS "Workspace members can read ingestions" ON public.ingestions;
DROP POLICY IF EXISTS "Workspace members can insert ingestions" ON public.ingestions;
DROP POLICY IF EXISTS "Workspace members can update ingestions" ON public.ingestions;
DROP POLICY IF EXISTS "Workspace members can delete ingestions" ON public.ingestions;

CREATE POLICY "Workspace members can read ingestions"
    ON public.ingestions FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert ingestions"
    ON public.ingestions FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());

CREATE POLICY "Workspace members can update ingestions"
    ON public.ingestions FOR UPDATE
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can delete ingestions"
    ON public.ingestions FOR DELETE
    USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can read own policy match feedback" ON public.policy_match_feedback;
DROP POLICY IF EXISTS "Users can insert own policy match feedback" ON public.policy_match_feedback;
DROP POLICY IF EXISTS "Users can update own policy match feedback" ON public.policy_match_feedback;
DROP POLICY IF EXISTS "Users can delete own policy match feedback" ON public.policy_match_feedback;
DROP POLICY IF EXISTS "Workspace members can read policy match feedback" ON public.policy_match_feedback;
DROP POLICY IF EXISTS "Workspace members can insert policy match feedback" ON public.policy_match_feedback;
DROP POLICY IF EXISTS "Workspace members can update policy match feedback" ON public.policy_match_feedback;
DROP POLICY IF EXISTS "Workspace members can delete policy match feedback" ON public.policy_match_feedback;

CREATE POLICY "Workspace members can read policy match feedback"
    ON public.policy_match_feedback FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert policy match feedback"
    ON public.policy_match_feedback FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());

CREATE POLICY "Workspace members can update policy match feedback"
    ON public.policy_match_feedback FOR UPDATE
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can delete policy match feedback"
    ON public.policy_match_feedback FOR DELETE
    USING (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Ensure new auth users automatically get a default workspace + membership
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public'
AS $$
DECLARE
  should_be_admin BOOLEAN;
  workspace_name TEXT;
  created_workspace_id UUID;
BEGIN
  -- Serialize first-user admin assignment and profile bootstrap.
  PERFORM pg_advisory_xact_lock(602240003);

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.is_admin = true
  )
  INTO should_be_admin;

  INSERT INTO public.profiles (id, first_name, last_name, email, is_admin)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name',
    NEW.email,
    should_be_admin
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
    email = EXCLUDED.email,
    updated_at = NOW();

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  workspace_name := COALESCE(
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'first_name', '') || ' ' || COALESCE(NEW.raw_user_meta_data ->> 'last_name', '')), ''),
    NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), ''),
    'Workspace'
  ) || '''s Workspace';

  INSERT INTO public.workspaces (name, owner_user_id)
  VALUES (workspace_name, NEW.id)
  RETURNING id INTO created_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (created_workspace_id, NEW.id, 'owner', 'active')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
  SET
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    updated_at = NOW();

  RETURN NEW;
END;
$$;
