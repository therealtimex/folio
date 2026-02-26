import { useCallback, useEffect, useState } from 'react';
import { Brain, Plus, Trash2, Check, ChevronDown, ChevronUp, History, Sparkles, Cpu, Loader2, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { LoadingSpinner } from '../LoadingSpinner';
import { toast } from '../Toast';
import { api } from '../../lib/api';
import { getSupabaseClient } from '../../lib/supabase-config';
import type { BaselineField, BaselineConfig } from '../../lib/types';

function apiErrMsg(err: unknown, fallback: string): string {
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && 'message' in (err as any)) return (err as any).message;
    return fallback;
}

const FIELD_TYPES = ['string', 'number', 'date', 'currency', 'string[]'] as const;

export function BaselineTab() {
    const [token, setToken] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [context, setContext] = useState('');
    const [fields, setFields] = useState<BaselineField[]>([]);
    const [activeVersion, setActiveVersion] = useState<number | null>(null);
    const [history, setHistory] = useState<BaselineConfig[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    // ── Magic Composer ────────────────────────────────────────────────────────
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerDesc, setComposerDesc] = useState('');
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [suggestion, setSuggestion] = useState<{ context: string; fields: BaselineField[] } | null>(null);
    const [chatProviders, setChatProviders] = useState<{ provider: string; models: { id: string }[] }[]>([]);
    const [selectedProvider, setSelectedProvider] = useState('');
    const [selectedModel, setSelectedModel] = useState('');

    // Fetch session token then load config in one shot
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const supabase = getSupabaseClient();
                const { data: sessionData } = await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }));
                const tok = sessionData.session?.access_token ?? null;
                setToken(tok);

                const res = await api.getBaselineConfig(tok);
                if (res.data) {
                    if (res.data.config) {
                        setContext(res.data.config.context ?? '');
                        setFields(res.data.config.fields);
                        setActiveVersion(res.data.config.version);
                    } else {
                        setFields(res.data.defaults);
                    }
                }
            } catch {
                toast.error('Failed to load baseline config');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const fetchProviders = useCallback(async () => {
        try {
            const resp = await api.getSDKChatProviders();
            const providers = resp?.data?.providers ?? [];
            setChatProviders(providers);
            if (providers.length > 0 && !selectedProvider) {
                setSelectedProvider(providers[0].provider);
                setSelectedModel(providers[0].models?.[0]?.id ?? '');
            }
        } catch {
            // providers unavailable — suggest will use SDK default
        }
    }, [selectedProvider]);

    useEffect(() => {
        if (composerOpen && chatProviders.length === 0) fetchProviders();
    }, [composerOpen, chatProviders.length, fetchProviders]);

    const loadHistory = async () => {
        const res = await api.getBaselineConfigHistory(token);
        if (res.data) setHistory(res.data.history);
        setShowHistory(true);
    };

    const toggleField = (key: string) =>
        setFields((fs) => fs.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)));

    const updateFieldDescription = (key: string, description: string) =>
        setFields((fs) => fs.map((f) => (f.key === key ? { ...f, description } : f)));

    const addCustomField = () =>
        setFields((fs) => [
            ...fs,
            { key: '', type: 'string', description: '', enabled: true, is_default: false },
        ]);

    const updateCustomField = (index: number, patch: Partial<BaselineField>) =>
        setFields((fs) => fs.map((f, i) => (i === index ? { ...f, ...patch } : f)));

    const removeCustomField = (index: number) =>
        setFields((fs) => fs.filter((_, i) => i !== index));

    const handleSave = async () => {
        const enabledCount = fields.filter((f) => f.enabled).length;
        if (enabledCount === 0) {
            toast.error('At least one field must be enabled');
            return;
        }
        const invalidCustom = fields.filter(
            (f) => !f.is_default && f.enabled && (!f.key.trim() || !f.description.trim())
        );
        if (invalidCustom.length > 0) {
            toast.error('Custom fields require both a key and a description');
            return;
        }
        setSaving(true);
        try {
            const res = await api.saveBaselineConfig({ context: context || null, fields, activate: true }, token);
            if (res.data?.success) {
                setActiveVersion(res.data.config.version);
                toast.success(`Baseline config saved as v${res.data.config.version}`);
                if (showHistory) loadHistory();
            } else {
                toast.error('Failed to save config');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleActivate = async (id: string, version: number) => {
        const res = await api.activateBaselineConfig(id, token);
        if (res.data?.success) {
            setActiveVersion(version);
            toast.success(`v${version} is now active`);
            loadHistory();
        }
    };

    // ── Magic Composer handlers ───────────────────────────────────────────────

    const handleSuggest = async () => {
        if (!composerDesc.trim()) return;
        setIsSuggesting(true);
        setSuggestion(null);
        try {
            const resp = await api.suggestBaselineConfig(
                {
                    description: composerDesc,
                    provider: selectedProvider || undefined,
                    model: selectedModel || undefined,
                },
                token
            );
            if (resp.data?.suggestion) {
                setSuggestion(resp.data.suggestion);
                toast.success('Suggestion ready — review and apply below.');
            } else {
                toast.error(apiErrMsg(resp.error, 'Suggestion failed.'));
            }
        } catch {
            toast.error('LLM suggestion failed.');
        } finally {
            setIsSuggesting(false);
        }
    };

    const handleApplySuggestion = () => {
        if (!suggestion) return;
        // Apply context (replace)
        setContext(suggestion.context);
        // Merge custom fields: append only fields whose key isn't already present
        setFields((current) => {
            const existingKeys = new Set(current.map((f) => f.key));
            const newFields = suggestion.fields.filter((f) => f.key && !existingKeys.has(f.key));
            return [...current, ...newFields];
        });
        setSuggestion(null);
        setComposerDesc('');
        setComposerOpen(false);
        toast.success('Suggestion applied — review fields then Save & Activate.');
    };

    // ─────────────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <LoadingSpinner size="md" />
            </div>
        );
    }

    const defaultFields = fields.filter((f) => f.is_default);
    const customFields = fields.filter((f) => !f.is_default);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">

            {/* ── Magic Composer ─────────────────────────────────────────── */}
            <Card className="border-violet-500/20 bg-violet-500/5">
                <CardHeader
                    className="cursor-pointer select-none"
                    onClick={() => {
                        setComposerOpen((o) => !o);
                        setSuggestion(null);
                    }}
                >
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Sparkles className="w-4 h-4 text-violet-500" />
                            Magic Composer
                        </CardTitle>
                        {composerOpen
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        }
                    </div>
                    {!composerOpen && (
                        <CardDescription>
                            Describe your workflow — AI will suggest a context string and custom fields.
                        </CardDescription>
                    )}
                </CardHeader>

                {composerOpen && (
                    <CardContent className="space-y-4 pt-0">
                        <p className="text-xs text-muted-foreground">
                            Describe your workflow — AI will suggest a context string and custom fields tailored to your documents.
                        </p>

                        {/* Provider selector */}
                        {chatProviders.length > 0 && (
                            <div className="flex gap-2 items-center">
                                <Cpu className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <select
                                    value={`${selectedProvider}::${selectedModel}`}
                                    onChange={(e) => {
                                        const [p, m] = e.target.value.split('::');
                                        setSelectedProvider(p);
                                        setSelectedModel(m);
                                    }}
                                    className="text-xs rounded-lg border border-border/40 bg-background px-2 py-1 flex-1 max-w-xs"
                                >
                                    {chatProviders.flatMap((p) =>
                                        (p.models ?? []).map((m) => (
                                            <option key={`${p.provider}::${m.id}`} value={`${p.provider}::${m.id}`}>
                                                {p.provider} / {m.id}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <span className="text-[10px] text-muted-foreground">for suggestion</span>
                            </div>
                        )}

                        <div className="flex gap-3 items-start">
                            <textarea
                                className="flex-1 min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm resize-y
                                           focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                                placeholder='e.g. "I process SaaS vendor invoices, software licences, and employment contracts for a startup. Vendors include Stripe, AWS, and GitHub. Documents are in English and French."'
                                value={composerDesc}
                                onChange={(e) => setComposerDesc(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSuggest();
                                }}
                            />
                            <Button
                                onClick={handleSuggest}
                                disabled={isSuggesting || !composerDesc.trim()}
                                className="h-10 w-10 p-0 rounded-xl flex items-center justify-center bg-violet-500 hover:bg-violet-600
                                           text-white shadow-lg shadow-violet-500/20 hover:scale-105 active:scale-95 transition-all"
                                title="Suggest baseline config with AI (⌘↵)"
                            >
                                {isSuggesting
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <Sparkles className="w-4 h-4" />
                                }
                            </Button>
                        </div>

                        {/* Suggestion preview */}
                        {suggestion && (
                            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3
                                            animate-in slide-in-from-bottom-2 duration-300">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-xs font-semibold text-violet-600 dark:text-violet-400">
                                        AI Suggestion
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setSuggestion(null)}
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                {/* Suggested context */}
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                        Extraction Context
                                    </p>
                                    <p className="text-xs bg-muted/60 rounded-lg px-3 py-2 leading-relaxed">
                                        {suggestion.context}
                                    </p>
                                </div>

                                {/* Suggested custom fields */}
                                {suggestion.fields.length > 0 && (
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                            Custom Fields to Add ({suggestion.fields.length})
                                        </p>
                                        <div className="space-y-1.5">
                                            {suggestion.fields.map((f, i) => (
                                                <div
                                                    key={i}
                                                    className="flex items-start gap-2 bg-muted/60 rounded-lg px-3 py-2"
                                                >
                                                    <code className="text-xs font-mono mt-0.5 shrink-0">{f.key}</code>
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                                        {f.type}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground leading-snug">
                                                        {f.description}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {suggestion.fields.length === 0 && (
                                    <p className="text-xs text-muted-foreground italic">
                                        No additional custom fields suggested for this workflow.
                                    </p>
                                )}

                                <div className="flex gap-2 pt-1">
                                    <Button
                                        size="sm"
                                        onClick={handleApplySuggestion}
                                        className="flex-1 h-8 rounded-xl font-black text-[10px] uppercase tracking-widest
                                                   bg-violet-500 hover:bg-violet-600 text-white"
                                    >
                                        Apply Suggestion
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setSuggestion(null)}
                                        className="h-8 px-3 rounded-xl"
                                    >
                                        Discard
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                )}
            </Card>

            {/* ── Extraction Context ─────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Brain className="w-5 h-5 text-violet-500" />
                        Extraction Context
                    </CardTitle>
                    <CardDescription>
                        Describe the kinds of documents you typically process. This context is injected
                        directly into the extraction prompt, helping the model specialise for your workflow.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <textarea
                        className="w-full min-h-[96px] rounded-md border bg-background px-3 py-2 text-sm resize-y
                                   focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                        placeholder='e.g. "I primarily process SaaS vendor invoices and software contracts. Documents are in English and French. Frequent vendors include Stripe, AWS, and GitHub."'
                        value={context}
                        onChange={(e) => setContext(e.target.value)}
                    />
                </CardContent>
            </Card>

            {/* ── Default fields ─────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Default Fields</CardTitle>
                    <CardDescription>
                        Built-in fields extracted from every document. Toggle to enable or disable.
                        Edit the description to give the model a better hint for your documents.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {defaultFields.map((field) => (
                        <div key={field.key} className="flex items-start gap-3 group">
                            <button
                                type="button"
                                onClick={() => toggleField(field.key)}
                                className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                                    ${field.enabled
                                        ? 'bg-violet-500 border-violet-500'
                                        : 'border-muted-foreground/40 bg-background'
                                    }`}
                            >
                                {field.enabled && <Check className="w-3 h-3 text-white" />}
                            </button>
                            <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                        {field.key}
                                    </code>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                        {field.type}
                                    </Badge>
                                </div>
                                <Input
                                    className="h-7 text-xs"
                                    value={field.description}
                                    disabled={!field.enabled}
                                    onChange={(e) => updateFieldDescription(field.key, e.target.value)}
                                />
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* ── Custom fields ──────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base">Custom Fields</CardTitle>
                            <CardDescription className="mt-1">
                                Add fields specific to your workflow — project codes, contract types,
                                department names, or any entity your documents carry.
                            </CardDescription>
                        </div>
                        <Button variant="outline" size="sm" onClick={addCustomField} className="gap-1.5">
                            <Plus className="w-3.5 h-3.5" />
                            Add Field
                        </Button>
                    </div>
                </CardHeader>
                {customFields.length > 0 && (
                    <CardContent className="space-y-4">
                        {fields.map((field, index) => {
                            if (field.is_default) return null;
                            return (
                                <div key={index} className="grid grid-cols-[1fr_120px_1fr_32px] gap-2 items-start">
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">Key</label>
                                        <Input
                                            className="h-8 text-xs font-mono"
                                            placeholder="e.g. project_code"
                                            value={field.key}
                                            onChange={(e) => updateCustomField(index, { key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">Type</label>
                                        <select
                                            className="w-full h-8 text-xs border rounded-md px-2 bg-background"
                                            value={field.type}
                                            onChange={(e) => updateCustomField(index, { type: e.target.value as BaselineField['type'] })}
                                        >
                                            {FIELD_TYPES.map((t) => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">Description / hint for the model</label>
                                        <Input
                                            className="h-8 text-xs"
                                            placeholder="What this field contains"
                                            value={field.description}
                                            onChange={(e) => updateCustomField(index, { description: e.target.value })}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeCustomField(index)}
                                        className="mt-6 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                    </CardContent>
                )}
            </Card>

            {/* ── Save + version history ─────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={showHistory ? () => setShowHistory(false) : loadHistory}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <History className="w-3.5 h-3.5" />
                    Version history
                    {activeVersion !== null && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                            v{activeVersion} active
                        </Badge>
                    )}
                    {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                <Button onClick={handleSave} disabled={saving} className="gap-2">
                    {saving ? <LoadingSpinner size="sm" /> : <Check className="w-4 h-4" />}
                    Save &amp; Activate
                </Button>
            </div>

            {/* ── History panel ──────────────────────────────────────────── */}
            {showHistory && (
                <Card>
                    <CardContent className="pt-4 space-y-2">
                        {history.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">No saved versions yet</p>
                        ) : (
                            history.map((v) => (
                                <div
                                    key={v.id}
                                    className="flex items-center justify-between py-2 px-3 rounded-lg border bg-muted/30"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-mono font-medium">v{v.version}</span>
                                        {v.is_active && (
                                            <Badge className="text-[10px] px-1.5 py-0 bg-violet-500 text-white">
                                                active
                                            </Badge>
                                        )}
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(v.created_at).toLocaleDateString(undefined, {
                                                month: 'short', day: 'numeric', year: 'numeric',
                                            })}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            · {v.fields.filter((f) => f.enabled).length} fields
                                            {v.context ? ' · context set' : ''}
                                        </span>
                                    </div>
                                    {!v.is_active && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-6 text-xs px-2"
                                            onClick={() => handleActivate(v.id, v.version)}
                                        >
                                            Activate
                                        </Button>
                                    )}
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
