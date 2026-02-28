import { useEffect, useState, useRef, type ReactNode } from "react";
import { Minimize2, Terminal as TerminalIcon, ShieldAlert, Cpu, Activity, Play, CheckCircle2, Brain, FileDigit, Settings2 } from "lucide-react";
import { getSupabaseClient } from "../lib/supabase-config";
import { useTerminal } from "../context/TerminalContext";

type EventType = 'info' | 'analysis' | 'action' | 'error';
export type ProcessingEvent = {
    id: string;
    ingestion_id?: string;
    event_type: EventType;
    agent_state: string;
    details: any;
    created_at: string;
};

type ErrorRemediationLink = {
    label: string;
    url: string;
};

type ErrorRemediation = {
    title?: string;
    summary?: string;
    code?: string;
    steps: string[];
    links: ErrorRemediationLink[];
};

const URL_PATTERN = /(https?:\/\/[^\s<>"'`]+)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.trim().length === 0) {
        return null;
    }
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function extractRemediation(details: unknown): ErrorRemediation | null {
    if (!isRecord(details) || !isRecord(details.remediation)) {
        return null;
    }

    const remediation = details.remediation;
    const title = typeof remediation.title === "string" ? remediation.title.trim() : "";
    const summary = typeof remediation.summary === "string" ? remediation.summary.trim() : "";
    const code = typeof remediation.code === "string" ? remediation.code.trim() : "";

    const steps = Array.isArray(remediation.steps)
        ? remediation.steps
            .filter((step): step is string => typeof step === "string")
            .map((step) => step.trim())
            .filter(Boolean)
        : [];

    const links = Array.isArray(remediation.links)
        ? remediation.links
            .filter(isRecord)
            .map((link) => {
                const url = normalizeUrl(link.url);
                if (!url) return null;
                const label = typeof link.label === "string" && link.label.trim().length > 0
                    ? link.label.trim()
                    : "Open help link";
                return { label, url };
            })
            .filter((link): link is ErrorRemediationLink => link !== null)
        : [];

    if (!title && !summary && !code && steps.length === 0 && links.length === 0) {
        return null;
    }

    return {
        ...(title ? { title } : {}),
        ...(summary ? { summary } : {}),
        ...(code ? { code } : {}),
        steps,
        links,
    };
}

function renderTextWithLinks(text: string) {
    const nodes: ReactNode[] = [];
    let cursor = 0;

    for (const match of text.matchAll(URL_PATTERN)) {
        const raw = match[0] ?? "";
        const start = match.index ?? 0;
        const end = start + raw.length;

        if (start > cursor) {
            nodes.push(<span key={`txt-${cursor}-${start}`}>{text.slice(cursor, start)}</span>);
        }

        const url = normalizeUrl(raw);
        if (url) {
            nodes.push(
                <a
                    key={`url-${start}-${url}`}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 decoration-current/50 hover:decoration-current"
                    onClick={(event) => event.stopPropagation()}
                >
                    {url}
                </a>
            );
        } else {
            nodes.push(<span key={`txt-${start}-${end}`}>{raw}</span>);
        }

        cursor = end;
    }

    if (cursor < text.length) {
        nodes.push(<span key={`txt-${cursor}-${text.length}`}>{text.slice(cursor)}</span>);
    }

    return nodes.length > 0 ? <>{nodes}</> : text;
}

export function LiveTerminal() {
    const supabase = getSupabaseClient();
    const { isExpanded, openTerminal, closeTerminal } = useTerminal();

    // We want the newest events FIRST in the array
    const [events, setEvents] = useState<ProcessingEvent[]>([]);
    const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
    const [isSyncing, setIsSyncing] = useState(false);

    // Track if we should auto-scroll (we actually don't need to auto-scroll if newest is at the top)
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Initial load & Subscription
    useEffect(() => {
        let mounted = true;

        const loadRecentEvents = async () => {
            if (!supabase) return;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase
                .from('processing_events')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50);

            if (data && mounted) {
                setEvents(data);
                // Also auto-expand true errors
                const initialExpanded = new Set<string>();
                data.forEach((e: ProcessingEvent) => {
                    if (e.event_type === 'error' && e.details?.error) {
                        initialExpanded.add(e.id);
                    }
                });
                setExpandedErrors(initialExpanded);
            }
        };

        const setupSubscription = async () => {
            if (!supabase) return null;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;

            return supabase
                .channel('processing_events_realtime')
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'processing_events',
                        filter: `user_id=eq.${user.id}`
                    },
                    (payload: any) => {
                        const newEvent = payload.new as ProcessingEvent;
                        if (!mounted) return;

                        if (newEvent.event_type === 'error' && newEvent.details?.error) {
                            setExpandedErrors(prev => new Set(prev).add(newEvent.id));
                        }

                        if (!newEvent.details?.is_completion) {
                            openTerminal();
                        }

                        setEvents((prev) => {
                            // Insert at the beginning (descending order)
                            const updated = [newEvent, ...prev];

                            // Auto-collapse logic after explicit completion events.
                            if (newEvent.details?.is_completion) {
                                setTimeout(() => {
                                    if (mounted) closeTerminal();
                                }, 3000);
                            }

                            if (updated.length > 100) return updated.slice(0, 100);
                            return updated;
                        });

                        setIsSyncing(true);
                        setTimeout(() => setIsSyncing(false), 500);
                    }
                )
                .subscribe();
        };

        loadRecentEvents();
        const subPromise = setupSubscription();

        return () => {
            mounted = false;
            subPromise.then(channel => {
                if (channel && supabase) supabase.removeChannel(channel);
            });
        };
    }, [supabase, openTerminal, closeTerminal]);


    // Toggle error details
    const toggleError = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedErrors(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // UI Helpers based on event type
    const getEventStyles = (event: ProcessingEvent) => {
        switch (event.event_type) {
            case 'error': return 'border-l-rose-500/50 bg-rose-500/5 text-rose-200';
            case 'action': return 'border-l-indigo-500/50 bg-indigo-500/5 text-indigo-200';
            case 'analysis': return 'border-l-amber-500/50 bg-amber-500/5 text-amber-200';
            default: return 'border-l-emerald-500/30 text-emerald-100 hover:bg-white/5'; // info
        }
    };

    const getAgentIcon = (state: string) => {
        if (!state) return <Activity className="w-3.5 h-3.5" />;
        const s = state.toLowerCase();
        if (s.includes('triage')) return <FileDigit className="w-3.5 h-3.5" />;
        if (s.includes('extraction')) return <Brain className="w-3.5 h-3.5" />;
        if (s.includes('matching')) return <Settings2 className="w-3.5 h-3.5" />;
        if (s.includes('action')) return <Play className="w-3.5 h-3.5" />;
        if (s.includes('completed')) return <CheckCircle2 className="w-3.5 h-3.5" />;
        if (s.includes('error')) return <ShieldAlert className="w-3.5 h-3.5" />;
        return <Cpu className="w-3.5 h-3.5" />;
    };

    const getAgentStateLabel = (state: string) => {
        return state || 'System';
    };

    const formatMessage = (event: ProcessingEvent): string => {
        const direct = event.details?.action || event.details?.error;
        if (typeof direct === "string" && direct.trim().length > 0) {
            return direct;
        }

        const serialized = JSON.stringify(event.details);
        if (typeof serialized === "string" && serialized.trim().length > 0) {
            return serialized;
        }

        return "Event received.";
    };


    if (!isExpanded) {
        return (
            <button
                type="button"
                className={`fixed bottom-4 right-4 z-50 bg-[#0A0D14] border border-white/10 rounded-full py-2 px-4 shadow-xl flex items-center gap-3 cursor-pointer transition-all hover:bg-[#11141D] hover:border-white/20`}
                onClick={openTerminal}
            >
                <div className="relative">
                    <TerminalIcon className={`w-4 h-4 ${isSyncing ? 'text-emerald-400' : 'text-zinc-400'}`} />
                    {isSyncing && (
                        <div className="absolute inset-0 bg-emerald-400/20 blur-sm rounded-full animate-pulse" />
                    )}
                </div>
                <div className="flex flex-col">
                    <span className="text-xs font-medium text-zinc-200">Live Trace</span>
                    <span className="text-[10px] text-zinc-500 leading-none mt-0.5">
                        {events.length > 0 ? getAgentStateLabel(events[0].agent_state) : 'Idle'}
                    </span>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.5)] ml-1" />
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 w-[450px] bg-[#0A0D14] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-out h-[600px] max-h-[85vh]">

            {/* Header */}
            <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <TerminalIcon className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-semibold text-sm text-zinc-100 uppercase tracking-widest">Live Trace</h3>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 ml-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-500/50'}`} />
                        <span className="text-[9px] font-medium text-emerald-400/80 uppercase tracking-widest">
                            {isSyncing ? 'Streaming' : 'Connected'}
                        </span>
                    </div>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); closeTerminal(); }}
                    className="p-1.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-colors"
                >
                    <Minimize2 className="w-4 h-4" />
                </button>
            </div>

            {/* Logs Area */}
            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs flex flex-col gap-1.5 custom-scrollbar bg-[#05070A]">
                {events.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-zinc-500 flex-col gap-2">
                        <Activity className="w-6 h-6 opacity-20" />
                        <span className="text-sm">Waiting for ingestion events...</span>
                    </div>
                ) : (
                    events.map((event) => {
                        const isErrOpen = expandedErrors.has(event.id);
                        const remediation = extractRemediation(event.details);

                        return (
                            <div
                                key={event.id}
                                className={`border-l-2 pl-3 py-2 pr-2 rounded-r-md transition-colors ${getEventStyles(event)}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="shrink-0 pt-0.5 opacity-60">
                                        {getAgentIcon(event.agent_state)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] opacity-50 shrink-0">
                                                {new Date(event.created_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </span>
                                            <span className="text-[10px] font-bold tracking-wider uppercase opacity-80 shrink-0">
                                                {getAgentStateLabel(event.agent_state)}
                                            </span>
                                            {event.ingestion_id && (
                                                <span className="text-[10px] text-zinc-500 truncate ml-auto uppercase" title={event.ingestion_id}>
                                                    {event.ingestion_id.substring(0, 8)}
                                                </span>
                                            )}
                                        </div>

                                        <div className="leading-relaxed break-words whitespace-pre-wrap">
                                            {renderTextWithLinks(formatMessage(event))}
                                        </div>

                                        {event.event_type === "error" && remediation && (
                                            <div className="mt-2 rounded border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-100 space-y-1.5">
                                                <p className="font-semibold uppercase tracking-wider text-[9px] text-amber-200">Suggested Fix</p>
                                                {remediation.title && (
                                                    <p className="font-semibold text-amber-100">{renderTextWithLinks(remediation.title)}</p>
                                                )}
                                                {remediation.summary && (
                                                    <p className="text-amber-100/90">{renderTextWithLinks(remediation.summary)}</p>
                                                )}
                                                {remediation.code && (
                                                    <p className="text-amber-200/90">Code: {remediation.code}</p>
                                                )}
                                                {remediation.steps.length > 0 && (
                                                    <ol className="list-decimal pl-4 space-y-1 text-amber-100/90">
                                                        {remediation.steps.map((step) => (
                                                            <li key={`${event.id}-fix-step-${step}-${step.length}`}>{renderTextWithLinks(step)}</li>
                                                        ))}
                                                    </ol>
                                                )}
                                                {remediation.links.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                                                        {remediation.links.map((link) => (
                                                            <a
                                                                key={`${event.id}-fix-link-${link.url}`}
                                                                href={link.url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="inline-flex items-center rounded border border-amber-300/40 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-amber-100 hover:bg-amber-300/10"
                                                                onClick={(eventClick) => eventClick.stopPropagation()}
                                                            >
                                                                {link.label}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Action / Error Details Block */}
                                        {event.event_type !== 'info' && event.details && Object.keys(event.details).length > (event.details.action ? 1 : 0) && (
                                            <div className="mt-2 text-[10px]">
                                                {event.event_type === 'error' ? (
                                                    <div className="bg-rose-950/30 rounded border border-rose-500/20 overflow-hidden">
                                                        <button
                                                            className="w-full text-left px-2 py-1 flex justify-between items-center hover:bg-rose-500/10 text-rose-300 font-semibold uppercase tracking-wider text-[9px]"
                                                            onClick={(e) => toggleError(event.id, e)}
                                                        >
                                                            <span>Error Details</span>
                                                            <span className="opacity-50">{isErrOpen ? 'Hide' : 'Show'}</span>
                                                        </button>
                                                        {isErrOpen && (
                                                            <pre className="p-2 border-t border-rose-500/20 overflow-x-auto text-rose-200/80 custom-scrollbar">
                                                                {JSON.stringify(event.details, null, 2)}
                                                            </pre>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="bg-black/20 rounded border border-white/5 p-2 overflow-x-auto text-white/50 custom-scrollbar">
                                                        <pre>
                                                            {JSON.stringify(
                                                                Object.fromEntries(Object.entries(event.details).filter(([k]) => k !== 'action')),
                                                                null, 2
                                                            )}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
                {/* Sentinel for auto-scroll if we used standard sorting */}
                <div ref={logsEndRef} className="h-4 shrink-0" />
            </div>

            {/* Input Area (Mock) */}
            <div className="shrink-0 p-3 bg-white/5 border-t border-white/10 flex items-center gap-2 text-zinc-500 text-xs">
                <span className="text-emerald-500/50 font-bold">➜</span>
                <span className="animate-pulse">_</span>
            </div>
        </div>
    );
}
