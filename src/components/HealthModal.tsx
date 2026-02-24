import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ShieldCheck, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    health: string;
    isBootstrapping: boolean;
    initStatus: string;
    sessionStatus: string;
    migrationStatus: any;
    onRunMigration?: () => void;
}

export function HealthModal({
    open,
    onOpenChange,
    health,
    isBootstrapping,
    initStatus,
    sessionStatus,
    migrationStatus,
    onRunMigration
}: HealthModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Activity className="w-5 h-5 text-primary" />
                        Runtime Health Engine
                    </DialogTitle>
                    <DialogDescription>
                        Diagnostic overview of active foundation services.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {[
                        { label: "API Provider", value: health, status: health === "ok" ? "success" : health === "error" ? "error" : "warning" },
                        { label: "Bootstrap Cycle", value: isBootstrapping ? "running" : "stable", status: isBootstrapping ? "warning" : "success" },
                        { label: "Init Integrity", value: initStatus, status: initStatus === "initialized" ? "success" : initStatus === "error" ? "error" : "warning" },
                        { label: "Auth Context", value: sessionStatus, status: sessionStatus === "authenticated" ? "success" : sessionStatus === "error" ? "error" : "warning" },
                    ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border">
                            <span className="text-sm font-medium">{item.label}</span>
                            <Badge
                                variant="outline"
                                className={cn(
                                    "text-[10px] uppercase font-bold",
                                    item.status === "success" && "border-emerald-500/50 text-emerald-500 bg-emerald-500/5",
                                    item.status === "warning" && "border-amber-500/50 text-amber-500 bg-amber-500/5",
                                    item.status === "error" && "border-destructive/50 text-destructive bg-destructive/5"
                                )}
                            >
                                {item.value}
                            </Badge>
                        </div>
                    ))}

                    <div className={cn(
                        "p-4 rounded-xl border flex flex-col gap-3 transition-all",
                        migrationStatus?.needsMigration
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-500"
                            : "bg-primary/5 border-primary/10 text-primary"
                    )}>
                        <div className="flex items-center gap-3">
                            {migrationStatus?.needsMigration ? (
                                <Activity className="w-4 h-4 shrink-0 animate-pulse" />
                            ) : (
                                <ShieldCheck className="w-4 h-4 shrink-0" />
                            )}
                            <p className="text-xs font-semibold leading-relaxed">
                                {migrationStatus ? migrationStatus.message : "Checking database schema migration parity..."}
                            </p>
                        </div>

                        {migrationStatus?.needsMigration && onRunMigration && (
                            <Button
                                size="sm"
                                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] uppercase tracking-widest h-8 rounded-lg"
                                onClick={onRunMigration}
                            >
                                Run System Migration
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
