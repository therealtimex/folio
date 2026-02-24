import { useMemo, useState, useEffect, useRef } from "react";
import {
    AlertTriangle,
    ExternalLink,
    Info,
    Loader2,
    Terminal,
    Clock,
    Calendar,
    Sparkles,
    ShieldCheck,
    Zap
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Alert, AlertDescription } from "../ui/alert";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toast } from "../Toast";
import { getSupabaseConfig } from "../../lib/supabase-config";
import type { MigrationStatus } from "../../lib/migration-check";
import { cn } from "@/lib/utils";

interface MigrationModalProps {
    /** Whether the modal is open */
    open: boolean;
    /** Callback when modal is closed */
    onOpenChange: (open: boolean) => void;
    /** Migration status */
    status: MigrationStatus;
    /** Callback when user snoozes the reminder */
    onSnooze?: (until: Date) => void;
}

export function MigrationModal({
    open,
    onOpenChange,
    status,
    onSnooze,
}: MigrationModalProps) {
    const config = getSupabaseConfig();

    const handleSnooze = (hours: number) => {
        const until = new Date(Date.now() + hours * 60 * 60 * 1000);
        onSnooze?.(until);
        toast.success(`Reminder snoozed until ${until.toLocaleTimeString()}`);
        onOpenChange(false);
    };

    const [isMigrating, setIsMigrating] = useState(false);
    const [migrationLogs, setMigrationLogs] = useState<string[]>([]);
    const [accessToken, setAccessToken] = useState("");
    const logsEndRef = useRef<HTMLDivElement>(null);

    const projectId = useMemo(() => {
        const url = config?.url;
        if (!url) return "";
        try {
            const host = new URL(url).hostname;
            return host.split(".")[0] || "";
        } catch {
            return "";
        }
    }, [config?.url]);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [migrationLogs]);

    const handleAutoMigrate = async () => {
        if (!projectId) {
            toast.error("Foundation Error: Missing Project ID");
            return;
        }
        if (!accessToken) {
            toast.error("Security Error: Provide a Supabase Access Token.");
            return;
        }

        setIsMigrating(true);
        setMigrationLogs(["[System] Initializing migration protocol...", "[Auth] Verifying project credentials..."]);

        try {
            const migrateResponse = await fetch("/api/migrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectRef: projectId,
                    accessToken,
                }),
            });

            if (!migrateResponse.ok) {
                throw new Error(`Migration engine failed: ${migrateResponse.status}`);
            }

            const reader = migrateResponse.body?.getReader();
            if (!reader) throw new Error("Failed to initialize log stream.");

            const decoder = new TextDecoder();
            let buffer = "";
            let success = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data: ")) continue;

                    try {
                        const event = JSON.parse(trimmed.substring(6));
                        if (event.type === "done") {
                            if (event.data === "success") success = true;
                        } else if (event.data) {
                            setMigrationLogs((prev) => [...prev, event.data]);
                        }
                    } catch (e) {
                        // Silently ignore parse errors for partial chunks
                    }
                }
            }

            if (success) {
                setMigrationLogs((prev) => [
                    ...prev,
                    "",
                    "═".repeat(50),
                    "✅ FOUNDATION UPDATED",
                    "",
                    "✓ Database schema synchronized",
                    "✓ API contracts verified",
                    "",
                    "System will reload to apply changes...",
                    "═".repeat(50),
                ]);

                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                throw new Error("Migration completed with errors.");
            }

        } catch (err) {
            console.error(err);
            setMigrationLogs((prev) => [
                ...prev,
                "",
                `❌ FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`,
            ]);
            toast.error("Migration interrupted. Consult system logs.");
        } finally {
            setIsMigrating(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(val) => !isMigrating && onOpenChange(val)}
        >
            <DialogContent className="max-h-[90vh] sm:max-w-4xl overflow-y-auto border-none bg-background/95 backdrop-blur-2xl shadow-2xl p-0 gap-0 selection:bg-primary/20">
                <div className="bg-gradient-to-br from-primary/5 via-transparent to-transparent">
                    <DialogHeader className="p-8 pb-4">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                                <Zap className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-black tracking-tight">
                                    Database Setup Required
                                </DialogTitle>
                                <DialogDescription className="text-xs font-bold uppercase tracking-[0.2em] opacity-60">
                                    Foundational Registry Sync • {status.appVersion}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="px-8 pb-8 space-y-6">
                        <Alert className="bg-muted/40 border-none rounded-2xl p-4">
                            <Info className="h-4 w-4 text-primary" />
                            <AlertDescription className="text-xs font-medium leading-relaxed">
                                Your application requires a database schema update to enable new features like <strong>Enhanced TTS Engine</strong> and <strong>Real-time Intelligence Streaming</strong>. Existing data remains untouched.
                            </AlertDescription>
                        </Alert>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="rounded-2xl border bg-card/50 shadow-sm p-6 space-y-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                                        Security Credentials
                                    </h3>

                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="project-id" className="text-[10px] uppercase tracking-widest font-black opacity-60">
                                                Project Identity
                                            </Label>
                                            <Input
                                                id="project-id"
                                                value={projectId}
                                                disabled
                                                readOnly
                                                className="h-10 bg-muted/50 border-none font-mono text-xs rounded-xl"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <Label htmlFor="access-token" className="text-[10px] uppercase tracking-widest font-black opacity-60">
                                                    Personal Access Token
                                                </Label>
                                                <a
                                                    href="https://supabase.com/dashboard/account/tokens"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] font-black tracking-widest text-primary hover:underline flex items-center gap-1"
                                                >
                                                    GENERATE <ExternalLink className="h-2.5 w-2.5" />
                                                </a>
                                            </div>
                                            <Input
                                                id="access-token"
                                                type="password"
                                                placeholder="sbp_..."
                                                value={accessToken}
                                                onChange={(e) => setAccessToken(e.target.value)}
                                                disabled={isMigrating}
                                                className="h-10 bg-background border-border/40 focus:ring-primary/20 rounded-xl font-mono text-xs"
                                            />
                                        </div>

                                        <Button
                                            onClick={handleAutoMigrate}
                                            disabled={isMigrating || !accessToken}
                                            className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                                        >
                                            {isMigrating ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Deploying...
                                                </>
                                            ) : (
                                                <>
                                                    <ShieldCheck className="mr-2 h-4 w-4" />
                                                    Initialize Protocol
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col rounded-2xl border bg-zinc-950/95 text-zinc-400 font-mono text-[11px] p-5 shadow-inner min-h-[300px] overflow-hidden">
                                <div className="flex items-center gap-2 mb-4 shrink-0">
                                    <div className="flex gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/20" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20" />
                                    </div>
                                    <span className="text-[9px] font-black uppercase tracking-widest opacity-40 ml-2">Foundation Terminal</span>
                                </div>

                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                    {migrationLogs.length === 0 ? (
                                        <div className="text-zinc-700 italic flex flex-col items-center justify-center h-full opacity-50">
                                            <Terminal className="h-8 w-8 mb-2" />
                                            <span>Awaiting synchronization...</span>
                                        </div>
                                    ) : (
                                        migrationLogs.map((log, i) => (
                                            <div key={i} className={cn(
                                                "mb-1.5 leading-relaxed break-words",
                                                log.includes("✅") || log.includes("success") ? "text-emerald-400" :
                                                    log.includes("❌") || log.includes("Error") ? "text-red-400 font-bold" :
                                                        log.includes("🚀") || log.includes("[System]") ? "text-primary" : ""
                                            )}>
                                                <span className="opacity-30 mr-2">{i + 1}</span>
                                                {log}
                                            </div>
                                        ))
                                    )}
                                    <div ref={logsEndRef} />
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="p-8 pt-0 flex-col sm:flex-row gap-3">
                        <div className="flex gap-3 w-full">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => handleSnooze(1)}
                                disabled={isMigrating}
                                className="flex-1 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest"
                            >
                                <Clock className="h-4 w-4 mr-2 opacity-60" />
                                Snooze 1h
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => handleSnooze(24)}
                                disabled={isMigrating}
                                className="flex-1 h-11 rounded-xl font-black text-[10px] uppercase tracking-widest"
                            >
                                <Calendar className="h-4 w-4 mr-2 opacity-60" />
                                Tomorrow
                            </Button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
