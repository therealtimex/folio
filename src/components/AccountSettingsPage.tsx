import { useState, useEffect } from "react";
import {
    User,
    ShieldCheck,
    Database,
    LogOut,
    Camera,
    Volume2,
    VolumeX,
    CheckCircle2,
    Save,
    Key,
    ShieldAlert,
    Loader2,
    Settings,
    Plus,
    RefreshCcw,
    AlertCircle
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AuthPanel } from "./AuthPanel";
import { SupabaseClient } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { Profile, SupabaseConfig } from "../lib/types";

interface AccountSettingsPageProps {
    supabase: SupabaseClient | null;
    sessionEmail: string | null;
    sessionStatus: "unknown" | "authenticated" | "anonymous" | "error";
    initStatus: "unknown" | "initialized" | "empty" | "missing_view" | "error";
    configSnapshot: SupabaseConfig | null;
    configSource: string;
    onRefresh: () => void;
    onLaunchSetup: () => void;
    onResetSetup: () => void;
}

type SettingsTab = "profile" | "security" | "supabase";

export function AccountSettingsPage({
    supabase,
    sessionEmail,
    sessionStatus,
    initStatus,
    configSnapshot,
    configSource,
    onRefresh,
    onLaunchSetup,
    onResetSetup
}: AccountSettingsPageProps) {
    const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
    const [profile, setProfile] = useState<Profile | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    async function fetchProfile() {
        if (!supabase) return;
        setIsLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data } = await supabase
                .from("profiles")
                .select("*")
                .eq("id", user.id)
                .single();

            if (data) setProfile(data);
        }
        setIsLoading(false);
    }

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        if (sessionStatus === "authenticated" && supabase) {
            fetchProfile();
        }
    }, [sessionStatus, supabase]);
    /* eslint-enable react-hooks/exhaustive-deps */

    const tabs = [
        { id: "profile", label: "Profile", icon: User },
        { id: "security", label: "Security", icon: ShieldCheck },
        { id: "supabase", label: "Supabase", icon: Database },
    ];

    async function handleLogout() {
        if (supabase) {
            await supabase.auth.signOut();
            onRefresh();
        }
    }

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700">
            <div className="flex flex-col gap-2">
                <h1 className="text-4xl font-black tracking-tight">Account Settings</h1>
                <p className="text-muted-foreground text-lg">Manage your profile and foundational preferences.</p>
            </div>

            <div className="flex flex-col md:flex-row gap-12 items-start">
                {/* Sidebar Nav */}
                <aside className="w-full md:w-72 flex flex-col gap-8 shrink-0">
                    <nav className="space-y-1">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as SettingsTab)}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all duration-300",
                                        isActive
                                            ? "bg-foreground text-background shadow-lg shadow-foreground/10"
                                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                    )}
                                >
                                    <Icon className={cn("w-5 h-5", isActive ? "text-background" : "text-muted-foreground/60")} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="pt-8 border-t space-y-6">
                        <button
                            onClick={handleLogout}
                            className="group w-full flex items-center gap-3 px-4 py-2 text-sm font-bold rounded-xl transition-all duration-300 text-destructive hover:bg-destructive/10"
                        >
                            <LogOut className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                            Logout
                        </button>

                        <div className="px-4">
                            <p className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest mb-1">Version</p>
                            <p className="text-xs font-mono text-muted-foreground/60">v0.48.21</p>
                        </div>
                    </div>
                </aside>

                {/* Content Area */}
                <div className="flex-1 w-full animate-in slide-in-from-right-4 duration-500">
                    {activeTab === "profile" && (
                        <ProfileSection
                            sessionEmail={sessionEmail}
                            sessionStatus={sessionStatus}
                            supabase={supabase}
                            initStatus={initStatus}
                            profile={profile}
                            onProfileUpdate={fetchProfile}
                            onRefresh={onRefresh}
                            isLoading={isLoading}
                        />
                    )}
                    {activeTab === "security" && (
                        <SecuritySection supabase={supabase} />
                    )}
                    {activeTab === "supabase" && (
                        <SupabaseSection
                            configSnapshot={configSnapshot}
                            configSource={configSource}
                            onLaunchSetup={onLaunchSetup}
                            onResetSetup={onResetSetup}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function ProfileSection({
    sessionEmail,
    sessionStatus,
    supabase,
    initStatus,
    profile,
    onProfileUpdate,
    onRefresh,
    isLoading
}: {
    sessionEmail: string | null;
    sessionStatus: string;
    supabase: SupabaseClient | null;
    initStatus: string;
    profile: Profile | null;
    onProfileUpdate: () => void;
    onRefresh: () => void;
    isLoading: boolean;
}) {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [hapticsEnabled, setHapticsEnabled] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        if (profile) {
            setFirstName(profile.first_name || "");
            setLastName(profile.last_name || "");
        }
    }, [profile]);

    const handleSave = async () => {
        if (!supabase || !profile) return;
        setIsSaving(true);
        const { error } = await supabase
            .from("profiles")
            .update({
                first_name: firstName,
                last_name: lastName
            })
            .eq("id", profile.id);

        if (!error) {
            onProfileUpdate();
        }
        setIsSaving(false);
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !supabase || !profile) return;

        setIsUploading(true);
        try {
            const fileExt = file.name.split(".").pop();
            const filePath = `${profile.id}/${Math.random()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from("avatars")
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from("avatars")
                .getPublicUrl(filePath);

            await supabase
                .from("profiles")
                .update({ avatar_url: publicUrl })
                .eq("id", profile.id);

            onProfileUpdate();
        } catch (error) {
            console.error("Upload error:", error);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Card className="border-border/40 shadow-xl shadow-black/5 bg-card/50 backdrop-blur-sm overflow-hidden">
            <CardHeader className="p-8 border-b bg-muted/20">
                <CardTitle className="text-2xl font-black">Profile Information</CardTitle>
                <CardDescription className="text-base">Update your personal foundation details.</CardDescription>
            </CardHeader>
            <CardContent className="p-8 space-y-10">
                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : sessionStatus === "authenticated" ? (
                    <div className="space-y-10">
                        {/* Avatar Row */}
                        <div className="flex flex-col sm:flex-row items-center gap-8">
                            <div className="relative group">
                                <div className="w-32 h-32 rounded-full bg-primary/10 border-4 border-background shadow-2xl overflow-hidden flex items-center justify-center">
                                    {profile?.avatar_url ? (
                                        <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                                    ) : sessionEmail ? (
                                        <span className="text-4xl font-black text-primary">{sessionEmail.charAt(0).toUpperCase()}</span>
                                    ) : (
                                        <User className="w-12 h-12 text-primary/40" />
                                    )}
                                </div>
                                <label className="absolute bottom-1 right-1 h-10 w-10 rounded-full bg-background border shadow-lg flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <Camera className="w-5 h-5 text-muted-foreground" />}
                                    <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} disabled={isUploading} />
                                </label>
                            </div>

                            <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="firstName" className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">First Name</Label>
                                    <Input
                                        id="firstName"
                                        placeholder="Trung"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        className="h-12 rounded-xl bg-background/50 border-border/40"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="lastName" className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Last Name</Label>
                                    <Input
                                        id="lastName"
                                        placeholder="Le"
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        className="h-12 rounded-xl bg-background/50 border-border/40"
                                    />
                                </div>
                                <div className="sm:col-span-2 space-y-2">
                                    <Label htmlFor="email" className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Email Address</Label>
                                    <Input
                                        id="email"
                                        value={sessionEmail || ""}
                                        disabled
                                        className="h-12 rounded-xl bg-muted/40 border-border/40 opacity-70 cursor-not-allowed"
                                    />
                                    <p className="text-[10px] text-muted-foreground/60 font-bold ml-1">This is your login email and cannot be changed.</p>
                                </div>
                            </div>
                        </div>

                        {/* Sound & Haptics Row */}
                        <div className="pt-8 border-t flex items-center justify-between">
                            <div className="space-y-1">
                                <h4 className="text-base font-bold">Sound & Haptic Feedback</h4>
                                <p className="text-sm text-muted-foreground">Play chimes and haptic pulses for system events.</p>
                            </div>
                            <Button
                                variant={hapticsEnabled ? "default" : "outline"}
                                className={cn(
                                    "h-11 px-6 rounded-xl font-bold transition-all",
                                    hapticsEnabled ? "shadow-lg shadow-primary/20" : ""
                                )}
                                onClick={() => setHapticsEnabled(!hapticsEnabled)}
                            >
                                {hapticsEnabled ? <Volume2 className="w-4 h-4 mr-2" /> : <VolumeX className="w-4 h-4 mr-2" />}
                                {hapticsEnabled ? "Enabled" : "Disabled"}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="py-8">
                        <div className="flex items-center gap-3 border-b pb-4 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                <ShieldCheck className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold">Authentication Gateway</h3>
                                <p className="text-sm text-muted-foreground">Access your foundational profile.</p>
                            </div>
                        </div>
                        {supabase && (
                            <AuthPanel
                                supabase={supabase}
                                initStatus={initStatus as never}
                                sessionStatus={sessionStatus as never}
                                sessionEmail={sessionEmail}
                                onRefresh={onRefresh}
                            />
                        )}
                    </div>
                )}
            </CardContent>
            {sessionStatus === "authenticated" && !isLoading && (
                <CardFooter className="bg-muted/20 p-8 flex justify-end">
                    <Button
                        className="h-12 px-8 rounded-xl font-bold shadow-xl shadow-primary/20"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                        Save Changes
                    </Button>
                </CardFooter>
            )}
        </Card>
    );
}

function SecuritySection({ supabase }: { supabase: SupabaseClient | null }) {
    const [newPass, setNewPass] = useState("");
    const [confirmPass, setConfirmPass] = useState("");
    const [isUpdating, setIsUpdating] = useState(false);
    const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

    const handleUpdatePassword = async () => {
        if (!supabase) return;
        if (newPass !== confirmPass) {
            setStatus({ type: "error", msg: "Passwords do not match." });
            return;
        }
        if (newPass.length < 8) {
            setStatus({ type: "error", msg: "Password must be at least 8 characters." });
            return;
        }

        setIsUpdating(true);
        setStatus(null);
        const { error } = await supabase.auth.updateUser({ password: newPass });

        if (error) {
            setStatus({ type: "error", msg: error.message });
        } else {
            setStatus({ type: "success", msg: "Password updated successfully." });
            setNewPass("");
            setConfirmPass("");
        }
        setIsUpdating(false);
    };

    return (
        <Card className="border-border/40 shadow-xl shadow-black/5 bg-card/50 backdrop-blur-sm overflow-hidden">
            <CardHeader className="p-8 border-b bg-muted/20">
                <CardTitle className="text-2xl font-black">Security Protocol</CardTitle>
                <CardDescription className="text-base">Manage your foundation credentials and access keys.</CardDescription>
            </CardHeader>
            <CardContent className="p-8 space-y-8">
                {status && (
                    <Alert variant={status.type === "error" ? "destructive" : "default"} className={cn("animate-in fade-in slide-in-from-top-2 duration-300", status.type === "success" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "")}>
                        {status.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                        <AlertDescription className="text-sm font-bold">{status.msg}</AlertDescription>
                    </Alert>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="newPass" className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">New Password</Label>
                            <Input
                                id="newPass"
                                type="password"
                                placeholder="••••••••"
                                value={newPass}
                                onChange={(e) => setNewPass(e.target.value)}
                                className="h-12 rounded-xl bg-background/50 border-border/40"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirmPass" className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Confirm Password</Label>
                            <Input
                                id="confirmPass"
                                type="password"
                                placeholder="••••••••"
                                value={confirmPass}
                                onChange={(e) => setConfirmPass(e.target.value)}
                                className="h-12 rounded-xl bg-background/50 border-border/40"
                            />
                        </div>
                    </div>
                    <div className="bg-muted/30 p-6 rounded-2xl border border-border/40 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                <ShieldAlert className="w-5 h-5" />
                            </div>
                            <h5 className="font-bold">Security Tip</h5>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Use a password at least 12 characters long with a mix of letters, numbers, and symbols to ensure your foundational data remains secure.
                        </p>
                    </div>
                </div>
            </CardContent>
            <CardFooter className="bg-muted/20 p-8 flex justify-end">
                <Button
                    className="h-12 px-8 rounded-xl font-bold shadow-xl shadow-primary/20"
                    onClick={handleUpdatePassword}
                    disabled={isUpdating || !newPass || !confirmPass}
                >
                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
                    Update Password
                </Button>
            </CardFooter>
        </Card>
    );
}

function SupabaseSection({
    configSnapshot,
    configSource,
    onLaunchSetup,
    onResetSetup
}: {
    configSnapshot: SupabaseConfig | null;
    configSource: string;
    onLaunchSetup: () => void;
    onResetSetup: () => void;
}) {
    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            <div className="flex items-center gap-3 border-b pb-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Database className="w-6 h-6" />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-bold">Supabase Configuration</h3>
                    <p className="text-sm text-muted-foreground">Primary storage and identity gateway.</p>
                </div>
                <Badge variant="secondary" className="text-[10px] font-black uppercase tracking-widest px-3 py-1">Source: {configSource}</Badge>
            </div>

            <Card className="border-border/40 shadow-sm bg-card/50 backdrop-blur-sm">
                <CardContent className="p-8 space-y-8">
                    {configSnapshot ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest pl-1">API Endpoint</span>
                                <div className="bg-muted/30 p-4 rounded-2xl border border-border/40 backdrop-blur-sm shadow-inner">
                                    <p className="text-sm font-semibold truncate text-foreground/80">{configSnapshot.url}</p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest pl-1">Project Identifier</span>
                                <div className="bg-muted/30 p-4 rounded-2xl border border-border/40 font-mono shadow-inner">
                                    <p className="text-sm font-semibold text-foreground/80">{configSnapshot.url.split('//')[1]?.split('.')[0] || "Unknown"}</p>
                                </div>
                            </div>
                            <div className="md:col-span-2 space-y-2">
                                <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest pl-1">Service Role Access (Masked)</span>
                                <div className="bg-muted/30 p-4 rounded-2xl border border-border/40 flex items-center justify-between shadow-inner">
                                    <p className="text-sm font-mono text-muted-foreground">
                                        {configSnapshot.anonKey.slice(0, 6)}...{configSnapshot.anonKey.slice(-6)}
                                    </p>
                                    <Badge variant="outline" className="text-[9px] font-bold">Standard Key</Badge>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <Alert className="bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400 p-6 rounded-2xl shadow-sm">
                            <AlertCircle className="w-5 h-5" />
                            <AlertTitle className="font-bold mb-1">Infrastructure Standby</AlertTitle>
                            <AlertDescription className="text-sm opacity-90">The foundation has not been initialized. You must run the setup wizard to continue.</AlertDescription>
                        </Alert>
                    )}
                </CardContent>
                <CardFooter className="bg-muted/20 p-8 flex gap-4 border-t">
                    <Button
                        variant={configSnapshot ? "outline" : "default"}
                        className="flex-1 h-12 rounded-xl font-bold shadow-sm"
                        onClick={onLaunchSetup}
                    >
                        {configSnapshot ? <Settings className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                        {configSnapshot ? "Run Setup Wizard" : "Launch Initializer"}
                    </Button>
                    {configSnapshot && (
                        <Button variant="ghost" size="icon" className="h-12 w-12 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" onClick={onResetSetup} title="Reset All Configuration">
                            <RefreshCcw className="w-5 h-5" />
                        </Button>
                    )}
                </CardFooter>
            </Card>

            <div className="space-y-6 pt-4">
                <div className="flex items-center gap-3 border-b pb-4">
                    <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center text-destructive">
                        <AlertCircle className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-destructive">Advanced Maintenance</h3>
                        <p className="text-sm text-muted-foreground">Destructive actions and system-level overrides.</p>
                    </div>
                </div>

                <Card className="border-destructive/20 bg-destructive/5 overflow-hidden shadow-sm">
                    <CardContent className="p-8">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Fully resetting the foundation will purge all local storage cached parameters. This action is irreversible and will force a fresh bootstrap flow upon next launch.
                        </p>
                        <Button variant="link" className="px-0 text-destructive h-auto text-xs font-black uppercase tracking-widest mt-4 hover:no-underline hover:opacity-70 transition-opacity" onClick={onResetSetup}>
                            Wipe Local Foundation Buffer
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
