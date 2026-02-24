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
    onCheckApi: () => void;
    onDispatchStub: () => void;
}

export function HealthModal({
    open,
    onOpenChange,
    health,
    isBootstrapping,
    initStatus,
    sessionStatus,
    migrationStatus,
    onCheckApi,
    onDispatchStub
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

                    <div className="p-3 bg-primary/5 rounded-xl border border-primary/10 flex items-center gap-3">
                        <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            {migrationStatus ? migrationStatus.message : "Checking database schema migration parity..."}
                        </p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button variant="secondary" className="flex-1" onClick={onCheckApi}>Run Diagnostics</Button>
                    <Button variant="outline" className="flex-1" onClick={onDispatchStub}>Dispatch Stub</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
