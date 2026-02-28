import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Dashboard } from "./components/Dashboard";
import { AccountSettingsPage } from "./components/AccountSettingsPage";
import { ModeToggle } from "./components/mode-toggle";
import { HealthModal } from "./components/HealthModal";
import { SetupWizard } from "./components/SetupWizard/SetupWizard";
import { LoginPage } from "./components/LoginPage";
import { Logo } from "./components/Logo";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { api } from "./lib/api";
import { Configuration } from "./components/Configuration";
import { checkMigrationStatus, type MigrationStatus } from "./lib/migration-check";
import { MigrationBanner } from "./components/migration/MigrationBanner";
import { MigrationModal } from "./components/migration/MigrationModal";
import { clearSupabaseConfig, getConfigSource, getSupabaseConfig } from "./lib/supabase-config";
import { PoliciesPage } from "./components/PoliciesPage";
import { FunnelPage } from "./components/FunnelPage";
import { ChatPage } from "./components/chat/ChatPage";
import { Button } from "./components/ui/button";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Badge } from "./components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { TerminalProvider } from "./context/TerminalContext";
import { LiveTerminal } from "./components/LiveTerminal";
import { cn } from "@/lib/utils";
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Key,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Terminal as TerminalIcon,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Database,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  CheckCircle2,
  Activity,
  Settings2,
  LayoutDashboard,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  User,
  AlertCircle,
  Loader2,
  ScrollText,
  Funnel,
  MessageSquare
} from "lucide-react";

type Page = "dashboard" | "chat" | "funnel" | "policies" | "account" | "config";

export function App() {
  const config = useMemo(() => getSupabaseConfig(), []);

  const [activePage, setActivePage] = useState<Page>("dashboard");
  const [composeDescription, setComposeDescription] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(!config);
  const [healthOpen, setHealthOpen] = useState(false);
  const [health, setHealth] = useState("not_checked");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [log, setLog] = useState("Folio ready. Run setup to configure runtime contracts.");

  const [configSnapshot, setConfigSnapshot] = useState(config);
  const configSource = getConfigSource();
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapCycle, setBootstrapCycle] = useState(0);
  const [initStatus, setInitStatus] = useState<"unknown" | "initialized" | "empty" | "missing_view" | "error">(
    "unknown"
  );
  const [sessionStatus, setSessionStatus] = useState<"unknown" | "authenticated" | "anonymous" | "error">("unknown");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [migrationSnoozedUntil, setMigrationSnoozedUntil] = useState<Date | null>(() => {
    const stored = localStorage.getItem("folio_migration_snoozed_until");
    return stored ? new Date(stored) : null;
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const supabase = useMemo(() => {
    if (!configSnapshot) {
      return null;
    }

    return createClient(configSnapshot.url, configSnapshot.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true
      }
    });
  }, [configSnapshot]);

  useEffect(() => {
    if (!supabase) {
      setSessionStatus("unknown");
      setSessionEmail(null);
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionStatus(session?.user ? "authenticated" : "anonymous");
      setSessionEmail(session?.user?.email ?? null);
      setBootstrapCycle((value) => value + 1);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function withTimeout<T>(input: PromiseLike<T> | T, timeoutMs: number): Promise<T> {
      const promise = Promise.resolve(input);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    async function runBootstrapChecks() {
      if (!supabase) {
        setInitStatus("unknown");
        setSessionStatus("unknown");
        setSessionEmail(null);
        setMigrationStatus(null);
        setConnectionError(null);
        return;
      }

      setIsBootstrapping(true);
      setConnectionError(null);

      try {
        const { data: initData, error: initError } = await withTimeout(
          supabase.from("init_state").select("is_initialized").single(),
          12_000
        );

        if (initError) {
          if ((initError as { code?: string }).code === "42P01") {
            setInitStatus("missing_view");
          } else {
            setInitStatus("error");
            throw new Error(initError.message || "Failed to query init_state");
          }
        } else {
          const isInitialized = Number((initData as { is_initialized?: unknown }).is_initialized ?? 0) > 0;
          setInitStatus(isInitialized ? "initialized" : "empty");
        }

        const { data: sessionData, error: sessionError } = await withTimeout(supabase.auth.getSession(), 12_000);
        if (sessionError) {
          setSessionStatus("error");
          setSessionEmail(null);
        } else {
          const currentUser = sessionData.session?.user ?? null;
          setSessionStatus(currentUser ? "authenticated" : "anonymous");
          setSessionEmail(currentUser?.email ?? null);
        }

        const migration = await withTimeout(checkMigrationStatus(supabase), 12_000);
        setMigrationStatus(migration);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setConnectionError(message);
          setLog(`Bootstrap check failed: ${message}`);
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void runBootstrapChecks();

    return () => {
      cancelled = true;
    };
  }, [supabase, bootstrapCycle]);


  function handleSetupComplete() {
    const latest = getSupabaseConfig();
    setConfigSnapshot(latest);
    setSetupOpen(false);
    setLog("Setup complete. Foundation runtime is configured.");
    setHealth("not_checked");
    setBootstrapCycle((value) => value + 1);
  }

  function handleResetSetup() {
    clearSupabaseConfig();
    setConfigSnapshot(null);
    setInitStatus("unknown");
    setSessionStatus("unknown");
    setSessionEmail(null);
    setMigrationStatus(null);
    setConnectionError(null);
    setSetupOpen(true);
    setLog("Stored setup was cleared. Run setup wizard again.");
    setHealth("not_checked");
    setBootstrapCycle((value) => value + 1);
  }

  function handleAuthSuccess() {
    setBootstrapCycle((value) => value + 1);
  }

  const handleSnoozeMigration = (until: Date) => {
    setMigrationSnoozedUntil(until);
    localStorage.setItem("folio_migration_snoozed_until", until.toISOString());
  };

  const shouldShowMigrationBanner = useMemo(() => {
    if (!migrationStatus?.needsMigration) return false;
    if (migrationSnoozedUntil && migrationSnoozedUntil > new Date()) return false;
    return true;
  }, [migrationStatus, migrationSnoozedUntil]);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "funnel", label: "Funnel", icon: Funnel },
    { id: "policies", label: "Policies", icon: ScrollText },
    { id: "config", label: "Configuration", icon: Settings2 },
  ];

  // --- Strict Gating Logic ---

  // 1. Foundation Config Check (Setup Wizard)
  if (setupOpen || !configSnapshot) {
    return (
      <div className="min-h-screen bg-background">
        <SetupWizard
          open={setupOpen || !configSnapshot}
          canClose={Boolean(configSnapshot)}
          onComplete={handleSetupComplete}
        />
      </div>
    );
  }

  // 2. Identity & Initialization Check (Login Page)
  const isUninitialized = initStatus === "empty" || initStatus === "missing_view";
  const isUnauthenticated = sessionStatus !== "authenticated";

  if (isUninitialized || isUnauthenticated) {
    if (isBootstrapping && initStatus === "unknown") {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary opacity-50" />
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">
              Initializing Engine...
            </p>
          </div>
        </div>
      );
    }

    return (
      <LoginPage
        supabase={supabase!}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initStatus={initStatus as any}
        onSuccess={handleAuthSuccess}
        onResetConfigs={handleResetSetup}
      />
    );
  }

  // 3. Final Main Application Shell
  return (
    <TerminalProvider>
      <div className="min-h-screen bg-background text-foreground selection:bg-primary/10 flex flex-col font-sans animate-in fade-in duration-1000">
        {shouldShowMigrationBanner && migrationStatus && (
          <MigrationBanner
            status={migrationStatus}
            onSnooze={handleSnoozeMigration}
            onOpenModal={() => setShowMigrationModal(true)}
          />
        )}

        {migrationStatus && (
          <MigrationModal
            open={showMigrationModal}
            onOpenChange={setShowMigrationModal}
            status={migrationStatus}
            onSnooze={handleSnoozeMigration}
          />
        )}

        <header className={cn("border-b bg-background/80 backdrop-blur-xl sticky top-0 z-50 transition-all duration-500", shouldShowMigrationBanner && "mt-24 sm:mt-20")}>
          <div className="container max-w-[1400px] mx-auto px-8 h-20 flex items-center">
            {/* Brand Area */}
            <div className="flex items-center gap-3 w-[280px]">
              <div className="w-9 h-9 flex items-center justify-center">
                <Logo className="w-8 h-8" />
              </div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground/90">Folio</h1>
                <div className="flex items-center">
                  <span className="relative flex h-2 w-2">
                    <span className={cn(
                      "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                      health === "ok" ? "bg-emerald-400" : "bg-primary/40"
                    )}></span>
                    <span className={cn(
                      "relative inline-flex rounded-full h-2 w-2",
                      health === "ok" ? "bg-emerald-500" : "bg-primary/60"
                    )}></span>
                  </span>
                </div>
              </div>
            </div>

            {/* Centered Navigation */}
            <nav className="flex-1 hidden md:flex items-center justify-center gap-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActivePage(item.id as Page)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300",
                    activePage === item.id
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("w-4.5 h-4.5", activePage === item.id ? "text-primary" : "text-muted-foreground/60")} />
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Right Utilities Area */}
            <div className="flex items-center justify-end gap-5 w-[280px]">
              {/* Mock Language Selector */}
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-muted/40 rounded-full border border-border/40 cursor-pointer hover:bg-muted/60 transition-colors">
                <img src="https://flagcdn.com/w40/us.png" className="w-4 h-3 rounded-sm opacity-80" alt="EN" />
                <span className="text-[10px] font-extrabold tracking-widest text-muted-foreground">EN</span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "rounded-full h-9 w-9 transition-all relative group",
                  migrationStatus?.needsMigration ? "text-red-500 hover:bg-red-500/10" : "text-muted-foreground hover:bg-muted/60"
                )}
                onClick={() => setHealthOpen(true)}
              >
                <Activity className={cn("w-5 h-5", migrationStatus?.needsMigration && "animate-pulse")} />
                {migrationStatus?.needsMigration && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 ring-4 ring-red-500/20 animate-ping" />
                )}
              </Button>

              <ModeToggle />

              {/* Mock User Avatar */}
              <div
                className="w-10 h-10 rounded-full overflow-hidden border-2 border-background shadow-lg cursor-pointer ring-1 ring-border/20"
                onClick={() => setActivePage("account")}
              >
                <div className="w-full h-full bg-primary flex items-center justify-center text-primary-foreground font-black text-xs">
                  {sessionEmail?.charAt(0).toUpperCase() || "A"}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full px-6 py-12 mx-auto max-w-[1600px]">
          {/* Global Connection Error */}
          {connectionError && (
            <Alert variant="destructive" className="mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="font-bold">Protocol Connection Failure</AlertTitle>
              <AlertDescription className="text-[13px] opacity-90">
                {connectionError}
              </AlertDescription>
            </Alert>
          )}

          {activePage === "dashboard" && (
            <Dashboard configSnapshot={configSnapshot} configSource={configSource} setActivePage={setActivePage} />
          )}
          {activePage === "chat" && (
            <ChatPage />
          )}
          {activePage === "funnel" && (
            <FunnelPage
              onComposePolicyForDoc={(description) => {
                setComposeDescription(description);
                setActivePage("policies");
              }}
            />
          )}
          {activePage === "policies" && (
            <PoliciesPage
              initialCompose={composeDescription}
              onInitialConsumed={() => setComposeDescription(null)}
            />
          )}
          {activePage === "config" && (
            <Configuration />
          )}
          {activePage === "account" && (
            <AccountSettingsPage
              supabase={supabase}
              sessionEmail={sessionEmail}
              sessionStatus={sessionStatus}
              initStatus={initStatus}
              configSnapshot={configSnapshot}
              configSource={configSource}
              onRefresh={handleAuthSuccess}
              onLaunchSetup={() => setSetupOpen(true)}
              onResetSetup={handleResetSetup}
            />
          )}
        </main>

        <LiveTerminal />

        <div className="fixed bottom-6 left-6 z-[60]">
          <Button variant="secondary" size="icon" className="h-12 w-12 rounded-full shadow-xl bg-background border border-border/40 text-muted-foreground hover:text-primary hover:scale-110 transition-all">
            <LayoutDashboard className="w-6 h-6" />
          </Button>
        </div>

        <footer className="border-t bg-card/20 py-10 mt-auto">
          <div className="container max-w-7xl mx-auto px-8 flex items-center justify-between text-[11px] text-muted-foreground font-bold uppercase tracking-[0.2em] opacity-40">
            <div className="flex items-center gap-2">
              <span>Core Foundation Protocol</span>
              <div className="w-1 h-1 rounded-full bg-muted-foreground" />
              <span>2026</span>
            </div>
            <div className="flex items-center gap-8">
              <a href="#" className="hover:text-foreground transition-colors">Whitepaper</a>
              <a href="#" className="hover:text-foreground transition-colors">Foundation Registry</a>
            </div>
          </div>
        </footer>

        <HealthModal
          open={healthOpen}
          onOpenChange={setHealthOpen}
          health={health}
          isBootstrapping={isBootstrapping}
          initStatus={initStatus || "unknown"}
          sessionStatus={sessionStatus || "unknown"}
          migrationStatus={migrationStatus}
          onRunMigration={() => {
            setHealthOpen(false);
            setShowMigrationModal(true);
          }}
        />
      </div>
    </TerminalProvider>
  );
}
