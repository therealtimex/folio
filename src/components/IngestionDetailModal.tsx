import { useState, useEffect, useCallback, useRef } from "react";
import {
    X,
    RefreshCw,
    CheckCircle2,
    XCircle,
    Minus,
    Clock,
    Loader2,
    FileText,
    Sparkles,
    Tag,
    Plus
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import { api } from "../lib/api";
import { getSupabaseClient } from "../lib/supabase-config";
import { tagColor } from "./FunnelPage";
import type { Ingestion } from "./FunnelPage";

interface Props {
    ingestion: Ingestion;
    onClose: () => void;
    onRerun: () => Promise<void>;
    onTagsChange: (tags: string[]) => void;
    onComposePolicy?: (description: string) => void;
}

function StatusIcon({ status }: { status: Ingestion["status"] }) {
    const map = {
        pending: <Clock className="w-4 h-4 text-muted-foreground" />,
        processing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
        matched: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
        no_match: <Minus className="w-4 h-4 text-amber-500" />,
        duplicate: <Minus className="w-4 h-4 text-emerald-500" />,
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
    const extracted = ing.extracted
        ? Object.entries(ing.extracted).filter(([key, v]) => key !== "_enrichment" && v != null)
        : [];
    if (extracted.length > 0) {
        const fieldSummary = extracted.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
        parts.push(`Partial data already extracted: ${fieldSummary}.`);
    }
    parts.push("Create a policy to handle this exact type of document — infer the document type, define strict match conditions, extract key fields, and route it to an appropriate folder.");
    return parts.join(" ");
}

function formatExtractedValue(value: unknown): string {
    if (value == null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

// Chips for the most important extracted fields
const HIGHLIGHT_KEYS = ["issuer", "vendor", "sender", "document_type", "date", "due_date", "amount", "total", "currency"];

function EntityChips({ extracted }: { extracted: Record<string, unknown> }) {
    const chips = HIGHLIGHT_KEYS
        .filter((k) => extracted[k] != null && String(extracted[k]).trim() !== "")
        .map((k) => ({ key: k, value: String(extracted[k]) }));
    if (chips.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5">
            {chips.map(({ key, value }) => (
                <span
                    key={key}
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted border"
                >
                    <span className="text-muted-foreground font-mono">{key}</span>
                    <span className="font-medium">{value}</span>
                </span>
            ))}
        </div>
    );
}

// ─── Tag editor ───────────────────────────────────────────────────────────────

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
    const [inputValue, setInputValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const removeTag = (tag: string) => onChange(tags.filter((t) => t !== tag));

    const addTag = () => {
        const cleaned = inputValue.toLowerCase().trim().replace(/\s+/g, "-");
        if (!cleaned || tags.includes(cleaned)) {
            setInputValue("");
            return;
        }
        onChange([...tags, cleaned]);
        setInputValue("");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
        } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
            onChange(tags.slice(0, -1));
        }
    };

    return (
        <div
            className="flex flex-wrap items-center gap-1.5 rounded-xl border px-3 py-2 bg-background min-h-[36px] cursor-text"
            onClick={() => inputRef.current?.focus()}
        >
            {tags.map((tag) => (
                <span
                    key={tag}
                    className={cn(
                        "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
                        tagColor(tag)
                    )}
                >
                    {tag}
                    <button
                        onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                        className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                        aria-label={`Remove ${tag}`}
                    >
                        <X className="w-2.5 h-2.5" />
                    </button>
                </span>
            ))}
            <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={addTag}
                placeholder={tags.length ? "" : "Add tags…"}
                className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            />
            {inputValue && (
                <button onClick={addTag} className="text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="w-3 h-3" />
                </button>
            )}
        </div>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function IngestionDetailModal({ ingestion: ing, onClose, onRerun, onTagsChange, onComposePolicy }: Props) {
    const extracted = ing.extracted && Object.keys(ing.extracted).length > 0 ? ing.extracted : null;
    const enrichment = extracted && typeof extracted["_enrichment"] === "object" && extracted["_enrichment"] !== null
        ? extracted["_enrichment"] as Record<string, unknown>
        : null;
    const actions = ing.actions_taken?.length ? ing.actions_taken : null;

    // ─── Summary state ────────────────────────────────────────────────────────
    const [summary, setSummary] = useState<string | null>(ing.summary ?? null);
    const [isSummarizing, setIsSummarizing] = useState(false);

    const canSummarize = ing.status !== "pending" && ing.status !== "processing";

    useEffect(() => {
        if (!canSummarize) return;
        if (summary) return;
        let cancelled = false;
        (async () => {
            setIsSummarizing(true);
            try {
                const session = await getSupabaseClient()?.auth.getSession();
                const token = session?.data?.session?.access_token ?? null;
                const resp = await api.summarizeIngestion(ing.id, token);
                if (cancelled) return;
                if (resp.data?.summary) setSummary(resp.data.summary);
            } catch {
                // best-effort
            } finally {
                if (!cancelled) setIsSummarizing(false);
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ing.id]);

    const handleBackdrop = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={handleBackdrop}
        >
            <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
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
                <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[65vh]">

                    {/* ── Document Summary ───────────────────────────────── */}
                    {canSummarize && (
                        <div>
                            <SectionLabel>
                                <span className="inline-flex items-center gap-1">
                                    <Sparkles className="w-2.5 h-2.5" />Summary
                                </span>
                            </SectionLabel>
                            {extracted && <div className="mb-2"><EntityChips extracted={extracted} /></div>}
                            {isSummarizing ? (
                                <div className="space-y-2">
                                    <div className="h-3 rounded bg-muted animate-pulse w-full" />
                                    <div className="h-3 rounded bg-muted animate-pulse w-5/6" />
                                    <div className="h-3 rounded bg-muted animate-pulse w-4/6" />
                                </div>
                            ) : summary ? (
                                <p className="text-xs text-foreground/80 leading-relaxed">{summary}</p>
                            ) : (
                                <p className="text-xs text-muted-foreground italic">No summary available.</p>
                            )}
                        </div>
                    )}

                    {/* Pending / processing notice */}
                    {!canSummarize && (
                        <div className="rounded-xl bg-muted/40 border px-4 py-3 text-xs text-muted-foreground text-center">
                            Summary will be available after processing completes.
                        </div>
                    )}

                    {/* ── Tags ──────────────────────────────────────────── */}
                    <div>
                        <SectionLabel>
                            <span className="inline-flex items-center gap-1">
                                <Tag className="w-2.5 h-2.5" />Tags
                            </span>
                        </SectionLabel>
                        <TagEditor
                            tags={ing.tags ?? []}
                            onChange={onTagsChange}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                            Enter to add · Backspace to remove · spaces become hyphens
                        </p>
                    </div>

                    {/* ── Policy ────────────────────────────────────────── */}
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
                                {Object.entries(extracted)
                                    .filter(([key]) => key !== "_enrichment")
                                    .map(([key, val]) => (
                                    <div key={key} className="flex items-center justify-between px-4 py-2 text-xs border-b last:border-0">
                                        <span className="font-mono text-muted-foreground">{key}</span>
                                        <span className="font-medium text-right max-w-[55%] truncate">{formatExtractedValue(val)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Enrichment Data */}
                    {enrichment && Object.keys(enrichment).length > 0 && (
                        <div>
                            <SectionLabel>Enrichment Data</SectionLabel>
                            <div className="rounded-xl border overflow-hidden">
                                {Object.entries(enrichment).map(([key, val]) => (
                                    <div key={key} className="px-4 py-2 text-xs border-b last:border-0">
                                        <div className="font-mono text-muted-foreground mb-1">{key}</div>
                                        <pre className="font-medium whitespace-pre-wrap break-all">{formatExtractedValue(val)}</pre>
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
                    {!extracted && !actions && !ing.error_message && canSummarize && !isSummarizing && !summary && (
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
