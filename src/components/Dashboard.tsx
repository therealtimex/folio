import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "./ui/card";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Button } from "./ui/button";
import { Logo } from "./Logo";
import { FileText, Database, Share2, Activity, Upload, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { api, DashboardStats } from "../lib/api";
import { getSupabaseClient } from "../lib/supabase-config";
import { toast } from "./Toast";

interface DashboardProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configSnapshot: any;
    configSource: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setActivePage: any;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Dashboard({ configSnapshot, configSource, setActivePage }: DashboardProps) {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [isLoadingStats, setIsLoadingStats] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchStats = useCallback(async () => {
        setIsLoadingStats(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token ?? null;
            if (!token) return;

            const res = await api.getDashboardStats(token);
            if (res.data?.success) {
                setStats(res.data.stats);
            }
        } catch (e) {
            console.error("Failed to fetch dashboard stats", e);
        } finally {
            setIsLoadingStats(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    // ─── File handling ────────────────────────────────────────────────────────
    const handleFiles = async (files: FileList | File[]) => {
        const arr = Array.from(files);
        if (!arr.length) return;

        // Immediately navigate to the Funnel tab so the user can watch the pipeline
        setActivePage("funnel");

        setIsUploading(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token ?? null;
            if (!token) return;

            for (const file of arr) {
                toast.info(`Ingesting ${file.name}…`);
                const result = await api.uploadDocument?.(file, token);
                if (result?.success) {
                    if (result.ingestion?.status === "duplicate") {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const orig = (result.ingestion.extracted as any)?.original_filename ?? "a previous upload";
                        toast.warning(`${file.name} is a duplicate of "${orig}" — skipped.`);
                    } else {
                        toast.success(`${file.name} → ${result.ingestion?.status}`);
                    }
                } else {
                    toast.error(`Failed to ingest ${file.name}`);
                }
            }
            // Refresh stats after upload
            await fetchStats();
        } finally {
            setIsUploading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
    };

    return (
        <div className="w-full mx-auto px-8 py-10 space-y-12 animate-in fade-in duration-700">
            {/* Header Content */}
            <div className="text-center space-y-3">
                <h2 className="text-4xl font-black tracking-tight flex items-center justify-center gap-3">
                    <Logo className="w-10 h-10 animate-pulse" />
                    Command Center
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                    Central intelligence hub for document ingestion, routing, and synthetic knowledge.
                </p>
            </div>

            <div className="w-full space-y-10">
                {/* 1. High-Level Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        title="Documents Ingested"
                        value={stats?.totalDocuments}
                        icon={<FileText className="w-5 h-5 text-blue-500" />}
                        isLoading={isLoadingStats}
                        colorClass="bg-blue-500/10"
                    />
                    <StatCard
                        title="Active Policies"
                        value={stats?.activePolicies}
                        icon={<Share2 className="w-5 h-5 text-emerald-500" />}
                        isLoading={isLoadingStats}
                        colorClass="bg-emerald-500/10"
                    />
                    <StatCard
                        title="Knowledge Chunks"
                        value={stats?.ragChunks}
                        icon={<Database className="w-5 h-5 text-purple-500" />}
                        isLoading={isLoadingStats}
                        colorClass="bg-purple-500/10"
                    />
                    <StatCard
                        title="Automation Runs"
                        value={stats?.automationRuns}
                        icon={<Activity className="w-5 h-5 text-amber-500" />}
                        isLoading={isLoadingStats}
                        colorClass="bg-amber-500/10"
                    />
                </div>

                {/* 2. Actions & Drop Zone */}
                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Main Drop Zone */}
                    <div className="lg:col-span-2">
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                                "h-full rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-4 py-16",
                                isDragging
                                    ? "border-primary bg-primary/5 scale-[1.01]"
                                    : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30"
                            )}
                        >
                            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => e.target.files && handleFiles(e.target.files)} />
                            {isUploading ? (
                                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                            ) : (
                                <Upload className={cn("w-12 h-12 transition-colors", isDragging ? "text-primary" : "text-muted-foreground/50")} />
                            )}
                            <div className="text-center space-y-1">
                                <p className="text-lg font-medium text-foreground">
                                    {isDragging ? "Drop to ingest..." : "Drag & drop files to ingest"}
                                </p>
                                <p className="text-sm text-muted-foreground/60">
                                    Supports .pdf, .docx, .md, .txt (up to 20MB)
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Action Cards */}
                    <div className="flex flex-col gap-4">
                        <Card
                            className="flex-1 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all flex flex-col items-center justify-center p-6 text-center shadow-sm"
                            onClick={() => setActivePage("chat")}
                        >
                            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-4">
                                <MessageSquare className="w-6 h-6 text-indigo-500" />
                            </div>
                            <h3 className="font-bold mb-1">Chat with Data</h3>
                            <p className="text-xs text-muted-foreground">Ask questions against your vectorized knowledge base.</p>
                        </Card>

                        <Card
                            className="flex-1 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all flex flex-col items-center justify-center p-6 text-center shadow-sm"
                            onClick={() => setActivePage("policies")}
                        >
                            <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-4">
                                <Share2 className="w-6 h-6 text-orange-500" />
                            </div>
                            <h3 className="font-bold mb-1">Create Policy</h3>
                            <p className="text-xs text-muted-foreground">Define a new routing and automation contract.</p>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon, isLoading, colorClass }: { title: string, value?: number, icon: React.ReactNode, isLoading: boolean, colorClass: string }) {
    return (
        <Card className="shadow-sm">
            <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colorClass)}>
                        {icon}
                    </div>
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-muted-foreground font-medium">{title}</p>
                    {isLoading ? (
                        <div className="h-8 w-16 bg-muted animate-pulse rounded-md" />
                    ) : (
                        <p className="text-3xl font-black">{value !== undefined ? value.toLocaleString() : "0"}</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
