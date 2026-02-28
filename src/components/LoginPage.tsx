import { useState, useEffect } from "react";
import {
    LogIn,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    UserPlus,
    ShieldCheck,
    Loader2,
    Mail,
    Key,
    Eye,
    EyeOff,
    AlertCircle,
    ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import { ModeToggle } from "./mode-toggle";
import { Logo } from "./Logo";
import { api } from "../lib/api";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { cn } from "@/lib/utils";

interface LoginPageProps {
    supabase: SupabaseClient;
    initStatus: "unknown" | "initialized" | "empty" | "missing_view" | "error";
    onSuccess: () => void;
    onResetConfigs?: () => void;
}

export function LoginPage({ supabase, initStatus, onSuccess, onResetConfigs }: LoginPageProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [isSignUp, setIsSignUp] = useState(initStatus === "empty");

    useEffect(() => {
        setIsSignUp(initStatus === "empty");
    }, [initStatus]);

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        try {
            const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
            if (loginError) throw loginError;
            onSuccess();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message || "Authentication failed.");
        } finally {
            setIsLoading(false);
        }
    }

    async function handleEnrollAdmin(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        try {
            const response = await api.setup({
                email,
                password,
                first_name: firstName,
                last_name: lastName
            });

            if (response.error) {
                throw new Error(typeof response.error === "string" ? response.error : response.error.message);
            }

            // Auto login after setup
            const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
            if (loginError) throw loginError;

            onSuccess();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message || "Failed to initialize foundation.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
            {/* Dynamic Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse delay-700" />
            </div>

            {/* Top Header Utilities */}
            <div className="absolute top-8 right-8 flex items-center gap-4 z-50">
                <ModeToggle />
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-muted/40 rounded-full border border-border/40 cursor-pointer hover:bg-muted/60 transition-colors group">
                    <Logo className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-extrabold tracking-widest text-muted-foreground">EN</span>
                </div>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="w-full max-w-[450px] relative z-10"
            >
                <div className="bg-card/40 backdrop-blur-2xl border border-border/40 p-10 rounded-[2.5rem] shadow-2xl shadow-black/10 space-y-8 overflow-hidden relative">
                    {/* Subtle line decoration */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

                    <div className="text-center space-y-4">
                        <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-xl shadow-primary/20 hover:scale-105 transition-transform duration-500">
                            <Logo className="w-10 h-10" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-black tracking-tighter uppercase italic text-foreground leading-none">
                                {isSignUp ? "Initialization" : "Access Gate"}
                            </h1>
                            <p className="text-[10px] text-muted-foreground font-black tracking-[0.3em] uppercase mt-2 opacity-60">
                                {isSignUp ? "Primary Administrator Enrollment" : "Foundational Identity Required"}
                            </p>
                        </div>
                    </div>

                    <form onSubmit={isSignUp ? handleEnrollAdmin : handleLogin} className="space-y-6">
                        <AnimatePresence mode="wait">
                            {isSignUp && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="grid grid-cols-2 gap-4"
                                >
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">First Name</Label>
                                        <Input
                                            placeholder="Agent"
                                            value={firstName}
                                            onChange={(e) => setFirstName(e.target.value)}
                                            required={isSignUp}
                                            className="h-12 bg-background/50 border-border/40 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Last Name</Label>
                                        <Input
                                            placeholder="Zero"
                                            value={lastName}
                                            onChange={(e) => setLastName(e.target.value)}
                                            required={isSignUp}
                                            className="h-12 bg-background/50 border-border/40 rounded-xl"
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Email Coordinates</Label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                                <Input
                                    type="email"
                                    placeholder="admin@realtimex.ai"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="pl-12 h-14 bg-background/50 border-border/40 rounded-2xl focus:ring-primary/20 font-medium"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Security Key</Label>
                            <div className="relative group">
                                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="pl-12 pr-12 h-14 bg-background/50 border-border/40 rounded-2xl focus:ring-primary/20 font-medium"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-primary transition-colors focus:outline-none"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                                <Alert variant="destructive" className="bg-destructive/5 text-destructive border-destructive/20 py-3 rounded-2xl">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        <AlertDescription className="text-xs font-bold leading-relaxed">{error}</AlertDescription>
                                    </div>
                                    {(error.includes("fetch") || error.includes("connection")) && onResetConfigs && (
                                        <Button variant="link" size="sm" onClick={onResetConfigs} className="text-[10px] font-black uppercase tracking-tighter text-destructive h-auto p-0 mt-2 ml-6 hover:no-underline hover:opacity-70">
                                            Reset Configuration Foundation
                                        </Button>
                                    )}
                                </Alert>
                            </motion.div>
                        )}

                        <Button size="lg" className="w-full h-14 rounded-2xl text-base font-black shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300" disabled={isLoading}>
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    {isSignUp ? <ShieldCheck className="w-5 h-5 mr-3" /> : <LogIn className="w-5 h-5 mr-3" />}
                                    {isSignUp ? "Engage Administrator" : "Log In to Dashboard"}
                                </>
                            )}
                        </Button>
                    </form>

                    <div className="pt-6 border-t border-border/10">
                        <button
                            type="button"
                            onClick={() => {
                                setError(null);
                                setIsSignUp(!isSignUp);
                            }}
                            className="w-full text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2 group"
                        >
                            {isSignUp ? "Already have an account? Access Gate" : "First time? Enroll Primary Admin"}
                            <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>

                <div className="mt-10 text-center">
                    <p className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.5em]">
                        Powered by Foundations Protocol 2026
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
