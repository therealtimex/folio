import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "../Toast";
import { MessageBubble } from "./MessageBubble";
import { api } from "../../lib/api";
import type { Message } from "./ChatPage";
import type { RetrievedChunk } from "../../../api/src/services/RAGService";
import { motion, AnimatePresence } from "framer-motion";
import { getSupabaseClient } from "../../lib/supabase-config";

interface ChatInterfaceProps {
    sessionId: string | null;
    onContextUpdate: (sources: RetrievedChunk[]) => void;
    onSessionCreated: (id: string) => void;
}

function readApiError(error: unknown): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return "Request failed";
}

export function ChatInterface({ sessionId, onContextUpdate, onSessionCreated }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const shouldAutoScrollRef = useRef(true);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const activeFetchSessionRef = useRef<string | null>(null);
    const skipNextSessionHydrationRef = useRef<string | null>(null);

    const getAccessToken = useCallback(async (): Promise<string | null> => {
        const supabase = getSupabaseClient();
        if (!supabase) return null;
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
    }, []);

    const fetchMessages = useCallback(async (sid: string) => {
        try {
            const token = await getAccessToken();
            if (!token) {
                throw new Error("Authentication required");
            }

            const res = await api.getChatMessages(sid, token);
            if (res.error) {
                throw new Error(readApiError(res.error));
            }

            if (res.data?.success && activeFetchSessionRef.current === sid) {
                setMessages(res.data.messages as Message[]);

                const allSources = res.data.messages
                    .filter((m) => m.role === "assistant" && Array.isArray(m.context_sources))
                    .flatMap((m) => m.context_sources ?? []);

                onContextUpdate(allSources as RetrievedChunk[]);
            }
        } catch (e) {
            console.error("Failed to fetch messages", e);
            toast.error("Failed to load chat history");
        } finally {
            if (activeFetchSessionRef.current === sid) {
                setLoadingMessages(false);
            }
        }
    }, [getAccessToken, onContextUpdate]);

    // Load messages when session changes
    useEffect(() => {
        if (sessionId) {
            if (skipNextSessionHydrationRef.current === sessionId) {
                skipNextSessionHydrationRef.current = null;
                setLoadingMessages(false);
                return;
            }

            setMessages([]);
            setLoadingMessages(true);
            activeFetchSessionRef.current = sessionId;
            void fetchMessages(sessionId);
        } else {
            setMessages([]);
            setLoadingMessages(false);
            onContextUpdate([]);
            activeFetchSessionRef.current = null;
        }
    }, [sessionId, fetchMessages, onContextUpdate]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (!shouldAutoScrollRef.current) return;
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, isThinking]);

    const handleScroll = () => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldAutoScrollRef.current = distanceFromBottom < 64;
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || isLoading) return;

        const userContent = input.trim();
        setInput("");

        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
        }

        setIsLoading(true);
        setIsThinking(true);

        try {
            const token = await getAccessToken();
            if (!token) {
                throw new Error("Authentication required");
            }

            // Optimistic rendering
            const tempUserMsg: Message = {
                id: "temp-" + Date.now(),
                role: "user",
                content: userContent,
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, tempUserMsg]);

            let currentSessionId = sessionId;

            // Create new session lazily
            if (!currentSessionId) {
                const res = await api.createChatSession(token);
                if (res.error) {
                    throw new Error(readApiError(res.error));
                }

                if (res.data?.success) {
                    currentSessionId = res.data.session.id;
                    skipNextSessionHydrationRef.current = currentSessionId;
                    onSessionCreated(currentSessionId);
                } else {
                    throw new Error("Failed to create session");
                }
            }

            // Backend Call
            const res = await api.sendChatMessage({
                sessionId: currentSessionId,
                content: userContent
            }, token);

            if (res.error) {
                throw new Error(readApiError(res.error));
            }

            const aiMessage = res.data?.message;
            if (res.data?.success && aiMessage) {
                setMessages(prev => [...prev, aiMessage as Message]);
                if (aiMessage.context_sources && aiMessage.context_sources.length > 0) {
                    onContextUpdate(aiMessage.context_sources as RetrievedChunk[]);
                }
            }
        } catch (error) {
            console.error("Message failed", error);
            toast.error(readApiError(error) || "Failed to send message");
            setMessages(prev => [...prev, {
                id: "err-" + Date.now(),
                role: "assistant",
                content: "I encountered an error trying to process that request.",
                created_at: new Date().toISOString()
            }]);
        } finally {
            setIsLoading(false);
            setIsThinking(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const suggestions = [
        "Find me the latest invoice from AWS.",
        "What is the late penalty on the ACME contract?",
        "Show me receipts from last week.",
        "Summarize my recent cloud hosting expenses."
    ];

    return (
        <>
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-on-hover"
            >
                {loadingMessages ? (
                    <div className="flex-1 h-full flex items-center justify-center text-muted-foreground gap-2">
                        <RefreshCw size={18} className="animate-spin" />
                        <span className="text-sm">Loading history...</span>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground/80">
                        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 text-primary">
                            <Sparkles size={32} />
                        </div>
                        <h3 className="text-2xl font-bold mb-3 text-foreground tracking-tight">Chat with your Documents</h3>
                        <p className="text-sm max-w-sm mx-auto mb-10 leading-relaxed">
                            Folio has seamlessly read and memorized your files using Semantic Search. Ask any question to retrieve precise answers and exact page citations.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-lg w-full">
                            {suggestions.map((s, i) => (
                                <button
                                    key={i}
                                    onClick={() => setInput(s)}
                                    className="text-left p-3.5 text-xs font-medium bg-surface/30 hover:bg-surface border border-border/50 hover:border-border rounded-xl transition-all cursor-pointer shadow-sm hover:shadow"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {messages.map((msg) => (
                            <MessageBubble key={msg.id} message={msg} />
                        ))}

                        <AnimatePresence>
                            {isThinking && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                    className="flex justify-start w-full"
                                >
                                    <div className="bg-surface border border-border/50 rounded-2xl rounded-tl-none px-4 py-3.5 flex items-center gap-3 shadow-sm">
                                        <div className="flex gap-1.5">
                                            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0s" }} />
                                            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }} />
                                            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-surface/40 backdrop-blur-xl border-t border-border/50">
                <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto">
                    <div className="relative flex items-end gap-2 bg-surface/80 border border-border/60 hover:border-border rounded-2xl px-3 py-2 shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                e.target.style.height = "auto";
                                e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="Message Folio AI..."
                            rows={1}
                            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none py-2.5 pl-1 text-sm text-foreground resize-none min-h-[44px] max-h-[200px] placeholder:text-muted-foreground/50"
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="p-2.5 mb-1 bg-primary text-primary-foreground rounded-xl shadow-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 cursor-pointer"
                        >
                            {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
}
