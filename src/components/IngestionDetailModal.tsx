import { useCallback } from "react";
import {
    X,
    RefreshCw,
    CheckCircle2,
    XCircle,
    Minus,
    Clock,
    Loader2,
    FileText,
    Sparkles
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import type { Ingestion } from "./FunnelPage";

interface Props {
    ingestion: Ingestion;
    onClose: () => void;
    onRerun: () => Promise<void>;
    onComposePolicy?: (description: string) => void;
}

function StatusIcon({ status }: { status: Ingestion["status"] }) {
    const map = {
        pending: <Clock className="w-4 h-4 text-muted-foreground" />,
        processing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
        matched: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
        no_match: <Minus className="w-4 h-4 text-amber-500" />,
        error: <XCircle className="w-4 h-4 text-destructive" />,
    };
    return map[status] ?? null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">{children}</div>;
}

function buildComposeDescription(ing: Ingestion): string {
    const parts: string[] = [];
    if (ing.status === "no_match") {
        parts.push(`I have a document named "${ing.filename}" that wasn't matched by any policy.`);
    } else {
        parts.push(`I have a document named "${ing.filename}" that matched a policy, but I want to create a better, more specific policy for it.`);
    }

    if (ing.mime_type) parts.push(`It is a ${ing.mime_type} file.`);
    const extracted = ing.extracted ? Object.entries(ing.extracted).filter(([, v]) => v != null) : [];
    if (extracted.length > 0) {
        const fieldSummary = extracted.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
        parts.push(`Partial data already extracted: ${fieldSummary}.`);
    }
    parts.push("Create a policy to handle this exact type of document — infer the document type, define strict match conditions, extract key fields, and route it to an appropriate folder.");
    return parts.join(" ");
}

export function IngestionDetailModal({ ingestion: ing, onClose, onRerun, onComposePolicy }: Props) {
    const extracted = ing.extracted && Object.keys(ing.extracted).length > 0 ? ing.extracted : null;
    const actions = ing.actions_taken?.length ? ing.actions_taken : null;

    const handleBackdrop = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={handleBackdrop}
        >
            <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="font-bold text-sm truncate" title={ing.filename}>{ing.filename}</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {ing.source} · {new Date(ing.created_at).toLocaleString()}
                            {ing.file_size && ` · ${(ing.file_size / 1024).toFixed(1)}KB`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <StatusIcon status={ing.status} />
                        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[60vh]">
                    {/* Policy */}
                    <div>
                        <SectionLabel>Policy Matched</SectionLabel>
                        {ing.policy_name
                            ? <Badge variant="secondary">{ing.policy_name}</Badge>
                            : <span className="text-xs text-muted-foreground">No policy matched</span>}
                    </div>

                    {/* Extracted Data */}
                    {extracted && (
                        <div>
                            <SectionLabel>Extracted Data</SectionLabel>
                            <div className="rounded-xl border overflow-hidden">
                                {Object.entries(extracted).map(([key, val]) => (
                                    <div key={key} className="flex items-center justify-between px-4 py-2 text-xs border-b last:border-0">
                                        <span className="font-mono text-muted-foreground">{key}</span>
                                        <span className="font-medium text-right max-w-[55%] truncate">{String(val)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Actions Taken */}
                    {actions && (
                        <div>
                            <SectionLabel>Actions Taken</SectionLabel>
                            <ul className="space-y-1">
                                {actions.map((a, i) => (
                                    <li key={i} className="flex items-center gap-2 text-xs">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                        <span className="text-muted-foreground">{String(a)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Error */}
                    {ing.error_message && (
                        <div>
                            <SectionLabel>Error</SectionLabel>
                            <div className="rounded-xl bg-destructive/5 border border-destructive/20 px-4 py-3">
                                <p className="text-xs text-destructive font-mono break-all">{ing.error_message}</p>
                            </div>
                        </div>
                    )}

                    {/* No details fallback */}
                    {!extracted && !actions && !ing.error_message && (
                        <p className="text-xs text-muted-foreground text-center py-4">No extracted data or actions recorded.</p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/20">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={onRerun} className="gap-2 rounded-xl">
                            <RefreshCw className="w-3.5 h-3.5" />Re-run
                        </Button>
                        {onComposePolicy && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onComposePolicy(buildComposeDescription(ing))}
                                className="gap-2 rounded-xl border-primary/30 text-primary hover:bg-primary/5 hover:text-primary"
                            >
                                <Sparkles className="w-3.5 h-3.5" />Create Policy
                            </Button>
                        )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={onClose} className="rounded-xl">Close</Button>
                </div>
            </div>
        </div>
    );
}
