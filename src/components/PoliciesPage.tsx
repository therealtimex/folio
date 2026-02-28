import { useState, useEffect, useCallback } from "react";
import {
    ScrollText,
    Sparkles,
    Package,
    Plus,
    Trash2,
    RefreshCw,
    ToggleLeft,
    ToggleRight,
    Loader2,
    Info,
    ChevronDown,
    ChevronUp,
    Tag,
    Cpu,
    X,
    Zap
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { toast } from "./Toast";
import { api } from "../lib/api";
import { getSupabaseClient } from "../lib/supabase-config";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PolicyMetadata {
    id: string;
    name: string;
    description: string;
    priority: number;
    enabled?: boolean;
    tags?: string[];
}

interface PolicyAction {
    type: string;
    destination?: string;
    pattern?: string;
    filename?: string;
    path?: string;
    columns?: string[];
    spreadsheet_id?: string;
    spreadsheet_url?: string;
    range?: string;
}

interface FolioPolicy {
    metadata: PolicyMetadata;
    spec: {
        match: { strategy: string; conditions: { type: string; value?: string | string[] }[] };
        extract?: { key: string; type: string; required?: boolean }[];
        actions?: PolicyAction[];
    };
}

// ─── Preset Packs ────────────────────────────────────────────────────────────

const PACKS = [
    {
        id: "bay-area-utilities",
        name: "Bay Area Utilities",
        description: "PG&E, Recology, EBMUD, and SCE bill handling",
        policies: 4,
        tags: ["utilities", "california"]
    },
    {
        id: "freelancer-tax",
        name: "Freelancer Tax Pack",
        description: "1099-NEC, W-9, invoices, and estimated taxes",
        policies: 6,
        tags: ["finance", "tax"]
    },
    {
        id: "medical-records",
        name: "Medical Records",
        description: "EOB, lab results, prescription receipts",
        policies: 5,
        tags: ["health", "insurance"]
    },
    {
        id: "legal-docs",
        name: "Legal Documents",
        description: "Contracts, notices, deeds, and court documents",
        policies: 3,
        tags: ["legal", "priority"]
    }
];

// ─── Component ───────────────────────────────────────────────────────────────

interface PoliciesPageProps {
    initialCompose?: string | null;
    onInitialConsumed?: () => void;
}

export function PoliciesPage({ initialCompose, onInitialConsumed }: PoliciesPageProps) {
    const [policies, setPolicies] = useState<FolioPolicy[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [description, setDescription] = useState("");
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [synthesizedPolicy, setSynthesizedPolicy] = useState<FolioPolicy | null>(null);
    const [showSynthesizedJson, setShowSynthesizedJson] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"policies" | "packs">("policies");
    const [chatProviders, setChatProviders] = useState<{ provider: string; models: { id: string }[] }[]>([]);
    const [selectedProvider, setSelectedProvider] = useState("");
    const [selectedModel, setSelectedModel] = useState("");
    const [sessionToken, setSessionToken] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<{ name: string; description: string; tags: string; priority: number } | null>(null);
    const [showQuickCreate, setShowQuickCreate] = useState(false);
    const [quickForm, setQuickForm] = useState({
        name: "",
        description: "",
        keywords: "",
        matchStrategy: "ANY" as "ANY" | "ALL",
        actions: [{ type: "copy" as "copy" | "rename" | "auto_rename" | "log_csv" | "copy_to_gdrive" | "append_to_google_sheet", destination: "", filename: "", columns: [] as string[], spreadsheet_id: "", range: "" }],
        tags: "",
        priority: 100,
    });
    const [isQuickSaving, setIsQuickSaving] = useState(false);

    const fetchPolicies = useCallback(async () => {
        setIsLoading(true);
        const resp = await api.getPolicies?.(sessionToken);
        if (resp?.data?.policies) {
            setPolicies(resp.data.policies);
        }
        setIsLoading(false);
    }, [sessionToken]);

    const fetchProviders = useCallback(async () => {
        try {
            const resp = await api.getSDKChatProviders?.();
            const providers = resp?.data?.providers ?? [];
            setChatProviders(providers);
            if (providers.length > 0 && !selectedProvider) {
                setSelectedProvider(providers[0].provider);
                setSelectedModel(providers[0].models?.[0]?.id ?? "");
            }
        } catch {
            // Providers unavailable – synthesize will use SDK default
        }
    }, [selectedProvider]);

    useEffect(() => {
        // Fetch session token for authenticated API calls
        const supabase = getSupabaseClient();
        if (supabase) {
            supabase.auth.getSession().then(({ data }) => {
                setSessionToken(data.session?.access_token ?? null);
            });
        }
    }, []);

    useEffect(() => {
        fetchPolicies();
        fetchProviders();
    }, [fetchPolicies, fetchProviders]);

    useEffect(() => {
        if (initialCompose) {
            setDescription(initialCompose);
            onInitialConsumed?.();
        }
    }, [initialCompose, onInitialConsumed]);

    const handleSynthesize = async () => {
        if (!description.trim()) return;
        setIsSynthesizing(true);
        setSynthesizedPolicy(null);
        try {
            const resp = await api.synthesizePolicy?.({
                description,
                provider: selectedProvider || undefined,
                model: selectedModel || undefined
            });
            if (resp?.data?.policy) {
                setSynthesizedPolicy(resp.data.policy);
                setShowSynthesizedJson(false);
                const warning = (resp.data as any).warning;
                if (warning) toast.warning(warning);
                else toast.success("Policy synthesized! Review and save below.");
            } else {
                toast.error((resp?.data as any)?.error ?? "Synthesis failed.");
            }
        } catch {
            toast.error("LLM synthesis failed.");
        } finally {
            setIsSynthesizing(false);
        }
    };

    const handleSavePolicy = async (policy: FolioPolicy) => {
        setIsSaving(true);
        try {
            await api.savePolicy?.(policy, sessionToken);
            toast.success(`Policy "${policy.metadata.name}" saved.`);
            setSynthesizedPolicy(null);
            setDescription("");
            await fetchPolicies();
        } catch {
            toast.error("Failed to save policy.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        const confirmed = window.confirm(`Delete policy "${id}"?`);
        if (!confirmed) return;
        await api.deletePolicy?.(id, sessionToken);
        toast.success("Policy deleted.");
        await fetchPolicies();
    };

    const handleToggle = async (p: FolioPolicy) => {
        // Optimistic update
        setPolicies((prev) =>
            prev.map((x) =>
                x.metadata.id === p.metadata.id
                    ? { ...x, metadata: { ...x.metadata, enabled: !x.metadata.enabled } }
                    : x
            )
        );
        try {
            await api.patchPolicy?.(p.metadata.id, { enabled: !p.metadata.enabled }, sessionToken);
        } catch {
            toast.error("Failed to toggle policy.");
            await fetchPolicies(); // revert
        }
    };

    const handleStartEdit = (p: FolioPolicy) => {
        setEditingId(p.metadata.id);
        setEditDraft({
            name: p.metadata.name,
            description: p.metadata.description,
            tags: (p.metadata.tags ?? []).join(", "),
            priority: p.metadata.priority,
        });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditDraft(null);
    };

    const handleSaveEdit = async (policyId: string) => {
        if (!editDraft) return;
        try {
            await api.patchPolicy?.(
                policyId,
                {
                    name: editDraft.name,
                    description: editDraft.description,
                    tags: editDraft.tags.split(",").map((t) => t.trim()).filter(Boolean),
                    priority: editDraft.priority,
                },
                sessionToken
            );
            toast.success("Policy updated.");
            setEditingId(null);
            setEditDraft(null);
            await fetchPolicies();
        } catch {
            toast.error("Failed to save edits.");
        }
    };

    const handleRecompose = (p: FolioPolicy) => {
        setDescription(p.metadata.description);
        setActiveTab("policies");
        toast.success("Description pre-filled — edit and click ✨ to re-synthesize.");
    };

    const handleReload = async () => {
        await api.reloadPolicies?.(sessionToken);
        await fetchPolicies();
        toast.success("Policies reloaded.");
    };

    const updateQuickAction = (index: number, field: "type" | "destination" | "filename" | "columns" | "spreadsheet_id" | "range", value: unknown) => {
        setQuickForm((prev) => {
            const actions = prev.actions.map((a, i) =>
                i === index ? { ...a, [field]: value } : a
            );
            return { ...prev, actions };
        });
    };

    const addQuickAction = () => {
        setQuickForm((prev) => ({
            ...prev,
            actions: [...prev.actions, { type: "copy" as const, destination: "", filename: "", columns: [], spreadsheet_id: "", range: "" }],
        }));
    };

    const removeQuickAction = (index: number) => {
        setQuickForm((prev) => ({
            ...prev,
            actions: prev.actions.filter((_, i) => i !== index),
        }));
    };

    const isInvalidAppendAction = (action: (typeof quickForm.actions)[number]) =>
        action.type === "append_to_google_sheet" && !action.spreadsheet_id?.trim();

    const hasInvalidAppendAction = quickForm.actions.some(isInvalidAppendAction);

    const handleQuickCreate = async () => {
        if (!quickForm.name.trim()) return;
        const invalidAppendActionIndex = quickForm.actions.findIndex(isInvalidAppendAction);
        if (invalidAppendActionIndex !== -1) {
            toast.error(`Action #${invalidAppendActionIndex + 1}: "Append to Google Sheet" requires Spreadsheet ID or Google Sheet URL.`);
            return;
        }
        setIsQuickSaving(true);
        try {
            const id = quickForm.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            const keywords = quickForm.keywords.split(",").map((k) => k.trim()).filter(Boolean);
            const tags = quickForm.tags.split(",").map((t) => t.trim()).filter(Boolean);

            const builtActions: PolicyAction[] = quickForm.actions
                .filter((a) => a.type === "copy_to_gdrive" || a.type === "auto_rename" || a.type === "append_to_google_sheet" || a.destination.trim())
                .map((a) => {
                    const action: PolicyAction = { type: a.type };
                    if (a.type === "copy") {
                        action.destination = a.destination;
                        if (a.filename) action.filename = a.filename;
                    } else if (a.type === "rename") {
                        action.destination = a.destination;
                    } else if (a.type === "auto_rename") {
                        // no destination needed, AI derives it
                    } else if (a.type === "copy_to_gdrive") {
                        if (a.destination.trim()) {
                            action.destination = a.destination.trim();
                        }
                        if (a.filename) action.filename = a.filename;
                    } else if (a.type === "log_csv") {
                        action.path = a.destination;
                    } else if (a.type === "append_to_google_sheet") {
                        const spreadsheetReference = a.spreadsheet_id?.trim();
                        if (spreadsheetReference) action.spreadsheet_id = spreadsheetReference;
                        const configuredRange = a.range?.trim();
                        if (configuredRange) action.range = configuredRange;
                        const configuredColumns = (a.columns ?? []).map((column) => column.trim()).filter(Boolean);
                        if (configuredColumns.length > 0) action.columns = configuredColumns;
                    }
                    return action;
                });

            const policy: FolioPolicy = {
                metadata: {
                    id,
                    name: quickForm.name.trim(),
                    description: quickForm.description.trim(),
                    priority: quickForm.priority,
                    tags,
                    enabled: true,
                },
                spec: {
                    match: {
                        strategy: quickForm.matchStrategy,
                        conditions: keywords.length > 0
                            ? [{ type: "keyword", value: keywords }]
                            : [{ type: "keyword", value: [] }],
                    },
                    extract: [],
                    actions: builtActions,
                },
            };

            await api.savePolicy?.(policy, sessionToken);
            toast.success(`Policy "${policy.metadata.name}" created.`);
            setShowQuickCreate(false);
            setQuickForm({ name: "", description: "", keywords: "", matchStrategy: "ANY", actions: [{ type: "copy", destination: "", filename: "", columns: [], spreadsheet_id: "", range: "" }], tags: "", priority: 100 });
            await fetchPolicies();
        } catch {
            toast.error("Failed to create policy.");
        } finally {
            setIsQuickSaving(false);
        }
    };

    const formatActionSummary = (action: PolicyAction): string => {
        if (action.type === "append_to_google_sheet") {
            const sheetRef = action.spreadsheet_id?.trim() || action.spreadsheet_url?.trim() || "";
            const range = action.range?.trim() || "";
            if (sheetRef && range) return `${sheetRef} (${range})`;
            return sheetRef || range;
        }
        if (action.type === "log_csv") {
            return action.path?.trim() || "";
        }
        return action.destination?.trim() || action.pattern?.trim() || "";
    };

    const updateSynthesizedAction = (index: number, patch: Partial<PolicyAction>) => {
        setSynthesizedPolicy((prev) => {
            if (!prev) return prev;
            const actions = (prev.spec.actions ?? []).map((action, actionIndex) =>
                actionIndex === index ? { ...action, ...patch } : action
            );
            return {
                ...prev,
                spec: {
                    ...prev.spec,
                    actions,
                },
            };
        });
    };

    const getSynthesizedPolicyIssues = (policy: FolioPolicy | null): string[] => {
        if (!policy) return [];

        const issues: string[] = [];
        if (!policy.metadata.name?.trim()) issues.push("Policy name is missing.");
        if (!policy.metadata.id?.trim()) issues.push("Policy id is missing.");

        const actions = policy.spec.actions ?? [];
        if (actions.length === 0) {
            issues.push("At least one action is required.");
        }

        actions.forEach((action, idx) => {
            if (action.type === "append_to_google_sheet") {
                const sheetRef = action.spreadsheet_id?.trim() || action.spreadsheet_url?.trim();
                if (!sheetRef) {
                    issues.push(`Action #${idx + 1} append_to_google_sheet is missing spreadsheet_id / URL.`);
                }
            }

            if (action.type === "copy" && !action.destination?.trim()) {
                issues.push(`Action #${idx + 1} copy is missing destination.`);
            }

            if (action.type === "rename" && !(action.pattern?.trim() || action.destination?.trim())) {
                issues.push(`Action #${idx + 1} rename is missing pattern.`);
            }
        });

        return issues;
    };

    const synthesizedIssues = getSynthesizedPolicyIssues(synthesizedPolicy);
    const canSaveSynthesizedPolicy = !!synthesizedPolicy && synthesizedIssues.length === 0 && !isSaving;


    return (
        <div className="w-full mx-auto px-8 py-10 space-y-10 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
                        <ScrollText className="w-8 h-8 text-primary" />
                        Policy Engine
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Define automation rules that govern how Folio handles your documents.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleReload} className="gap-2 rounded-xl">
                    <RefreshCw className="w-4 h-4" />
                    Reload
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-2xl bg-muted/50 border w-fit">
                {(["policies", "packs"] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            "px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                            activeTab === tab
                                ? "bg-background shadow-sm text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {tab === "policies" ? "Active Policies" : "Policy Packs"}
                    </button>
                ))}
            </div>

            {activeTab === "policies" && (
                <>
                    {/* Magic Composer */}
                    <div className="rounded-2xl border bg-card/60 backdrop-blur-sm p-6 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-black uppercase tracking-widest">Magic Composer</h2>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Describe a rule in plain English. Click ✨ to generate the policy automatically.
                        </p>

                        {/* Provider selector */}
                        {chatProviders.length > 0 && (
                            <div className="flex gap-2 items-center">
                                <Cpu className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <select
                                    value={`${selectedProvider}::${selectedModel}`}
                                    onChange={(e) => {
                                        const [p, m] = e.target.value.split("::");
                                        setSelectedProvider(p);
                                        setSelectedModel(m);
                                    }}
                                    className="text-xs rounded-lg border border-border/40 bg-background px-2 py-1 text-foreground flex-1 max-w-xs"
                                >
                                    {chatProviders.flatMap((p) =>
                                        (p.models ?? []).map((m) => (
                                            <option key={`${p.provider}::${m.id}`} value={`${p.provider}::${m.id}`}>
                                                {p.provider} / {m.id}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <span className="text-[10px] text-muted-foreground">for synthesis</span>
                            </div>
                        )}

                        <div className="flex gap-3 items-start">
                            <Textarea
                                placeholder="e.g. If I get a bill from Tesla, move it to /Car/ folder and log the amount to my CSV…"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="flex-1 min-h-[80px] resize-none rounded-xl border-border/40 bg-background text-sm"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSynthesize();
                                }}
                            />
                            <Button
                                onClick={handleSynthesize}
                                disabled={isSynthesizing || !description.trim()}
                                className={cn(
                                    "h-10 w-10 p-0 rounded-xl flex items-center justify-center transition-all",
                                    "bg-primary text-primary-foreground shadow-lg shadow-primary/20",
                                    "hover:scale-105 active:scale-95"
                                )}
                                title="Synthesize policy with AI"
                            >
                                {isSynthesizing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Sparkles className="w-4 h-4" />
                                )}
                            </Button>
                        </div>

                        {/* Synthesized Preview */}
                        {synthesizedPolicy && (
                            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3 animate-in slide-in-from-bottom-2 duration-300">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-black text-sm">{synthesizedPolicy.metadata.name}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{synthesizedPolicy.metadata.description}</p>
                                    </div>
                                    <Badge variant="outline" className="text-[10px] uppercase font-bold">
                                        Priority {synthesizedPolicy.metadata.priority}
                                    </Badge>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                                    <div className="rounded-lg bg-muted/60 p-2">
                                        <div className="font-bold uppercase tracking-widest text-[9px] mb-1 text-foreground">Match</div>
                                        <div className="space-y-1">
                                            {synthesizedPolicy.spec.match.conditions.length === 0 && <div>—</div>}
                                            {synthesizedPolicy.spec.match.conditions.map((cond, idx) => (
                                                <div key={`${cond.type}-${idx}`}>
                                                    <span className="font-mono bg-muted px-1 rounded text-[10px]">{cond.type}</span>
                                                    {" "}
                                                    {Array.isArray(cond.value) ? cond.value.join(", ") : cond.value}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-muted/60 p-2">
                                        <div className="font-bold uppercase tracking-widest text-[9px] mb-1 text-foreground">Extract</div>
                                        <div className="space-y-1">
                                            {(synthesizedPolicy.spec.extract?.length ?? 0) === 0 && <div>—</div>}
                                            {synthesizedPolicy.spec.extract?.map((field) => (
                                                <div key={field.key}>
                                                    <span className="font-mono bg-muted px-1 rounded text-[10px]">{field.key}</span>
                                                    {" "}
                                                    ({field.type}){field.required ? " *" : ""}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-muted/60 p-2">
                                        <div className="font-bold uppercase tracking-widest text-[9px] mb-1 text-foreground">Actions</div>
                                        <div className="space-y-2">
                                            {(synthesizedPolicy.spec.actions?.length ?? 0) === 0 && <div>—</div>}
                                            {synthesizedPolicy.spec.actions?.map((action, index) => (
                                                <div key={`${action.type}-${index}`} className="rounded-md border border-border/50 bg-background/80 p-2 space-y-1.5">
                                                    <div>
                                                        <span className="font-mono bg-muted px-1 rounded text-[10px]">{action.type}</span>
                                                        {" "}
                                                        {formatActionSummary(action)}
                                                    </div>
                                                    {action.type === "copy_to_gdrive" && (
                                                        <Input
                                                            value={action.destination ?? ""}
                                                            onChange={(e) => updateSynthesizedAction(index, { destination: e.target.value })}
                                                            placeholder="Google Drive folder ID"
                                                            className="h-7 text-[11px] rounded-lg font-mono"
                                                        />
                                                    )}
                                                    {action.type === "append_to_google_sheet" && (
                                                        <div className="space-y-1.5">
                                                            <Input
                                                                value={action.spreadsheet_id ?? action.spreadsheet_url ?? ""}
                                                                onChange={(e) => updateSynthesizedAction(index, { spreadsheet_id: e.target.value, spreadsheet_url: undefined })}
                                                                placeholder="Spreadsheet ID or URL"
                                                                className="h-7 text-[11px] rounded-lg font-mono"
                                                            />
                                                            <Input
                                                                value={action.range ?? ""}
                                                                onChange={(e) => updateSynthesizedAction(index, { range: e.target.value })}
                                                                placeholder="Optional range (e.g. Sheet1!A:Z)"
                                                                className="h-7 text-[11px] rounded-lg font-mono"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                {synthesizedIssues.length > 0 ? (
                                    <Alert className="rounded-xl border-red-200 bg-red-50">
                                        <AlertDescription className="text-xs text-red-700">
                                            <div className="font-semibold mb-1">Fix before saving:</div>
                                            <div className="space-y-0.5">
                                                {synthesizedIssues.map((issue, idx) => (
                                                    <div key={`synth-issue-${idx}`}>{issue}</div>
                                                ))}
                                            </div>
                                        </AlertDescription>
                                    </Alert>
                                ) : (
                                    <div className="text-[11px] text-emerald-700 font-semibold">
                                        Policy looks valid for save.
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setShowSynthesizedJson((v) => !v)}
                                        className="h-7 px-2 rounded-lg text-[10px] uppercase tracking-widest"
                                    >
                                        {showSynthesizedJson ? "Hide JSON" : "Show JSON"}
                                    </Button>
                                </div>
                                {showSynthesizedJson && (
                                    <pre className="rounded-lg border border-border/40 bg-background p-3 text-[11px] overflow-auto max-h-72 whitespace-pre-wrap font-mono">
                                        {JSON.stringify(synthesizedPolicy, null, 2)}
                                    </pre>
                                )}
                                <div className="flex gap-2 pt-1">
                                    <Button
                                        size="sm"
                                        onClick={() => handleSavePolicy(synthesizedPolicy)}
                                        disabled={!canSaveSynthesizedPolicy}
                                        className="flex-1 h-8 rounded-xl font-black text-[10px] uppercase tracking-widest"
                                    >
                                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save Policy"}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setSynthesizedPolicy(null);
                                            setShowSynthesizedJson(false);
                                        }}
                                        className="h-8 px-3 rounded-xl"
                                    >
                                        Discard
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Policy Directory */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                Active Policies ({policies.length})
                            </h2>
                            <Button
                                size="sm"
                                variant={showQuickCreate ? "secondary" : "outline"}
                                onClick={() => setShowQuickCreate((v) => !v)}
                                className="h-7 px-3 rounded-xl gap-1.5 text-[10px] font-black uppercase tracking-widest"
                            >
                                {showQuickCreate ? (
                                    <><X className="w-3 h-3" />Cancel</>
                                ) : (
                                    <><Zap className="w-3 h-3" />Quick Create</>
                                )}
                            </Button>
                        </div>

                        {/* Quick Create Inline Form */}
                        {showQuickCreate && (
                            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-3.5 h-3.5 text-primary" />
                                    <span className="text-xs font-black uppercase tracking-widest text-primary">Quick Create Policy</span>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="col-span-2 space-y-1">
                                        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Name *</Label>
                                        <Input
                                            placeholder="e.g. Tesla Invoice Handler"
                                            value={quickForm.name}
                                            onChange={(e) => setQuickForm({ ...quickForm, name: e.target.value })}
                                            className="h-8 text-sm rounded-xl border-border/40 bg-background"
                                        />
                                    </div>

                                    <div className="col-span-2 space-y-1">
                                        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Description</Label>
                                        <Input
                                            placeholder="What does this policy do?"
                                            value={quickForm.description}
                                            onChange={(e) => setQuickForm({ ...quickForm, description: e.target.value })}
                                            className="h-8 text-xs rounded-xl border-border/40 bg-background"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Match Keywords</Label>
                                        <Input
                                            placeholder="tesla, invoice, PG&E (comma-sep)"
                                            value={quickForm.keywords}
                                            onChange={(e) => setQuickForm({ ...quickForm, keywords: e.target.value })}
                                            className="h-8 text-xs rounded-xl border-border/40 bg-background"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Match Strategy</Label>
                                        <select
                                            value={quickForm.matchStrategy}
                                            onChange={(e) => setQuickForm({ ...quickForm, matchStrategy: e.target.value as "ANY" | "ALL" })}
                                            className="h-8 w-full text-xs rounded-xl border border-border/40 bg-background px-3 text-foreground"
                                        >
                                            <option value="ANY">ANY keyword matches</option>
                                            <option value="ALL">ALL keywords match</option>
                                        </select>
                                    </div>

                                    <div className="col-span-2 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Actions</Label>
                                            <button
                                                type="button"
                                                onClick={addQuickAction}
                                                className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                                            >
                                                <Plus className="w-3 h-3" />Add Action
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {quickForm.actions.map((action, i) => {
                                                const filenameMode = !action.filename || action.filename === "" ? "original" : action.filename === "auto" ? "auto" : "custom";
                                                return (
                                                    <div key={i} className="space-y-1.5">
                                                        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 items-start">
                                                            <select
                                                                value={action.type}
                                                                onChange={(e) => updateQuickAction(i, "type", e.target.value)}
                                                                className="h-8 text-xs rounded-xl border border-border/40 bg-background px-2 text-foreground w-full"
                                                            >
                                                                <option value="copy">Copy to folder</option>
                                                                <option value="rename">Rename file (Pattern)</option>
                                                                <option value="log_csv">Log to CSV</option>
                                                                <option value="copy_to_gdrive">Copy to Google Drive</option>
                                                                <option value="append_to_google_sheet">Append to Google Sheet</option>
                                                            </select>
                                                            <div className="flex gap-2 items-center min-w-0">
                                                                {action.type !== "append_to_google_sheet" && (
                                                                    <Input
                                                                        placeholder={action.type === "copy" ? "/Car/" : action.type === "copy_to_gdrive" ? "Folder ID (empty = My Drive root)" : action.type === "rename" ? "Tesla-{date}" : "/logs/invoices.csv"}
                                                                        value={action.destination}
                                                                        onChange={(e) => updateQuickAction(i, "destination", e.target.value)}
                                                                        className="h-8 text-xs rounded-xl border-border/40 bg-background font-mono flex-1 min-w-0"
                                                                    />
                                                                )}
                                                                {quickForm.actions.length > 1 && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeQuickAction(i)}
                                                                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1"
                                                                    >
                                                                        <X className="w-3.5 h-3.5" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {(action.type === "copy" || action.type === "copy_to_gdrive") && (
                                                            <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 items-center">
                                                                <div aria-hidden="true" />
                                                                <div className="flex gap-2 items-center min-w-0">
                                                                    <span className="text-[10px] text-muted-foreground shrink-0">Filename:</span>
                                                                    <select
                                                                        value={filenameMode}
                                                                        onChange={(e) => {
                                                                            const mode = e.target.value;
                                                                            if (mode === "original") updateQuickAction(i, "filename", "");
                                                                            else if (mode === "auto") updateQuickAction(i, "filename", "auto");
                                                                            else updateQuickAction(i, "filename", "{date}_{issuer}_{document_type}");
                                                                        }}
                                                                        className="h-7 text-xs rounded-lg border border-border/40 bg-background px-2 text-foreground shrink-0"
                                                                    >
                                                                        <option value="original">Keep original</option>
                                                                        <option value="auto">Smart rename (AI)</option>
                                                                        <option value="custom">Custom pattern</option>
                                                                    </select>
                                                                    {filenameMode === "custom" && (
                                                                        <Input
                                                                            value={action.filename}
                                                                            onChange={(e) => updateQuickAction(i, "filename", e.target.value)}
                                                                            placeholder="{date}_{issuer}_{document_type}"
                                                                            className="h-7 text-xs rounded-lg border-border/40 bg-background font-mono flex-1 min-w-0"
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {action.type === "append_to_google_sheet" && (
                                                            <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2">
                                                                <div aria-hidden="true" />
                                                                <div className="flex flex-col gap-2">
                                                                    <div className="flex gap-2">
                                                                        <Input
                                                                            placeholder="Spreadsheet ID or Google Sheet URL"
                                                                            value={action.spreadsheet_id || ""}
                                                                            onChange={(e) => updateQuickAction(i, "spreadsheet_id", e.target.value)}
                                                                            className="h-7 text-xs rounded-lg flex-1"
                                                                        />
                                                                        <Input
                                                                            placeholder="Optional tab/range (e.g. Sheet1!A:F)"
                                                                            value={action.range || ""}
                                                                            onChange={(e) => updateQuickAction(i, "range", e.target.value)}
                                                                            className="h-7 text-xs rounded-lg w-32"
                                                                        />
                                                                    </div>
                                                                    <div className="flex flex-col gap-1.5 p-2 rounded-lg border border-border/40 bg-muted/20">
                                                                        <div className="flex items-center justify-between">
                                                                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Columns Mapping (A, B, C...)</Label>
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                className="h-6 text-[10px] px-2 py-0"
                                                                                onClick={() => {
                                                                                    const cols = [...(action.columns || []), ""];
                                                                                    updateQuickAction(i, "columns", cols);
                                                                                }}
                                                                            >
                                                                                <Plus className="w-3 h-3 mr-1" /> Add Col
                                                                            </Button>
                                                                        </div>
                                                                        {(action.columns || []).map((col: string, colIdx: number) => (
                                                                            <div key={colIdx} className="flex items-center gap-1.5">
                                                                                <span className="text-[10px] font-mono text-muted-foreground w-4 flex-shrink-0 text-center">
                                                                                    {String.fromCharCode(65 + colIdx)}
                                                                                </span>
                                                                                <Input
                                                                                    placeholder="e.g. {Date} or Static Text"
                                                                                    value={col}
                                                                                    onChange={(e) => {
                                                                                        const newCols = [...(action.columns || [])];
                                                                                        newCols[colIdx] = e.target.value;
                                                                                        updateQuickAction(i, "columns", newCols);
                                                                                    }}
                                                                                    className="h-7 text-xs rounded-lg font-mono flex-1"
                                                                                />
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        const newCols = (action.columns || []).filter((_, idx) => idx !== colIdx);
                                                                                        updateQuickAction(i, "columns", newCols);
                                                                                    }}
                                                                                    className="text-muted-foreground hover:text-destructive p-1"
                                                                                >
                                                                                    <X className="w-3 h-3" />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                        {(!action.columns || action.columns.length === 0) && (
                                                                            <div className="text-[10px] text-muted-foreground italic text-center py-1">
                                                                                No explicit mapping provided. Folio will auto-map by reading header row from the sheet template.
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tags</Label>
                                        <Input
                                            placeholder="finance, cars (comma-sep)"
                                            value={quickForm.tags}
                                            onChange={(e) => setQuickForm({ ...quickForm, tags: e.target.value })}
                                            className="h-8 text-xs rounded-xl border-border/40 bg-background"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Priority</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={999}
                                            value={quickForm.priority}
                                            onChange={(e) => setQuickForm({ ...quickForm, priority: Number(e.target.value) })}
                                            className="h-8 text-xs rounded-xl border-border/40 bg-background"
                                        />
                                    </div>
                                </div>

                                {hasInvalidAppendAction && (
                                    <p className="text-[10px] text-destructive">
                                        "Append to Google Sheet" actions require a Spreadsheet ID or Google Sheet URL.
                                    </p>
                                )}

                                <div className="flex gap-2 pt-1">
                                    <Button
                                        size="sm"
                                        onClick={handleQuickCreate}
                                        disabled={isQuickSaving || !quickForm.name.trim() || hasInvalidAppendAction}
                                        className="flex-1 h-8 rounded-xl font-black text-[10px] uppercase tracking-widest gap-1.5"
                                    >
                                        {isQuickSaving ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                            <><Plus className="w-3 h-3" />Create Policy</>
                                        )}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setShowQuickCreate(false)}
                                        className="h-8 px-3 rounded-xl"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}

                        {isLoading ? (
                            <div className="flex items-center justify-center py-16 text-muted-foreground">
                                <Loader2 className="w-6 h-6 animate-spin mr-3" />
                                Loading policies...
                            </div>
                        ) : policies.length === 0 ? (
                            <Alert className="rounded-2xl border-dashed">
                                <Info className="h-4 w-4" />
                                <AlertDescription className="text-sm">
                                    No policies yet. Use the Magic Composer above to create your first one.
                                </AlertDescription>
                            </Alert>
                        ) : (
                            <div className="space-y-2">
                                {policies.map((p) => (
                                    <div
                                        key={p.metadata.id}
                                        className={cn(
                                            "rounded-2xl border bg-card/50 shadow-sm overflow-hidden transition-all",
                                            p.metadata.enabled === false && "opacity-60"
                                        )}
                                    >
                                        {/* Policy Card Header */}
                                        <div className="flex items-center gap-3 px-5 py-4">
                                            {/* Toggle */}
                                            <button
                                                title={p.metadata.enabled === false ? "Enable policy" : "Disable policy"}
                                                onClick={() => handleToggle(p)}
                                                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                {p.metadata.enabled === false ? (
                                                    <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                                                ) : (
                                                    <ToggleRight className="w-5 h-5 text-primary" />
                                                )}
                                            </button>

                                            <div className="flex-1 min-w-0">
                                                {editingId === p.metadata.id && editDraft ? (
                                                    /* ── Edit Mode ── */
                                                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                                                        <Input
                                                            value={editDraft.name}
                                                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                                                            placeholder="Policy name"
                                                            className="h-7 text-sm font-semibold"
                                                        />
                                                        <Input
                                                            value={editDraft.description}
                                                            onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                                                            placeholder="Description"
                                                            className="h-7 text-xs"
                                                        />
                                                        <div className="flex gap-2">
                                                            <Input
                                                                value={editDraft.tags}
                                                                onChange={(e) => setEditDraft({ ...editDraft, tags: e.target.value })}
                                                                placeholder="Tags (comma-separated)"
                                                                className="h-7 text-xs flex-1"
                                                            />
                                                            <Input
                                                                type="number"
                                                                value={editDraft.priority}
                                                                onChange={(e) => setEditDraft({ ...editDraft, priority: Number(e.target.value) })}
                                                                placeholder="Priority"
                                                                className="h-7 text-xs w-20"
                                                                min={1} max={999}
                                                            />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    /* ── View Mode ── */
                                                    <>
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-bold text-sm truncate">{p.metadata.name}</span>
                                                            <Badge variant="outline" className="text-[9px] shrink-0">P{p.metadata.priority}</Badge>
                                                            {p.metadata.tags?.map((tag) => (
                                                                <Badge key={tag} variant="secondary" className="text-[9px] gap-1 shrink-0">
                                                                    <Tag className="w-2.5 h-2.5" />{tag}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.metadata.description}</p>
                                                    </>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-1 shrink-0">
                                                {editingId === p.metadata.id ? (
                                                    <>
                                                        <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={() => handleSaveEdit(p.metadata.id)}>Save</Button>
                                                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleCancelEdit}>Cancel</Button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            title="Edit metadata"
                                                            onClick={() => handleStartEdit(p)}
                                                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                        </button>
                                                        <button
                                                            title="Re-compose with AI"
                                                            onClick={() => handleRecompose(p)}
                                                            className="text-muted-foreground hover:text-primary transition-colors p-1"
                                                        >
                                                            <Sparkles className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                                                            onClick={() => setExpandedId(expandedId === p.metadata.id ? null : p.metadata.id)}
                                                        >
                                                            {expandedId === p.metadata.id ? (
                                                                <ChevronUp className="w-4 h-4" />
                                                            ) : (
                                                                <ChevronDown className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(p.metadata.id)}
                                                            className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {expandedId === p.metadata.id && (
                                            <div className="border-t px-5 py-4 bg-muted/20 space-y-3 animate-in slide-in-from-top-2 duration-200">
                                                <div className="grid grid-cols-3 gap-3 text-xs">
                                                    <div>
                                                        <div className="font-bold uppercase tracking-widest text-[9px] text-muted-foreground mb-1">Match ({p.spec.match.strategy})</div>
                                                        {p.spec.match.conditions.map((c, i) => (
                                                            <div key={i} className="text-muted-foreground">
                                                                <span className="font-mono bg-muted px-1 rounded text-[10px]">{c.type}</span>
                                                                {" "}
                                                                {Array.isArray(c.value) ? c.value.join(", ") : c.value}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold uppercase tracking-widest text-[9px] text-muted-foreground mb-1">Extract</div>
                                                        {p.spec.extract?.map((f) => (
                                                            <div key={f.key} className="text-muted-foreground">
                                                                <span className="font-mono bg-muted px-1 rounded text-[10px]">{f.key}</span>
                                                                {" "}({f.type}){f.required ? " *" : ""}
                                                            </div>
                                                        )) ?? <span className="text-muted-foreground/60">—</span>}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold uppercase tracking-widest text-[9px] text-muted-foreground mb-1">Actions</div>
                                                        {p.spec.actions?.map((a, i) => (
                                                            <div key={i} className="text-muted-foreground">
                                                                <span className="font-mono bg-muted px-1 rounded text-[10px]">{a.type}</span>
                                                                {" "}
                                                                {formatActionSummary(a)}
                                                            </div>
                                                        )) ?? <span className="text-muted-foreground/60">—</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {activeTab === "packs" && (
                <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                        Import curated policy bundles to instantly configure Folio for common use cases.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {PACKS.map((pack) => (
                            <div
                                key={pack.id}
                                className="rounded-2xl border bg-card/60 p-5 space-y-3 hover:border-primary/30 hover:shadow-md transition-all group"
                            >
                                <div>
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="font-black text-sm">{pack.name}</p>
                                        <Badge variant="outline" className="text-[9px] shrink-0">
                                            {pack.policies} policies
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">{pack.description}</p>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {pack.tags.map((tag) => (
                                        <Badge key={tag} variant="secondary" className="text-[9px] gap-1">
                                            <Tag className="w-2.5 h-2.5" />{tag}
                                        </Badge>
                                    ))}
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full h-8 rounded-xl font-black text-[10px] uppercase tracking-widest group-hover:border-primary/40 transition-all"
                                    onClick={() => toast.info(`"${pack.name}" import coming soon!`)}
                                >
                                    <Package className="w-3 h-3 mr-2" />
                                    Import Pack
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
