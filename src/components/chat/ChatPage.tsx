import { useState, useCallback } from "react";
import { ChatSidebar } from "./ChatSidebar";
import { ChatInterface } from "./ChatInterface";
import { ContextSidebar } from "./ContextSidebar";
import type { RetrievedChunk } from "../../../api/src/services/RAGService";

export interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    context_sources?: RetrievedChunk[];
    created_at: string;
}

export interface Session {
    id: string;
    title: string;
    updated_at: string;
}

export function ChatPage() {
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [contextSources, setContextSources] = useState<RetrievedChunk[]>([]);
    const [isContextVisible, setIsContextVisible] = useState(false);
    const [refreshSidebarTrigger, setRefreshSidebarTrigger] = useState(0);

    const handleSessionCreated = useCallback((id: string) => {
        setActiveSessionId(id);
        setRefreshSidebarTrigger(prev => prev + 1);
    }, []);

    const handleContextUpdate = useCallback((sources: RetrievedChunk[]) => {
        setContextSources(sources);
        if (sources.length > 0) setIsContextVisible(true);
    }, []);

    return (
        <div className="flex w-full h-[calc(100vh-15rem)] min-h-[540px] gap-4 overflow-hidden animate-in fade-in duration-500">
            {/* Left: Sessions */}
            <div className="w-64 shrink-0 flex flex-col h-full bg-surface/25 backdrop-blur-xl border border-border rounded-xl overflow-hidden shadow-sm">
                <ChatSidebar
                    activeSessionId={activeSessionId}
                    onSelectSession={setActiveSessionId}
                    refreshTrigger={refreshSidebarTrigger}
                />
            </div>

            {/* Middle: Chat */}
            <div className="flex-1 min-w-0 flex flex-col h-full bg-surface/60 rounded-xl overflow-hidden border border-border relative shadow-sm">
                <ChatInterface
                    sessionId={activeSessionId}
                    onContextUpdate={handleContextUpdate}
                    onSessionCreated={handleSessionCreated}
                />
            </div>

            {/* Right: Context (RAG Sources) */}
            {isContextVisible && (
                <div className="w-80 shrink-0 flex flex-col h-full bg-surface/25 backdrop-blur-xl border border-border rounded-xl overflow-hidden shadow-sm">
                    <ContextSidebar
                        sources={contextSources}
                        onClose={() => setIsContextVisible(false)}
                    />
                </div>
            )}
        </div>
    );
}
