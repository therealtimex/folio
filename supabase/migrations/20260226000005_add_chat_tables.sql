-- Chat Sessions Table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    context_sources JSONB DEFAULT '[]'::jsonb, -- Store the RAG chunks used to answer this message
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Policies for chat_sessions
CREATE POLICY "Users can manage their own chat sessions"
    ON chat_sessions
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Policies for chat_messages
CREATE POLICY "Users can manage their own chat messages"
    ON chat_messages
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Indexes for performance
CREATE INDEX IF NOT EXISTS chat_sessions_user_id_idx ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx ON chat_messages(user_id);

-- Trigger to update session updated_at
CREATE OR REPLACE FUNCTION update_chat_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_sessions
    SET updated_at = NOW()
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_chat_session_timestamp
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_chat_session_timestamp();
