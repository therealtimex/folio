-- Tighten chat message authorization to require ownership of both the row user_id
-- and the referenced session. This prevents cross-session inserts/selects.
DROP POLICY IF EXISTS "Users can manage their own chat messages" ON chat_messages;

CREATE POLICY "Users can manage their own chat messages"
    ON chat_messages
    FOR ALL
    USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM chat_sessions cs
            WHERE cs.id = chat_messages.session_id
              AND cs.user_id = auth.uid()
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM chat_sessions cs
            WHERE cs.id = chat_messages.session_id
              AND cs.user_id = auth.uid()
        )
    );
