import { RefreshCw, Check, Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { TTSSettings } from '../TTSSettings';
import { LoadingSpinner } from '../LoadingSpinner';
import { useLanguage } from '../../context/LanguageContext';

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
}: any) {
    const { t } = useLanguage();

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
                            <label className="text-sm font-medium">LLM Provider</label>
                            <select
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.llm_provider || DEFAULT_PROVIDER}
                                onChange={(e) => handleProviderChange(e.target.value)}
                            >
                                <option value={DEFAULT_PROVIDER}>RealTimeX AI</option>
                                {providersWithSaved.filter((p: any) => p.provider !== DEFAULT_PROVIDER).map((p: any) => (
                                    <option key={p.provider} value={p.provider}>{p.name || p.provider}</option>
                                ))}
                            </select>
                            <label className="text-sm font-medium">LLM Model</label>
                            <select
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.llm_model || ''}
                                onChange={(e) => setLocalSettings((s: any) => ({ ...s, llm_model: e.target.value }))}
                            >
                                {modelsWithSaved.map((m: any) => (
                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-4">
                            <label className="text-sm font-medium">Embedding Provider</label>
                            <select
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.embedding_provider || DEFAULT_PROVIDER}
                                onChange={(e) => handleEmbedProviderChange(e.target.value)}
                            >
                                <option value={DEFAULT_PROVIDER}>RealTimeX Embed</option>
                                {embedProvidersWithSaved.filter((p: any) => p.provider !== DEFAULT_PROVIDER).map((p: any) => (
                                    <option key={p.provider} value={p.provider}>{p.name || p.provider}</option>
                                ))}
                            </select>
                            <label className="text-sm font-medium">Embedding Model</label>
                            <select
                                className="w-full h-10 border rounded-md px-3 bg-background"
                                value={localSettings.embedding_model || ''}
                                onChange={(e) => setLocalSettings((s: any) => ({ ...s, embedding_model: e.target.value }))}
                            >
                                {embedModelsWithSaved.map((m: any) => (
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
                    <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> System Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Sync Interval (minutes)</label>
                            <Input
                                type="number"
                                value={localSettings.sync_interval_minutes || 5}
                                onChange={(e) => setLocalSettings((s: any) => ({ ...s, sync_interval_minutes: parseInt(e.target.value) }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Storage Path</label>
                            <Input
                                placeholder="/path/to/storage"
                                value={localSettings.storage_path || ''}
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
