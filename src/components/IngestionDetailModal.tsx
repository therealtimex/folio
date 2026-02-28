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
import { toast } from "./Toast";
import type { Ingestion } from "./FunnelPage";

interface Props {
    ingestion: Ingestion;
    onClose: () => void;
    onRerun: () => Promise<void>;
    onTagsChange: (tags: string[]) => void;
    onComposePolicy?: (description: string) => void;
    onManualMatch?: (opts: { policyId: string; learn: boolean; rerun: boolean; allowSideEffects: boolean }) => Promise<void>;
}

type ManualPolicyOption = {
    id: string;
    name: string;
    priority: number;
    riskyActions: string[];
    learningExamples: number;
    learningLastAt?: string | null;
};

type DraftPolicy = {
    apiVersion: string;
    kind: string;
    metadata: {
        id: string;
        name: string;
        description: string;
        priority: number;
        version?: string;
        enabled?: boolean;
        tags?: string[];
        [key: string]: unknown;
    };
    spec: {
        match: { strategy: string; conditions: Array<{ type: string; value?: string | string[] }> };
        extract?: Array<{ key: string; type: string; required?: boolean }>;
        actions?: Array<{ type: string; [key: string]: unknown }>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
};

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function mapManualPolicyOptions(rawPolicies: unknown[]): ManualPolicyOption[] {
    const out: ManualPolicyOption[] = [];

    for (const raw of rawPolicies) {
        const policy = toRecord(raw);
        if (!policy) continue;
        const metadata = toRecord(policy.metadata) ?? {};
        const spec = toRecord(policy.spec) ?? {};
        const actions = Array.isArray(spec.actions) ? spec.actions : [];

        const id = typeof metadata.id === "string" ? metadata.id.trim() : "";
        if (!id) continue;

        const riskyActions = actions
            .map((action) => {
                const record = toRecord(action);
                return typeof record?.type === "string" ? record.type.trim() : "";
            })
            .filter((actionType) =>
                actionType === "append_to_google_sheet" ||
                actionType === "webhook" ||
                actionType === "copy_to_gdrive" ||
                actionType === "copy" ||
                actionType === "log_csv" ||
                actionType === "notify"
            );

        out.push({
            id,
            name: typeof metadata.name === "string" ? metadata.name : id,
            priority: typeof metadata.priority === "number" ? metadata.priority : 100,
            riskyActions,
            learningExamples: typeof metadata.learning_examples === "number" ? metadata.learning_examples : 0,
            learningLastAt: typeof metadata.learning_last_at === "string" ? metadata.learning_last_at : null,
        });
    }

    out.sort((a, b) => b.priority - a.priority);
    return out;
}

type LearnedDiagnostics = {
    reason?: string;
    evaluatedPolicies?: number;
    evaluatedSamples?: number;
    bestCandidate?: Record<string, unknown>;
    topCandidates?: Array<Record<string, unknown>>;
};

function getLatestLearnedDiagnostics(trace: Ingestion["trace"] | undefined): LearnedDiagnostics | null {
    if (!Array.isArray(trace) || trace.length === 0) return null;
    const reversed = [...trace].reverse();
    const entry = reversed.find((item) => {
        const step = String(item?.step ?? "").toLowerCase();
        return step.includes("learned fallback") || step.includes("learned policy candidate selected");
    });
    if (!entry) return null;
    const step = String(entry.step ?? "").toLowerCase();
    const details = toRecord(entry.details);
    if (!details) return null;
    const inferredReason =
        typeof details.reason === "string"
            ? details.reason
            : step.includes("candidate selected")
                ? "accepted"
                : undefined;
    const inferredBestCandidate =
        toRecord(details.bestCandidate) ??
        (typeof details.policyId === "string" || typeof details.score === "number" || typeof details.support === "number"
            ? {
                policyId: details.policyId,
                score: details.score,
                support: details.support,
            }
            : undefined);
    return {
        reason: inferredReason,
        evaluatedPolicies: typeof details.evaluatedPolicies === "number" ? details.evaluatedPolicies : undefined,
        evaluatedSamples: typeof details.evaluatedSamples === "number" ? details.evaluatedSamples : undefined,
        bestCandidate: inferredBestCandidate,
        topCandidates: Array.isArray(details.topCandidates)
            ? details.topCandidates.map((candidate) => toRecord(candidate)).filter((candidate): candidate is Record<string, unknown> => !!candidate)
            : undefined,
    };
}

function formatLearningReason(reason?: string): string {
    if (!reason) return "No learned candidate details available yet.";
    switch (reason) {
        case "accepted":
            return "Learned fallback selected a policy candidate.";
        case "no_policy_ids":
            return "No candidate policies available for learned fallback.";
        case "no_document_features":
            return "Document had insufficient signals for learned fallback scoring.";
        case "no_feedback_samples":
            return "No learned examples yet. Match at least one document with learning enabled.";
        case "no_valid_samples":
            return "Learned examples exist but were too sparse to score.";
        case "score_below_threshold":
            return "A candidate was found but confidence stayed below threshold.";
        case "read_error":
            return "Learned fallback could not read feedback history.";
        default:
            return reason.replace(/_/g, " ");
    }
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
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.focus()}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    inputRef.current?.focus();
                }
            }}
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

export function IngestionDetailModal({ ingestion: ing, onClose, onRerun, onTagsChange, onComposePolicy, onManualMatch }: Props) {
    const extracted = ing.extracted && Object.keys(ing.extracted).length > 0 ? ing.extracted : null;
    const enrichment = extracted && typeof extracted["_enrichment"] === "object" && extracted["_enrichment"] !== null
        ? extracted["_enrichment"] as Record<string, unknown>
        : null;
    const actions = ing.actions_taken?.length ? ing.actions_taken : null;

    // ─── Summary state ────────────────────────────────────────────────────────
    const [summary, setSummary] = useState<string | null>(ing.summary ?? null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [policyOptions, setPolicyOptions] = useState<ManualPolicyOption[]>([]);
    const [isLoadingPolicies, setIsLoadingPolicies] = useState(false);
    const [selectedPolicyId, setSelectedPolicyId] = useState("");
    const [learnFromMatch, setLearnFromMatch] = useState(true);
    const [rerunOnMatch, setRerunOnMatch] = useState(true);
    const [allowSideEffects, setAllowSideEffects] = useState(false);
    const [isApplyingManualMatch, setIsApplyingManualMatch] = useState(false);
    const [manualMatchError, setManualMatchError] = useState<string | null>(null);
    const [isSuggestingRefinement, setIsSuggestingRefinement] = useState(false);
    const [isApplyingRefinement, setIsApplyingRefinement] = useState(false);
    const [refinementDraft, setRefinementDraft] = useState<DraftPolicy | null>(null);
    const [refinementRationale, setRefinementRationale] = useState<string[]>([]);
    const [refinementError, setRefinementError] = useState<string | null>(null);
    const [showRefinementJson, setShowRefinementJson] = useState(false);

    const canSummarize = ing.status !== "pending" && ing.status !== "processing";
    const canManualMatch = !!onManualMatch && !ing.policy_name && ing.status !== "pending" && ing.status !== "processing";
    const learnedDiagnostics = getLatestLearnedDiagnostics(ing.trace);

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

    useEffect(() => {
        if (!canManualMatch) return;
        let cancelled = false;

        (async () => {
            setIsLoadingPolicies(true);
            setManualMatchError(null);
            try {
                const session = await getSupabaseClient()?.auth.getSession();
                const token = session?.data?.session?.access_token ?? null;
                const response = await api.getPolicies(token);
                if (cancelled) return;
                if (response?.error) {
                    const message = typeof response.error === "string" ? response.error : response.error.message;
                    throw new Error(message || "Failed to load policies.");
                }

                const policies = mapManualPolicyOptions(response?.data?.policies ?? []);

                setPolicyOptions(policies);
                setSelectedPolicyId((prev) => prev || policies[0]?.id || "");
            } catch {
                if (!cancelled) {
                    setPolicyOptions([]);
                    setManualMatchError("Failed to load policies.");
                }
            } finally {
                if (!cancelled) setIsLoadingPolicies(false);
            }
        })();

        return () => { cancelled = true; };
    }, [canManualMatch, ing.id]);

    const handleManualMatch = useCallback(async () => {
        if (!onManualMatch || !selectedPolicyId || isApplyingManualMatch) return;
        const selectedPolicy = policyOptions.find((policy) => policy.id === selectedPolicyId);
        const selectedRiskyActions = selectedPolicy?.riskyActions ?? [];
        if (rerunOnMatch && selectedRiskyActions.length > 0 && !allowSideEffects) {
            setManualMatchError(
                `Re-run may trigger side-effect actions: ${selectedRiskyActions.join(", ")}. ` +
                "Enable side-effect confirmation to continue."
            );
            return;
        }
        setIsApplyingManualMatch(true);
        setManualMatchError(null);
        try {
            await onManualMatch({
                policyId: selectedPolicyId,
                learn: learnFromMatch,
                rerun: rerunOnMatch,
                allowSideEffects: rerunOnMatch ? allowSideEffects : false,
            });
            setRefinementDraft(null);
            setRefinementRationale([]);
            setRefinementError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setManualMatchError(message || "Failed to assign policy.");
        } finally {
            setIsApplyingManualMatch(false);
        }
    }, [allowSideEffects, isApplyingManualMatch, learnFromMatch, onManualMatch, policyOptions, rerunOnMatch, selectedPolicyId]);

    const handleSuggestRefinement = useCallback(async () => {
        if (!selectedPolicyId || isSuggestingRefinement || isApplyingRefinement) return;
        setIsSuggestingRefinement(true);
        setRefinementError(null);
        setRefinementDraft(null);
        setRefinementRationale([]);
        try {
            const session = await getSupabaseClient()?.auth.getSession();
            const token = session?.data?.session?.access_token ?? null;
            const response = await api.suggestPolicyRefinement(
                ing.id,
                { policyId: selectedPolicyId },
                token
            );
            if (response?.error) {
                const message = typeof response.error === "string" ? response.error : response.error.message;
                throw new Error(message || "Unable to suggest refinement.");
            }

            const draft = response?.data?.suggestion?.policy as DraftPolicy | undefined;
            if (!draft) {
                throw new Error("No policy refinement draft was returned.");
            }

            const rationale = Array.isArray(response?.data?.suggestion?.rationale)
                ? response.data.suggestion.rationale.map((item: unknown) => String(item).trim()).filter(Boolean)
                : [];
            setRefinementDraft(draft);
            setRefinementRationale(rationale);
            setShowRefinementJson(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRefinementError(message || "Unable to suggest refinement.");
        } finally {
            setIsSuggestingRefinement(false);
        }
    }, [ing.id, isApplyingRefinement, isSuggestingRefinement, selectedPolicyId]);

    const handleApplyRefinement = useCallback(async () => {
        if (!refinementDraft || isApplyingRefinement) return;
        setIsApplyingRefinement(true);
        setRefinementError(null);
        try {
            const session = await getSupabaseClient()?.auth.getSession();
            const token = session?.data?.session?.access_token ?? null;
            const saveResponse = await api.savePolicy(refinementDraft, token);
            if (saveResponse?.error) {
                const message = typeof saveResponse.error === "string" ? saveResponse.error : saveResponse.error.message;
                throw new Error(message || "Failed to apply refinement.");
            }
            toast.success(`Applied refinement to policy "${refinementDraft.metadata.name}".`);
            setRefinementDraft(null);
            setRefinementRationale([]);
            setRefinementError(null);
            setShowRefinementJson(false);

            const policiesResponse = await api.getPolicies(token);
            if (!policiesResponse?.error) {
                const nextOptions = mapManualPolicyOptions(policiesResponse?.data?.policies ?? []);
                setPolicyOptions(nextOptions);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRefinementError(message || "Failed to apply refinement.");
        } finally {
            setIsApplyingRefinement(false);
        }
    }, [isApplyingRefinement, refinementDraft]);

    const selectedPolicy = policyOptions.find((policy) => policy.id === selectedPolicyId);
    const selectedRiskyActions = selectedPolicy?.riskyActions ?? [];

    const handleBackdrop = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            role="button"
            tabIndex={0}
            onClick={handleBackdrop}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    onClose();
                }
                if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                    e.preventDefault();
                    onClose();
                }
            }}
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
                        {ing.policy_name ? (
                            <Badge variant="secondary">{ing.policy_name}</Badge>
                        ) : (
                            <div className="space-y-2">
                                <span className="text-xs text-muted-foreground">No policy matched</span>
                                {canManualMatch && (
                                    <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                                        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                            Assign To Existing Policy
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <select
                                                className="flex-1 h-8 rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                                                value={selectedPolicyId}
                                                onChange={(e) => {
                                                    setSelectedPolicyId(e.target.value);
                                                    setAllowSideEffects(false);
                                                    setManualMatchError(null);
                                                    setRefinementDraft(null);
                                                    setRefinementRationale([]);
                                                    setRefinementError(null);
                                                }}
                                                disabled={isLoadingPolicies || isApplyingManualMatch || policyOptions.length === 0}
                                            >
                                                {policyOptions.length === 0 ? (
                                                    <option value="">{isLoadingPolicies ? "Loading policies…" : "No active policies"}</option>
                                                ) : (
                                                    policyOptions.map((policy) => (
                                                        <option key={policy.id} value={policy.id}>
                                                            {policy.learningExamples > 0
                                                                ? `${policy.name} (${policy.learningExamples} learned)`
                                                                : policy.name}
                                                        </option>
                                                    ))
                                                )}
                                            </select>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 rounded-lg"
                                                disabled={isApplyingManualMatch || isLoadingPolicies || !selectedPolicyId}
                                                onClick={handleManualMatch}
                                            >
                                                {isApplyingManualMatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Match To Policy"}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 rounded-lg"
                                                disabled={isSuggestingRefinement || isApplyingRefinement || isLoadingPolicies || !selectedPolicyId}
                                                onClick={handleSuggestRefinement}
                                            >
                                                {isSuggestingRefinement ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Suggest Refinement"}
                                            </Button>
                                        </div>
                                        {selectedPolicy && (
                                            <p className="text-[10px] text-muted-foreground">
                                                Learned examples for this policy: {selectedPolicy.learningExamples}
                                                {selectedPolicy.learningLastAt ? ` · last on ${new Date(selectedPolicy.learningLastAt).toLocaleDateString()}` : ""}
                                            </p>
                                        )}
                                        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                            <input
                                                type="checkbox"
                                                className="rounded border-muted-foreground/40"
                                                checked={learnFromMatch}
                                                onChange={(e) => setLearnFromMatch(e.target.checked)}
                                                disabled={isApplyingManualMatch}
                                            />
                                            Learn from this match
                                        </label>
                                        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                            <input
                                                type="checkbox"
                                                className="rounded border-muted-foreground/40"
                                                checked={rerunOnMatch}
                                                onChange={(e) => {
                                                    setRerunOnMatch(e.target.checked);
                                                    setAllowSideEffects(false);
                                                    setManualMatchError(null);
                                                }}
                                                disabled={isApplyingManualMatch}
                                            />
                                            Re-run ingestion now (recommended)
                                        </label>
                                        {rerunOnMatch && selectedRiskyActions.length > 0 && (
                                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 space-y-1">
                                                <p>This policy has side-effect actions: {selectedRiskyActions.join(", ")}</p>
                                                <label className="inline-flex items-center gap-1.5 text-[11px]">
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-amber-500/40"
                                                        checked={allowSideEffects}
                                                        onChange={(e) => setAllowSideEffects(e.target.checked)}
                                                        disabled={isApplyingManualMatch}
                                                    />
                                                    I understand this may create external writes on re-run
                                                </label>
                                            </div>
                                        )}
                                        {(refinementDraft || refinementError) && (
                                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-2">
                                                <p className="text-[10px] uppercase tracking-wider font-semibold text-primary">
                                                    Policy Refinement Preview
                                                </p>
                                                {refinementError && (
                                                    <p className="text-[11px] text-destructive">{refinementError}</p>
                                                )}
                                                {refinementDraft && (
                                                    <>
                                                        <p className="text-[11px] text-foreground/90">
                                                            {refinementDraft.metadata.name} · {refinementDraft.spec.match.conditions.length} match conditions · {(refinementDraft.spec.extract ?? []).length} extract fields
                                                        </p>
                                                        {refinementRationale.length > 0 && (
                                                            <div className="space-y-1">
                                                                {refinementRationale.map((line, idx) => (
                                                                    <p key={`refine-rationale-${idx}`} className="text-[10px] text-muted-foreground">
                                                                        {line}
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        )}
                                                        <div className="flex gap-1.5">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-7 rounded-lg text-[10px]"
                                                                onClick={() => setShowRefinementJson((value) => !value)}
                                                            >
                                                                {showRefinementJson ? "Hide JSON" : "Show JSON"}
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                className="h-7 rounded-lg text-[10px]"
                                                                onClick={handleApplyRefinement}
                                                                disabled={isApplyingRefinement}
                                                            >
                                                                {isApplyingRefinement ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply To Policy"}
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 rounded-lg text-[10px]"
                                                                onClick={() => {
                                                                    setRefinementDraft(null);
                                                                    setRefinementRationale([]);
                                                                    setRefinementError(null);
                                                                    setShowRefinementJson(false);
                                                                }}
                                                            >
                                                                Discard
                                                            </Button>
                                                        </div>
                                                        {showRefinementJson && (
                                                            <pre className="rounded-md border border-border/40 bg-background p-2 text-[10px] overflow-auto max-h-48 whitespace-pre-wrap font-mono">
                                                                {JSON.stringify(refinementDraft, null, 2)}
                                                            </pre>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                        {manualMatchError && (
                                            <p className="text-[11px] text-destructive">{manualMatchError}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {learnedDiagnostics && (
                        <div>
                            <SectionLabel>Learning Diagnostics</SectionLabel>
                            <div className="rounded-xl border bg-muted/20 px-4 py-3 space-y-1.5">
                                <p className="text-xs text-foreground/90">{formatLearningReason(learnedDiagnostics.reason)}</p>
                                {(learnedDiagnostics.evaluatedPolicies !== undefined || learnedDiagnostics.evaluatedSamples !== undefined) && (
                                    <p className="text-[11px] text-muted-foreground">
                                        Evaluated policies: {learnedDiagnostics.evaluatedPolicies ?? 0} · samples: {learnedDiagnostics.evaluatedSamples ?? 0}
                                    </p>
                                )}
                                {learnedDiagnostics.bestCandidate && (
                                    <p className="text-[11px] text-muted-foreground font-mono">
                                        Best: {String(learnedDiagnostics.bestCandidate.policyId ?? "-")} · score {String(learnedDiagnostics.bestCandidate.score ?? "-")} · support {String(learnedDiagnostics.bestCandidate.support ?? "-")}
                                        {learnedDiagnostics.bestCandidate.requiredScore !== undefined
                                            ? ` · needed ${String(learnedDiagnostics.bestCandidate.requiredScore)}`
                                            : ""}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

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
