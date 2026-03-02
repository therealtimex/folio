import { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { toast } from './Toast';
import { usePageAgent } from '../hooks/usePageAgent';
import { MailSourcesTab } from './config/MailTab';
import { IntelligenceTab } from './config/IntelligenceTab';
import { StorageTab } from './config/StorageTab';
import { BaselineTab } from './config/BaselineTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const DEFAULT_PROVIDER = 'realtimexai';

export function Configuration() {
    const { state, actions } = useApp();
    const { t } = useLanguage();
    const [savingSettings, setSavingSettings] = useState(false);
    const [testingLlm, setTestingLlm] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [localSettings, setLocalSettings] = useState<any>({});

    usePageAgent({
        page_id: 'configuration_wizard',
        system_instruction: t('config.agent.systemInstruction'),
        data: {
            accounts_count: state.accounts.length,
            connected_providers: state.accounts.map(a => a.provider),
            rules_count: state.rules.length,
            active_rules: state.rules.filter(r => r.is_enabled).map(r => r.name),
            current_settings: {
                llm_provider: localSettings.llm_provider,
                llm_model: localSettings.llm_model,
                ingestion_llm_provider: localSettings.ingestion_llm_provider,
                ingestion_llm_model: localSettings.ingestion_llm_model,
            }
        }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [chatProviders, setChatProviders] = useState<any[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [embedProviders, setEmbedProviders] = useState<any[]>([]);

    useEffect(() => {
        const fetchProviders = async () => {
            try {
                const response = await api.getChatProviders();
                if (response.data) setChatProviders(response.data.providers || []);
            } catch (error) { console.error(error); }
        };
        fetchProviders();

        const fetchEmbedProviders = async () => {
            try {
                const response = await api.getEmbedProviders();
                if (response.data) setEmbedProviders(response.data.providers || []);
            } catch (error) { console.error(error); }
        };
        fetchEmbedProviders();
    }, [t]);

    const selectedProvider = chatProviders.find(p => p.provider === (localSettings.llm_provider || DEFAULT_PROVIDER));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const availableModels = selectedProvider?.models || [];

    const effectiveIngestionProvider = localSettings.ingestion_llm_provider || localSettings.llm_provider || DEFAULT_PROVIDER;
    const selectedIngestionProvider = chatProviders.find(p => p.provider === effectiveIngestionProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const availableIngestionModels = selectedIngestionProvider?.models || [];

    const selectedEmbedProvider = embedProviders.find(p => p.provider === (localSettings.embedding_provider || DEFAULT_PROVIDER));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const availableEmbedModels = selectedEmbedProvider?.models || [];

    const modelsWithSaved = useMemo(() => {
        if (!localSettings.llm_model) return availableModels;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasModel = availableModels.some((m: any) => m.id === localSettings.llm_model);
        if (hasModel) return availableModels;
        return [{ id: localSettings.llm_model, name: `${localSettings.llm_model} (saved)` }, ...availableModels];
    }, [availableModels, localSettings.llm_model]);

    const providersWithSaved = useMemo(() => {
        if (!localSettings.llm_provider || localSettings.llm_provider === DEFAULT_PROVIDER) return chatProviders;
        const hasProvider = chatProviders.some(p => p.provider === localSettings.llm_provider);
        if (hasProvider) return chatProviders;
        return [{ provider: localSettings.llm_provider, name: `${localSettings.llm_provider} (saved)`, models: [] }, ...chatProviders];
    }, [chatProviders, localSettings.llm_provider]);

    const ingestionModelsWithSaved = useMemo(() => {
        const effectiveModel = localSettings.ingestion_llm_model || localSettings.llm_model;
        if (!effectiveModel) return availableIngestionModels;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasModel = availableIngestionModels.some((m: any) => m.id === effectiveModel);
        if (hasModel) return availableIngestionModels;
        return [{ id: effectiveModel, name: `${effectiveModel} (saved)` }, ...availableIngestionModels];
    }, [availableIngestionModels, localSettings.ingestion_llm_model, localSettings.llm_model]);

    const ingestionProvidersWithSaved = useMemo(() => {
        if (!localSettings.ingestion_llm_provider || localSettings.ingestion_llm_provider === DEFAULT_PROVIDER) return chatProviders;
        const hasProvider = chatProviders.some(p => p.provider === localSettings.ingestion_llm_provider);
        if (hasProvider) return chatProviders;
        return [{ provider: localSettings.ingestion_llm_provider, name: `${localSettings.ingestion_llm_provider} (saved)`, models: [] }, ...chatProviders];
    }, [chatProviders, localSettings.ingestion_llm_provider]);

    const embedModelsWithSaved = useMemo(() => {
        if (!localSettings.embedding_model) return availableEmbedModels;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasModel = availableEmbedModels.some((m: any) => m.id === localSettings.embedding_model);
        if (hasModel) return availableEmbedModels;
        return [{ id: localSettings.embedding_model, name: `${localSettings.embedding_model} (saved)` }, ...availableEmbedModels];
    }, [availableEmbedModels, localSettings.embedding_model]);

    const embedProvidersWithSaved = useMemo(() => {
        if (!localSettings.embedding_provider || localSettings.embedding_provider === DEFAULT_PROVIDER) return embedProviders;
        const hasProvider = embedProviders.some(p => p.provider === localSettings.embedding_provider);
        if (hasProvider) return embedProviders;
        return [{ provider: localSettings.embedding_provider, name: `${localSettings.embedding_provider} (saved)`, models: [] }, ...embedProviders];
    }, [embedProviders, localSettings.embedding_provider]);

    const handleProviderChange = (providerId: string) => {
        const provider = chatProviders.find(p => p.provider === providerId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalSettings((s: any) => ({
            ...s,
            llm_provider: providerId,
            llm_model: provider?.models?.[0]?.id || ''
        }));
    };

    const handleEmbedProviderChange = (providerId: string) => {
        const provider = embedProviders.find(p => p.provider === providerId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalSettings((s: any) => ({
            ...s,
            embedding_provider: providerId,
            embedding_model: provider?.models?.[0]?.id || ''
        }));
    };

    const handleIngestionProviderChange = (providerId: string) => {
        const provider = chatProviders.find(p => p.provider === providerId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalSettings((s: any) => ({
            ...s,
            ingestion_llm_provider: providerId,
            ingestion_llm_model: provider?.models?.[0]?.id || ''
        }));
    };

    const handleTestConnection = async () => {
        setTestingLlm(true);
        try {
            const response = await api.testLlm({
                llm_provider: localSettings.llm_provider || undefined,
                llm_model: localSettings.llm_model || undefined
            });
            if (response.data?.success) {
                toast.success(response.data.message);
            } else {
                toast.error(t('config.toast.connectionFailed'));
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
        } catch (error: any) {
            toast.error(t('config.toast.connectionFailed'));
        } finally {
            setTestingLlm(false);
        }
    };

    useEffect(() => {
        actions.fetchAccounts();
        actions.fetchRules();
        actions.fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (state.settings) {
            setLocalSettings(state.settings);
        }
    }, [state.settings]);

    const handleSaveSettings = async () => {
        setSavingSettings(true);
        const success = await actions.updateSettings(localSettings);
        setSavingSettings(false);
        if (success) {
            toast.success(t('config.toast.settingsSaved'));
        }
    };

    return (
        <div className="w-full mx-auto px-8 py-10 space-y-6 animate-in fade-in duration-500 flex flex-col h-full">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
                    <p className="text-muted-foreground mt-1">Manage your connected integrations and AI providers.</p>
                </div>
            </div>

            <Tabs defaultValue="mail" className="w-full">
                <TabsList className="grid w-full grid-cols-4 max-w-lg h-12">
                    <TabsTrigger value="mail" className="h-10">Mail</TabsTrigger>
                    <TabsTrigger value="storage" className="h-10">Storage</TabsTrigger>
                    <TabsTrigger value="intelligence" className="h-10">Intelligence</TabsTrigger>
                    <TabsTrigger value="baseline" className="h-10">Baseline</TabsTrigger>
                </TabsList>

                <div className="mt-8">
                    <TabsContent value="mail" className="m-0 border-none p-0 outline-none">
                        <MailSourcesTab
                            localSettings={localSettings}
                            setLocalSettings={setLocalSettings}
                            handleSaveSettings={handleSaveSettings}
                            savingSettings={savingSettings}
                        />
                    </TabsContent>

                    <TabsContent value="storage" className="m-0 border-none p-0 outline-none">
                        <StorageTab />
                    </TabsContent>

                    <TabsContent value="intelligence" className="m-0 border-none p-0 outline-none">
                        <IntelligenceTab
                            localSettings={localSettings}
                            setLocalSettings={setLocalSettings}
                            handleSaveSettings={handleSaveSettings}
                            savingSettings={savingSettings}
                            handleTestConnection={handleTestConnection}
                            testingLlm={testingLlm}
                            providersWithSaved={providersWithSaved}
                            modelsWithSaved={modelsWithSaved}
                            embedProvidersWithSaved={embedProvidersWithSaved}
                            embedModelsWithSaved={embedModelsWithSaved}
                            ingestionProvidersWithSaved={ingestionProvidersWithSaved}
                            ingestionModelsWithSaved={ingestionModelsWithSaved}
                            handleProviderChange={handleProviderChange}
                            handleEmbedProviderChange={handleEmbedProviderChange}
                            handleIngestionProviderChange={handleIngestionProviderChange}
                            DEFAULT_PROVIDER={DEFAULT_PROVIDER}
                        />
                    </TabsContent>

                    <TabsContent value="baseline" className="m-0 border-none p-0 outline-none">
                        <BaselineTab />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
