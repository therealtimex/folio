-- Workspace-scope RAG chunks and workspace-aware semantic search.

ALTER TABLE public.document_chunks
    ADD COLUMN IF NOT EXISTS workspace_id UUID;

UPDATE public.document_chunks dc
SET workspace_id = i.workspace_id
FROM public.ingestions i
WHERE dc.workspace_id IS NULL
  AND dc.ingestion_id = i.id;

ALTER TABLE public.document_chunks
    ALTER COLUMN workspace_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_chunks_workspace_id_fkey'
    ) THEN
        ALTER TABLE public.document_chunks
            ADD CONSTRAINT document_chunks_workspace_id_fkey
            FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS document_chunks_workspace_id_idx
    ON public.document_chunks(workspace_id);

CREATE INDEX IF NOT EXISTS document_chunks_workspace_model_scope_idx
    ON public.document_chunks(workspace_id, embedding_provider, embedding_model, vector_dim);

DROP POLICY IF EXISTS "Users can manage their own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Workspace members can read document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Workspace members can insert document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Workspace members can update document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Workspace members can delete document chunks" ON public.document_chunks;

CREATE POLICY "Workspace members can read document chunks"
    ON public.document_chunks FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert document chunks"
    ON public.document_chunks FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());

CREATE POLICY "Workspace members can update document chunks"
    ON public.document_chunks FOR UPDATE
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can delete document chunks"
    ON public.document_chunks FOR DELETE
    USING (public.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION public.search_workspace_documents(
    p_workspace_id UUID,
    p_embedding_provider TEXT,
    p_embedding_model TEXT,
    query_embedding vector,
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 5,
    query_dim int DEFAULT 1536
)
RETURNS TABLE (
    id UUID,
    ingestion_id UUID,
    content TEXT,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF query_dim = 384 THEN
        RETURN QUERY
        SELECT
            dc.id,
            dc.ingestion_id,
            dc.content,
            1 - (dc.embedding::vector(384) <=> query_embedding::vector(384)) AS similarity
        FROM public.document_chunks dc
        WHERE dc.workspace_id = p_workspace_id
          AND dc.embedding_provider = p_embedding_provider
          AND dc.embedding_model = p_embedding_model
          AND dc.vector_dim = 384
          AND 1 - (dc.embedding::vector(384) <=> query_embedding::vector(384)) > match_threshold
        ORDER BY dc.embedding::vector(384) <=> query_embedding::vector(384)
        LIMIT match_count;
    ELSIF query_dim = 768 THEN
        RETURN QUERY
        SELECT
            dc.id,
            dc.ingestion_id,
            dc.content,
            1 - (dc.embedding::vector(768) <=> query_embedding::vector(768)) AS similarity
        FROM public.document_chunks dc
        WHERE dc.workspace_id = p_workspace_id
          AND dc.embedding_provider = p_embedding_provider
          AND dc.embedding_model = p_embedding_model
          AND dc.vector_dim = 768
          AND 1 - (dc.embedding::vector(768) <=> query_embedding::vector(768)) > match_threshold
        ORDER BY dc.embedding::vector(768) <=> query_embedding::vector(768)
        LIMIT match_count;
    ELSIF query_dim = 1536 THEN
        RETURN QUERY
        SELECT
            dc.id,
            dc.ingestion_id,
            dc.content,
            1 - (dc.embedding::vector(1536) <=> query_embedding::vector(1536)) AS similarity
        FROM public.document_chunks dc
        WHERE dc.workspace_id = p_workspace_id
          AND dc.embedding_provider = p_embedding_provider
          AND dc.embedding_model = p_embedding_model
          AND dc.vector_dim = 1536
          AND 1 - (dc.embedding::vector(1536) <=> query_embedding::vector(1536)) > match_threshold
        ORDER BY dc.embedding::vector(1536) <=> query_embedding::vector(1536)
        LIMIT match_count;
    ELSE
        RETURN QUERY
        SELECT
            dc.id,
            dc.ingestion_id,
            dc.content,
            1 - (dc.embedding <=> query_embedding) AS similarity
        FROM public.document_chunks dc
        WHERE dc.workspace_id = p_workspace_id
          AND dc.embedding_provider = p_embedding_provider
          AND dc.embedding_model = p_embedding_model
          AND dc.vector_dim = query_dim
          AND 1 - (dc.embedding <=> query_embedding) > match_threshold
        ORDER BY dc.embedding <=> query_embedding
        LIMIT match_count;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.search_workspace_documents
    IS 'Performs cosine similarity search against document chunks scoped to a workspace.';
