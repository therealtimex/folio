import { useCallback, useEffect, useState } from "react";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { getSupabaseClient } from "../../lib/supabase-config";
import type { Session } from "./ChatPage";

interface ChatSidebarProps {
    activeSessionId: string | null;
    onSelectSession: (id: string | null) => void;
    refreshTrigger?: number;
}

export function ChatSidebar({ activeSessionId, onSelectSession, refreshTrigger }: ChatSidebarProps) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);

    const getAccessToken = useCallback(async (): Promise<string | null> => {
        const supabase = getSupabaseClient();
        if (!supabase) return null;
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
    }, []);

    const fetchSessions = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const res = await api.getChatSessions(token);
            if (res.data?.success) {
                setSessions(res.data.sessions);
            }
        } catch (e) {
            console.error("Failed to fetch sessions", e);
        } finally {
            setLoading(false);
        }
    }, [getAccessToken]);

    useEffect(() => {
        void fetchSessions();
    }, [fetchSessions, refreshTrigger]);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        try {
            const supabase = await getSupabaseClient();
            if (!supabase) return;
            const { error } = await supabase.from("chat_sessions").delete().eq("id", id);
            if (!error) {
                setSessions(prev => prev.filter(s => s.id !== id));
                if (activeSessionId === id) onSelectSession(null);
            }
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header / New Chat */}
            <div className="p-3 border-b border-border bg-surface/15">
                <button
                    onClick={() => onSelectSession(null)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl transition-all font-semibold text-sm border border-primary/20 cursor-pointer"
                >
                    <Plus size={16} />
                    New Chat
                </button>
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-on-hover">
                {loading ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">Loading...</div>
                ) : sessions.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        <MessageSquare size={24} className="mx-auto opacity-20 mb-2" />
                        <p className="text-xs">No chat history</p>
                    </div>
                ) : (
                    sessions.map(session => (
                        <div
                            key={session.id}
                            onClick={() => onSelectSession(session.id)}
                            className={`group flex items-center justify-between px-3 py-3 rounded-lg cursor-pointer transition-all text-sm ${activeSessionId === session.id
                                ? "bg-primary/15 text-foreground ring-1 ring-primary/30 font-medium"
                                : "text-muted-foreground hover:bg-surface/50 hover:text-foreground"
                                }`}
                        >
                            <div className="flex items-center gap-2.5 overflow-hidden">
                                <MessageSquare size={14} className={activeSessionId === session.id ? "text-primary" : "opacity-50"} />
                                <span className="truncate">{session.title}</span>
                            </div>

                            <button
                                onClick={(e) => handleDelete(e, session.id)}
                                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 hover:text-destructive rounded transition-all"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
