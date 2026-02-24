import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Settings2, Zap, LayoutDashboard, Sparkles, Database, ShieldCheck, Plus } from "lucide-react";

interface DashboardProps {
    configSnapshot: any;
    configSource: string;
}

export function Dashboard({ configSnapshot, configSource }: DashboardProps) {
    return (
        <div className="space-y-12 animate-in fade-in duration-700">
            <div className="text-center space-y-3">
                <h2 className="text-4xl font-black tracking-tight flex items-center justify-center gap-3">
                    <Sparkles className="w-10 h-10 text-primary animate-pulse" />
                    Foundation Dashboard
                </h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                    Monitoring the core intelligence layer and foundational runtime contracts.
                </p>
            </div>

            <div className="max-w-4xl mx-auto space-y-10">
                {/* Email Accounts equivalent section */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 border-b pb-4">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                            <Database className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Cloud Foundations</h3>
                            <p className="text-sm text-muted-foreground">Connected primary storage and identity providers.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card className="border-border/40 shadow-sm hover:shadow-md transition-all">
                            <CardHeader className="flex flex-row items-center justify-between pb-2 bg-muted/20">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600">
                                        <ShieldCheck className="w-6 h-6" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <CardTitle className="text-sm font-bold">Supabase DB</CardTitle>
                                        <CardDescription className="text-[11px]">{configSource}</CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="bg-emerald-500/5 text-emerald-500 border-emerald-500/20 text-[10px] font-black uppercase">Active</Badge>
                            </CardHeader>
                            <CardContent className="pt-4">
                                <p className="text-xs text-muted-foreground truncate font-mono">{configSnapshot?.url || "Not Configured"}</p>
                            </CardContent>
                        </Card>

                        <Card className="border-border/40 shadow-sm opacity-50 border-dashed">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                                        <Plus className="w-5 h-5" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <CardTitle className="text-sm font-bold">Edge Protocol</CardTitle>
                                        <CardDescription className="text-[11px]">Add custom provider</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                        </Card>
                    </div>
                </div>

                {/* System Configuration equivalent */}
                <div className="space-y-6">
                    <div className="flex items-center gap-3 border-b pb-4">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                            <Settings2 className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Runtime Configuration</h3>
                            <p className="text-sm text-muted-foreground">Define synchronization loops and processing logic.</p>
                        </div>
                    </div>

                    <Card className="border-border/40 shadow-sm">
                        <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-4">
                            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-2">
                                <Zap className="w-8 h-8 text-muted-foreground" />
                            </div>
                            <h4 className="text-sm font-bold">Parity Engine Not Engaged</h4>
                            <p className="text-xs text-muted-foreground max-w-sm">
                                The foundation is ready, but no active processing rules are configured. Visit Settings to define your first parity contract.
                            </p>
                            <Button variant="outline" className="h-9 px-6 rounded-full text-xs font-bold" disabled>Configure Engine</Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
