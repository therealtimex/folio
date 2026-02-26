import React from "react";
import { X, Terminal } from "lucide-react";
import { Ingestion } from "./FunnelPage";

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{children}</h3>;
}

export function IngestionTraceModal({
    ingestion,
    onClose,
}: {
    ingestion: Ingestion;
    onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-3xl rounded-2xl shadow-xl border overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/20">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                            <Terminal className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div>
                            <h2 className="font-semibold">AI Processing Trace</h2>
                            <p className="text-xs text-muted-foreground truncate max-w-[400px]" title={ingestion.filename}>
                                {ingestion.filename}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-6">
                    {/* AI Trace Terminal */}
                    {ingestion.trace && ingestion.trace.length > 0 ? (
                        <div>
                            <SectionLabel>Execution Log</SectionLabel>
                            <div className="rounded-xl bg-zinc-950 text-emerald-400 p-4 font-mono text-[11px] space-y-3 overflow-x-auto border border-zinc-800 shadow-inner max-h-[60vh] overflow-y-auto">
                                {[...ingestion.trace].reverse().map((t, i) => (
                                    <div key={i} className={`flex gap-3 leading-relaxed ${t.step.startsWith('---') ? 'text-zinc-500 my-4 text-center justify-center' : ''}`}>
                                        {!t.step.startsWith('---') && (
                                            <span className="opacity-40 shrink-0">
                                                {new Date(t.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </span>
                                        )}
                                        <div className={t.step.startsWith('---') ? 'font-bold uppercase tracking-widest' : ''}>
                                            <span className="font-semibold text-zinc-100">{t.step}</span>
                                            {t.details && Object.keys(t.details).length > 0 && (
                                                <pre className="mt-1 flex text-emerald-500/80 whitespace-pre-wrap text-[10px]">
                                                    <span className="select-none opacity-30 mr-2">↳</span>
                                                    {JSON.stringify(t.details, null, 2)}
                                                </pre>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-12 border-2 border-dashed rounded-xl">No trace logs available for this ingestion.</p>
                    )}
                </div>

            </div>
        </div>
    );
}
