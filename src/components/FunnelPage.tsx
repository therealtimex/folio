import { useState, useEffect, useCallback, useRef } from "react";
import {
    Funnel,
    Upload,
    RefreshCw,
    Trash2,
    CheckCircle2,
    XCircle,
    Clock,
    Minus,
    Loader2,
    FileText,
    ChevronRight
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import { api } from "../lib/api";
import { getSupabaseClient } from "../lib/supabase-config";
import { toast } from "./Toast";
import { IngestionDetailModal } from "./IngestionDetailModal";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Ingestion {
    id: string;
    source: string;
    filename: string;
    mime_type?: string;
    file_size?: number;
    status: "pending" | "processing" | "matched" | "no_match" | "error";
    policy_id?: string;
    policy_name?: string;
    extracted?: Record<string, unknown>;
    actions_taken?: string[];
    error_message?: string;
    created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Ingestion["status"] }) {
    const map: Record<Ingestion["status"], { label: string; icon: React.ReactNode; cls: string }> = {
        pending: { label: "Pending", icon: <Clock className="w-3 h-3" />, cls: "bg-muted text-muted-foreground" },
        processing: { label: "Processing", icon: <Loader2 className="w-3 h-3 animate-spin" />, cls: "bg-blue-500/10 text-blue-500" },
        matched: { label: "Matched", icon: <CheckCircle2 className="w-3 h-3" />, cls: "bg-emerald-500/10 text-emerald-500" },
        no_match: { label: "No Match", icon: <Minus className="w-3 h-3" />, cls: "bg-amber-500/10 text-amber-600" },
        error: { label: "Error", icon: <XCircle className="w-3 h-3" />, cls: "bg-destructive/10 text-destructive" },
    };
    const s = map[status] ?? map.pending;
    return (
        <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full", s.cls)}>
            {s.icon}{s.label}
        </span>
    );
}

function SourceBadge({ source }: { source: string }) {
    const icons: Record<string, string> = { upload: "📄", dropzone: "📂", email: "📧", url: "🔗" };
    return <span className="text-xs text-muted-foreground">{icons[source] ?? "📄"} {source}</span>;
}

function fileSize(bytes?: number) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── FunnelPage ───────────────────────────────────────────────────────────────

export function FunnelPage() {
    const [ingestions, setIngestions] = useState<Ingestion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [sessionToken, setSessionToken] = useState<string | null>(null);
    const [selected, setSelected] = useState<Ingestion | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchIngestions = useCallback(async () => {
        setIsLoading(true);
        const resp = await api.getIngestions?.(sessionToken);
        setIngestions(resp?.data?.ingestions ?? []);
        setIsLoading(false);
    }, [sessionToken]);

    useEffect(() => {
        const supabase = getSupabaseClient();
        if (supabase) {
            supabase.auth.getSession().then(({ data }) => {
                setSessionToken(data.session?.access_token ?? null);
            });
        }
    }, []);

    useEffect(() => {
        if (sessionToken !== null) fetchIngestions();
    }, [sessionToken, fetchIngestions]);

    const handleFiles = async (files: FileList | File[]) => {
        const arr = Array.from(files);
        if (!arr.length) return;
        setIsUploading(true);
        try {
            for (const file of arr) {
                toast.info(`Ingesting ${file.name}…`);
                const result = await api.uploadDocument?.(file, sessionToken);
                if (result?.success) {
                    toast.success(`${file.name} → ${result.ingestion?.status}`);
                } else {
                    toast.error(`Failed to ingest ${file.name}`);
                }
            }
            await fetchIngestions();
        } finally {
            setIsUploading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
    };

    const handleRerun = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await api.rerunIngestion?.(id, sessionToken);
        toast.success("Re-running…");
        await fetchIngestions();
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm("Delete this ingestion record?")) return;
        await api.deleteIngestion?.(id, sessionToken);
        toast.success("Deleted.");
        setIngestions((prev) => prev.filter((x) => x.id !== id));
    };

    return (
        <div className="max-w-[1200px] mx-auto px-8 py-10 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Funnel className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">Funnel</h1>
                        <p className="text-xs text-muted-foreground">Document ingestion pipeline</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchIngestions} className="gap-2 rounded-xl">
                        <RefreshCw className="w-3.5 h-3.5" />Refresh
                    </Button>
                    <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="gap-2 rounded-xl">
                        {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        Upload
                    </Button>
                    <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => e.target.files && handleFiles(e.target.files)} />
                </div>
            </div>

            {/* Drop Zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                    "rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-2 py-8",
                    isDragging
                        ? "border-primary bg-primary/5 scale-[1.01]"
                        : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30"
                )}
            >
                <Upload className={cn("w-8 h-8 transition-colors", isDragging ? "text-primary" : "text-muted-foreground/50")} />
                <p className="text-sm text-muted-foreground">
                    {isDragging ? "Drop to ingest" : "Drag & drop files here, or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground/60">.txt, .md, .pdf, .docx — up to 20MB</p>
            </div>

            {/* Table */}
            <div className="rounded-2xl border overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                        <tr>
                            <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">File</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Policy</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Source</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {isLoading ? (
                            <tr>
                                <td colSpan={6} className="text-center py-12 text-muted-foreground">
                                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                                    Loading…
                                </td>
                            </tr>
                        ) : ingestions.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="text-center py-16 text-muted-foreground">
                                    <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
                                    <p className="text-sm">No ingestions yet — upload a document above.</p>
                                </td>
                            </tr>
                        ) : (
                            ingestions.map((ing) => (
                                <tr
                                    key={ing.id}
                                    onClick={() => setSelected(ing)}
                                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                                >
                                    <td className="px-5 py-3.5">
                                        <div className="font-medium text-sm truncate max-w-[220px]" title={ing.filename}>{ing.filename}</div>
                                        {ing.file_size && <div className="text-xs text-muted-foreground">{fileSize(ing.file_size)}</div>}
                                    </td>
                                    <td className="px-4 py-3.5"><StatusBadge status={ing.status} /></td>
                                    <td className="px-4 py-3.5">
                                        {ing.policy_name
                                            ? <Badge variant="secondary" className="text-[10px]">{ing.policy_name}</Badge>
                                            : <span className="text-muted-foreground/50 text-xs">—</span>}
                                    </td>
                                    <td className="px-4 py-3.5"><SourceBadge source={ing.source} /></td>
                                    <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                        {new Date(ing.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="flex items-center gap-1 justify-end">
                                            <button
                                                title="Re-run"
                                                onClick={(e) => handleRerun(ing.id, e)}
                                                className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                                            >
                                                <RefreshCw className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                title="Delete"
                                                onClick={(e) => handleDelete(ing.id, e)}
                                                className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Detail Modal */}
            {selected && (
                <IngestionDetailModal
                    ingestion={selected}
                    onClose={() => setSelected(null)}
                    onRerun={async () => {
                        await api.rerunIngestion?.(selected.id, sessionToken);
                        await fetchIngestions();
                        setSelected(null);
                        toast.success("Re-running ingestion…");
                    }}
                />
            )}
        </div>
    );
}
