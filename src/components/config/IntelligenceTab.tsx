import { RefreshCw, Check, Clock, Bot } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { TTSSettings } from '../TTSSettings';
import { LoadingSpinner } from '../LoadingSpinner';
import { Badge } from '../ui/badge';
import { useLanguage } from '../../context/LanguageContext';

type VisionState = "unknown" | "supported" | "unsupported";

type VisionCapabilityEntry = {
    state: "supported" | "unsupported" | "pending_unsupported";
    learned_at?: string;
    expires_at?: string;
    reason?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseVisionCapabilityRows(localSettings: any, defaultProvider: string) {
    const rows: Array<{
        key: string;
        provider: string;
        model: string;
        modality: "image" | "pdf";
        state: VisionState;
        learnedAt?: string;
        expiresAt?: string;
        reason?: string;
        isCurrent: boolean;
    }> = [];

    const currentProvider = (localSettings.llm_provider || defaultProvider || "").trim();
    const currentModel = (localSettings.llm_model || "").trim();
    const currentImageKey = currentProvider && currentModel ? `${currentProvider}:${currentModel}` : "";
    const currentPdfKey = currentProvider && currentModel ? `${currentProvider}:${currentModel}:pdf` : "";

    const rawMap = localSettings.vision_model_capabilities;
    if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
        for (const [key, rawValue] of Object.entries(rawMap as Record<string, unknown>)) {
            if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
            const value = rawValue as VisionCapabilityEntry;
            const rawState = value.state;
            if (rawState !== "supported" && rawState !== "unsupported" && rawState !== "pending_unsupported") continue;

            const parts = key.split(":");
            const provider = parts[0] || "unknown";
            const hasPdfSuffix = parts.length >= 3 && parts[parts.length - 1] === "pdf";
            const modality: "image" | "pdf" = hasPdfSuffix ? "pdf" : "image";
            const modelParts = hasPdfSuffix ? parts.slice(1, -1) : parts.slice(1);
            const model = modelParts.length > 0 ? modelParts.join(":") : key;
            const state: VisionState = rawState === "pending_unsupported" ? "unknown" : rawState;
            rows.push({
                key,
                provider,
                model,
                modality,
                state,
                learnedAt: value.learned_at,
                expiresAt: value.expires_at,
                reason: value.reason,
                isCurrent: key === currentImageKey || key === currentPdfKey,
            });
        }
    }

    if (currentImageKey && !rows.some((r) => r.key === currentImageKey)) {
        rows.unshift({
            key: currentImageKey,
            provider: currentProvider,
            model: currentModel,
            modality: "image",
            state: "unknown",
            isCurrent: true,
        });
    }

    if (currentPdfKey && !rows.some((r) => r.key === currentPdfKey)) {
        rows.unshift({
            key: currentPdfKey,
            provider: currentProvider,
            model: currentModel,
            modality: "pdf",
            state: "unknown",
            isCurrent: true,
        });
    }

    rows.sort((a, b) => {
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;
        return `${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`);
    });

    return rows;
}

function stateToBadgeVariant(state: VisionState): "default" | "secondary" | "destructive" | "outline" {
    if (state === "supported") return "default";
    if (state === "unsupported") return "destructive";
    return "secondary";
}

function toDomId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function IntelligenceTab({
    localSettings,
    setLocalSettings,
    handleSaveSettings,
    savingSettings,
    handleTestConnection,
    testingLlm,
    providersWithSaved,
    modelsWithSaved,
    embedProvidersWithSaved,
    embedModelsWithSaved,
    handleProviderChange,
    handleEmbedProviderChange,
    DEFAULT_PROVIDER
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: any) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { t } = useLanguage();
    const capabilityRows = parseVisionCapabilityRows(localSettings, DEFAULT_PROVIDER);

    const setCapabilityState = (key: string, state: VisionState) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalSettings((s: any) => {
            const currentMap = s?.vision_model_capabilities && typeof s.vision_model_capabilities === "object" && !Array.isArray(s.vision_model_capabilities)
                ? { ...s.vision_model_capabilities }
                : {};

            if (state === "unknown") {
                delete currentMap[key];
            } else {
                const now = new Date().toISOString();
                const ttlDays = state === "supported" ? 180 : 30;
                const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
                currentMap[key] = {
                    ...(currentMap[key] || {}),
                    state,
                    learned_at: now,
                    expires_at: expiresAt,
                    reason: "manual_override",
                };
            }

            return {
                ...s,
                vision_model_capabilities: currentMap,
            };
        });
    };

    const clearCapabilityMap = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalSettings((s: any) => ({
            ...s,
            vision_model_capabilities: {},
        }));
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 text-indigo-500" />
                        AI Model Configuration
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <label className="text-sm font-medium" htmlFor="llm-provider-select">LLM Provider</label>
                            <select
                                id="llm-provider-select"
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.llm_provider || DEFAULT_PROVIDER}
                                onChange={(e) => handleProviderChange(e.target.value)}
                            >
                                <option value={DEFAULT_PROVIDER}>RealTimeX AI</option>
                                {providersWithSaved.filter((p: Record<string, string>) => p.provider !== DEFAULT_PROVIDER).map((p: Record<string, string>) => (
                                    <option key={p.provider} value={p.provider}>{p.name || p.provider}</option>
                                ))}
                            </select>
                            <label className="text-sm font-medium" htmlFor="llm-model-select">LLM Model</label>
                            <select
                                id="llm-model-select"
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.llm_model || ''}
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                onChange={(e) => setLocalSettings((s: any) => ({ ...s, llm_model: e.target.value }))}
                            >
                                {modelsWithSaved.map((m: Record<string, string>) => (
                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-4">
                            <label className="text-sm font-medium" htmlFor="embedding-provider-select">Embedding Provider</label>
                            <select
                                id="embedding-provider-select"
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.embedding_provider || DEFAULT_PROVIDER}
                                onChange={(e) => handleEmbedProviderChange(e.target.value)}
                            >
                                <option value={DEFAULT_PROVIDER}>RealTimeX Embed</option>
                                {embedProvidersWithSaved.filter((p: Record<string, string>) => p.provider !== DEFAULT_PROVIDER).map((p: Record<string, string>) => (
                                    <option key={p.provider} value={p.provider}>{p.name || p.provider}</option>
                                ))}
                            </select>
                            <label className="text-sm font-medium" htmlFor="embedding-model-select">Embedding Model</label>
                            <select
                                id="embedding-model-select"
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.embedding_model || ''}
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                onChange={(e) => setLocalSettings((s: any) => ({ ...s, embedding_model: e.target.value }))}
                            >
                                {embedModelsWithSaved.map((m: Record<string, string>) => (
                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={handleTestConnection} disabled={testingLlm}>
                            Test Connection
                        </Button>
                        <Button onClick={handleSaveSettings} disabled={savingSettings}>
                            {savingSettings ? <LoadingSpinner size="sm" className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                            Save AI Config
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <TTSSettings />

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bot className="w-5 h-5 text-primary" />
                        Vision Capability Overrides
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Review and edit learned multimodal support per model. Set to <span className="font-medium">Unknown</span> to let Folio probe again.
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    {capabilityRows.length === 0 ? (
                        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                            No model capability entries yet.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {capabilityRows.map((row) => (
                                <div key={row.key} className="rounded-md border p-3">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="font-medium break-all">{row.provider} / {row.model}</p>
                                                <Badge variant="outline">{row.modality}</Badge>
                                                {row.isCurrent ? <Badge variant="outline">Current</Badge> : null}
                                                <Badge variant={stateToBadgeVariant(row.state)}>
                                                    {row.state}
                                                </Badge>
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {row.reason ? `reason: ${row.reason}` : "reason: not set"}
                                                {row.expiresAt ? ` • expires: ${new Date(row.expiresAt).toLocaleString()}` : ""}
                                            </p>
                                        </div>
                                        <div className="w-full md:w-[180px]">
                                            <label className="sr-only" htmlFor={`vision-state-${toDomId(row.key)}`}>Vision capability state</label>
                                            <select
                                                id={`vision-state-${toDomId(row.key)}`}
                                                className="w-full h-10 border rounded-md px-3 bg-background"
                                                value={row.state}
                                                onChange={(e) => setCapabilityState(row.key, e.target.value as VisionState)}
                                            >
                                                <option value="unknown">Unknown (auto-probe)</option>
                                                <option value="supported">Supported</option>
                                                <option value="unsupported">Unsupported</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={clearCapabilityMap}>
                            Reset Learned Map
                        </Button>
                        <Button onClick={handleSaveSettings} disabled={savingSettings}>
                            {savingSettings ? <LoadingSpinner size="sm" className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                            Save Capability Overrides
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> System Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium" htmlFor="sync-interval-input">Sync Interval (minutes)</label>
                            <Input
                                id="sync-interval-input"
                                type="number"
                                value={localSettings.sync_interval_minutes || 5}
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                onChange={(e) => setLocalSettings((s: any) => ({ ...s, sync_interval_minutes: parseInt(e.target.value) }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium" htmlFor="storage-path-input">Storage Path</label>
                            <Input
                                id="storage-path-input"
                                placeholder="/path/to/storage"
                                value={localSettings.storage_path || ''}
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                onChange={(e) => setLocalSettings((s: any) => ({ ...s, storage_path: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={handleSaveSettings} disabled={savingSettings}>
                            {savingSettings ? <LoadingSpinner size="sm" className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                            Save System Settings
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
