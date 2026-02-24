import { useState } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import { LogIn, UserPlus, LogOut, ShieldAlert, Loader2, User, Key, Mail, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../lib/api";

interface AuthPanelProps {
  supabase: SupabaseClient;
  initStatus: "unknown" | "initialized" | "empty" | "missing_view" | "error";
  sessionStatus: "unknown" | "authenticated" | "anonymous" | "error";
  sessionEmail: string | null;
  onRefresh: () => void;
}

export function AuthPanel({ supabase, initStatus, sessionStatus, sessionEmail, onRefresh }: AuthPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSystemEmpty = initStatus === "empty";

  async function handleLogin() {
    setIsLoading(true);
    setError(null);
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
    else onRefresh();
    setIsLoading(false);
  }

  async function handleEnrollAdmin() {
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

      onRefresh();
    } catch (err: any) {
      setError(err.message || "Failed to initialize foundation.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignup() {
    setIsLoading(true);
    setError(null);
    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName
        }
      }
    });
    if (signupError) setError(signupError.message);
    else onRefresh();
    setIsLoading(false);
  }

  async function handleLogout() {
    setIsLoading(true);
    await supabase.auth.signOut();
    onRefresh();
    setIsLoading(false);
  }

  if (sessionStatus === "authenticated") {
    return (
      <div className="space-y-4 animate-in fade-in duration-500">
        <div className="flex items-center gap-4 p-4 rounded-xl bg-primary/5 border border-primary/10">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
            <User className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground leading-none mb-1">Authenticated as</p>
            <p className="text-sm font-medium truncate">{sessionEmail}</p>
          </div>
        </div>

        {initStatus === "missing_view" && (
          <Alert variant="destructive" className="bg-destructive/5 text-destructive border-destructive/20">
            <ShieldAlert className="w-4 h-4" />
            <AlertDescription className="text-xs">Database views missing. Foundation may be corrupted.</AlertDescription>
          </Alert>
        )}

        <Button variant="outline" className="w-full h-11 hover:bg-destructive hover:text-destructive-reveal group transition-all duration-300" onClick={handleLogout} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogOut className="w-4 h-4 mr-2 group-hover:rotate-180 transition-transform duration-500" />}
          Logout Protocol
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="grid gap-4">
        {isSystemEmpty && (
          <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
            <div className="space-y-2">
              <Label htmlFor="auth-firstname">First Name</Label>
              <Input
                id="auth-firstname"
                placeholder="Agent"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth-lastname">Last Name</Label>
              <Input
                id="auth-lastname"
                placeholder="Zero"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-10"
              />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="auth-email">Email Address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="auth-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-password">Security Key</Label>
          <div className="relative">
            <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="auth-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9 h-10"
              autoComplete={isSystemEmpty ? "new-password" : "current-password"}
            />
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="py-2 px-3">
          <AlertDescription className="text-[11px] leading-relaxed italic">{error}</AlertDescription>
        </Alert>
      )}

      <div className="pt-2">
        {isSystemEmpty ? (
          <Button className="w-full h-11 shadow-lg shadow-primary/20" onClick={handleEnrollAdmin} disabled={isLoading || !email || !password || !firstName}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            Initialize Primary Admin
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button className="h-10" onClick={handleLogin} disabled={isLoading || !email || !password}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
              Login
            </Button>
            <Button variant="secondary" className="h-10" onClick={handleSignup} disabled={isLoading || !email || !password}>
              <UserPlus className="w-4 h-4 mr-2" />
              Enroll
            </Button>
          </div>
        )}
      </div>

      <p className="text-[10px] text-center text-muted-foreground uppercase tracking-widest font-bold opacity-50 pt-2">
        {isSystemEmpty ? "Foundation Assembly Phase" : "Foundation Access Required"}
      </p>
    </div>
  );
}
