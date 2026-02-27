-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Document chunks table for Semantic Search (RAG)
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ingestion_id UUID NOT NULL REFERENCES ingestions(id) ON DELETE CASCADE,
    
    -- Content
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL, -- To detect duplicates
    embedding_provider TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    
    -- Unconstrained Vector Embedding
    -- By not defining the dimension (e.g. vector(1536)), we allow multiple 
    -- embedding models to coexist in the same table seamlessly.
    embedding vector NOT NULL,
    vector_dim INTEGER NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate chunks for the same document + model identity.
    -- This allows hot-swapping models while keeping each model's vector space isolated.
    UNIQUE(ingestion_id, content_hash, embedding_provider, embedding_model)
);

-- Enable RLS
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own document chunks"
    ON document_chunks
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Advanced Partial Indexes for HNSW
-- We create partial indexes for the most common dimensions to maintain 
-- sub-millisecond search performance while keeping the 'embedding' column unconstrained.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_384_idx 
    ON document_chunks USING hnsw ((embedding::vector(384)) vector_cosine_ops) 
    WHERE (vector_dim = 384);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_768_idx 
    ON document_chunks USING hnsw ((embedding::vector(768)) vector_cosine_ops) 
    WHERE (vector_dim = 768);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_1536_idx 
    ON document_chunks USING hnsw ((embedding::vector(1536)) vector_cosine_ops) 
    WHERE (vector_dim = 1536);

-- Index for fast deletion and lookup by ingestion_id
CREATE INDEX IF NOT EXISTS document_chunks_ingestion_id_idx 
    ON document_chunks(ingestion_id);

CREATE INDEX IF NOT EXISTS document_chunks_user_id_idx 
    ON document_chunks(user_id);

CREATE INDEX IF NOT EXISTS document_chunks_model_scope_idx
    ON document_chunks(user_id, embedding_provider, embedding_model, vector_dim);

-- Dynamic Semantic Search Function
CREATE OR REPLACE FUNCTION search_documents(
    p_user_id UUID,
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
        FROM document_chunks dc
        WHERE dc.user_id = p_user_id
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
        FROM document_chunks dc
        WHERE dc.user_id = p_user_id
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
        FROM document_chunks dc
        WHERE dc.user_id = p_user_id
          AND dc.embedding_provider = p_embedding_provider
          AND dc.embedding_model = p_embedding_model
          AND dc.vector_dim = 1536
          AND 1 - (dc.embedding::vector(1536) <=> query_embedding::vector(1536)) > match_threshold
        ORDER BY dc.embedding::vector(1536) <=> query_embedding::vector(1536)
        LIMIT match_count;
    ELSE
        -- Fallback to unconstrained exact nearest neighbor scan for unindexed dimensions
        RETURN QUERY
        SELECT
            dc.id,
            dc.ingestion_id,
            dc.content,
            1 - (dc.embedding <=> query_embedding) AS similarity
        FROM document_chunks dc
        WHERE dc.user_id = p_user_id
          AND dc.embedding_provider = p_embedding_provider
          AND dc.embedding_model = p_embedding_model
          AND dc.vector_dim = query_dim
          AND 1 - (dc.embedding <=> query_embedding) > match_threshold
        ORDER BY dc.embedding <=> query_embedding
        LIMIT match_count;
    END IF;
END;
$$;

-- Comments
COMMENT ON TABLE document_chunks IS 'Stores semantic text chunks from parsed documents for RAG.';
COMMENT ON COLUMN document_chunks.embedding IS 'Unconstrained vector to support dynamic embedding models.';
COMMENT ON FUNCTION search_documents IS 'Performs dynamic cosine similarity search against unconstrained vectors.';
