import { useCallback, useEffect, useReducer, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { APP_VERSION, checkMigrationStatus } from "../../lib/migration-check";
import { saveSupabaseConfig, validateSupabaseConnection } from "../../lib/supabase-config";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Button } from "../ui/button";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogOverlay } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import {
  autoProvisionProject,
  fetchOrganizations,
  recoverProvisionedProject,
  runMigration,
  SetupApiError
} from "./api";
import { initialState, wizardReducer } from "./reducer";
import { CredentialsStep } from "./steps/CredentialsStep";
import { ManagedOrgStep } from "./steps/ManagedOrgStep";
import { ManagedTokenStep } from "./steps/ManagedTokenStep";
import { MigrationStep } from "./steps/MigrationStep";
import { ProvisioningStep } from "./steps/ProvisioningStep";
import { TypeStep } from "./steps/TypeStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ProvisioningResult, SSEEvent, SetupWizardProps } from "./types";
import { extractProjectId, normalizeSupabaseUrl, validateAccessToken } from "./validators";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { CheckCircle2, Circle } from "lucide-react";

export function SetupWizard({ onComplete, open = true, canClose = false }: SetupWizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const accessTokenRef = useRef("");

  useEffect(() => {
    return () => {
      accessTokenRef.current = "";
    };
  }, []);

  const addLog = useCallback((type: "info" | "error" | "success" | "stdout" | "stderr", message: string) => {
    dispatch({ type: "ADD_LOG", payload: { type, message } });
  }, []);

  const completeSetup = useCallback(() => {
    accessTokenRef.current = "";
    onComplete();
  }, [onComplete]);

  const handleFetchOrgs = useCallback(async () => {
    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "SET_FETCHING_ORGS", payload: true });

    const token = state.managed.accessToken.trim();
    const validation = validateAccessToken(token);
    if (!validation.valid) {
      dispatch({ type: "SET_ERROR", payload: validation.message || "Invalid token" });
      dispatch({ type: "SET_FETCHING_ORGS", payload: false });
      return;
    }

    try {
      accessTokenRef.current = token;
      const organizations = await fetchOrganizations(token);
      dispatch({ type: "SET_ORGANIZATIONS", payload: organizations });
      dispatch({ type: "SET_STEP", payload: "managed-org" });
    } catch (error) {
      const message = error instanceof SetupApiError ? error.message : String(error);
      dispatch({ type: "SET_ERROR", payload: message });
    } finally {
      dispatch({ type: "SET_FETCHING_ORGS", payload: false });
    }
  }, [state.managed.accessToken]);

  const handleRunMigration = useCallback(
    async (override?: { projectRef?: string; accessToken?: string; url?: string; anonKey?: string }) => {
      const projectRef = override?.projectRef || state.projectId || extractProjectId(state.manual.url);
      const accessToken = override?.accessToken || accessTokenRef.current || state.managed.accessToken.trim();
      const targetUrl = override?.url || state.manual.url;
      const targetAnonKey = override?.anonKey || state.manual.anonKey;

      if (!projectRef || !accessToken) {
        dispatch({ type: "SET_ERROR", payload: "Project ID and access token are required for migration." });
        return;
      }

      dispatch({ type: "SET_STEP", payload: "migration" });
      dispatch({ type: "SET_ERROR", payload: null });
      dispatch({ type: "SET_MIGRATING", payload: true });
      dispatch({ type: "CLEAR_LOGS" });

      let migrationSuccess = false;

      try {
        await runMigration(
          {
            projectRef,
            accessToken,
            anonKey: targetAnonKey
          },
          (event: SSEEvent) => {
            if (event.type === "stdout") {
              addLog("stdout", String(event.data));
              return;
            }
            if (event.type === "stderr") {
              addLog("stderr", String(event.data));
              return;
            }
            if (event.type === "info") {
              addLog("info", String(event.data));
              return;
            }
            if (event.type === "error") {
              addLog("error", String(event.data));
              return;
            }
            if (event.type === "done") {
              migrationSuccess = event.data === "success";
            }
          }
        );

        if (!migrationSuccess) {
          throw new Error("Migration did not complete successfully.");
        }

        if (targetUrl && targetAnonKey) {
          saveSupabaseConfig({
            url: normalizeSupabaseUrl(targetUrl),
            anonKey: targetAnonKey.trim()
          });
        }

        addLog("success", "Migration completed. Setup is ready.");
        setTimeout(() => completeSetup(), 600);
      } catch (error) {
        const message = error instanceof SetupApiError ? error.message : String(error);
        dispatch({ type: "SET_ERROR", payload: message });
        addLog("error", message);
      } finally {
        dispatch({ type: "SET_MIGRATING", payload: false });
      }
    },
    [
      addLog,
      completeSetup,
      state.managed.accessToken,
      state.manual.anonKey,
      state.manual.url,
      state.projectId
    ]
  );

  const handleAutoProvision = useCallback(async () => {
    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "SET_STEP", payload: "provisioning" });
    dispatch({ type: "CLEAR_LOGS" });
    addLog("info", "Starting managed provisioning...");

    const accessToken = accessTokenRef.current || state.managed.accessToken.trim();
    const provisioningState: {
      result: ProvisioningResult | null;
      projectId: string;
      receivedDone: boolean;
      receivedError: boolean;
    } = {
      result: null,
      projectId: "",
      receivedDone: false,
      receivedError: false
    };

    const applyProvisioningResult = (result: ProvisioningResult) => {
      provisioningState.result = result;
      dispatch({ type: "SET_PROJECT_ID", payload: result.projectId });
      saveSupabaseConfig({
        url: normalizeSupabaseUrl(result.url),
        anonKey: result.anonKey.trim()
      });
      dispatch({
        type: "SET_MIGRATION_STATUS",
        payload: {
          needsMigration: true,
          appVersion: APP_VERSION,
          latestMigrationTimestamp: null,
          message: "Fresh project created. Migration is required."
        }
      });
      addLog("success", "Project ready. Starting migration...");
    };

    try {
      await autoProvisionProject(
        {
          accessToken,
          orgId: state.managed.selectedOrg,
          projectName: state.managed.projectName,
          region: state.managed.region
        },
        (event: SSEEvent) => {
          if (event.type === "project_id") {
            provisioningState.projectId = String(event.data);
            dispatch({ type: "SET_PROJECT_ID", payload: provisioningState.projectId });
            return;
          }

          if (event.type === "info") {
            addLog("info", String(event.data));
            return;
          }

          if (event.type === "error") {
            provisioningState.receivedError = true;
            addLog("error", String(event.data));
            dispatch({ type: "SET_ERROR", payload: String(event.data) });
            return;
          }

          if (event.type === "success") {
            applyProvisioningResult(event.data as ProvisioningResult);
            return;
          }

          if (event.type === "done") {
            provisioningState.receivedDone = true;
          }
        }
      );

      if (!provisioningState.result && provisioningState.projectId) {
        addLog("info", "Provisioning stream disconnected. Recovering credentials from existing project...");
        const recovered = await recoverProvisionedProject({
          accessToken,
          projectRef: provisioningState.projectId
        });
        applyProvisioningResult(recovered);
      }

      if (!provisioningState.result) {
        const message = provisioningState.receivedError
          ? "Provisioning failed before credentials were available. Retry or use manual setup."
          : provisioningState.receivedDone
            ? "Provisioning ended without credentials. Retry or use manual setup."
            : "Provisioning stream ended unexpectedly. The project may still be provisioning; retry in a moment.";
        throw new SetupApiError(message, "PROVISION_INCOMPLETE");
      }

      await handleRunMigration({
        projectRef: provisioningState.result.projectId,
        accessToken,
        url: provisioningState.result.url,
        anonKey: provisioningState.result.anonKey
      });
    } catch (error) {
      const message = error instanceof SetupApiError ? error.message : String(error);
      dispatch({ type: "SET_ERROR", payload: message });
      addLog("error", message);
    }
  }, [
    addLog,
    handleRunMigration,
    state.managed.accessToken,
    state.managed.projectName,
    state.managed.region,
    state.managed.selectedOrg
  ]);

  const handleSaveManual = useCallback(async () => {
    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "SET_STEP", payload: "validating" });

    const normalizedUrl = normalizeSupabaseUrl(state.manual.url);
    const anonKey = state.manual.anonKey.trim();

    const validation = await validateSupabaseConnection(normalizedUrl, anonKey);
    if (!validation.valid) {
      dispatch({ type: "SET_ERROR", payload: validation.error || "Connection validation failed." });
      dispatch({ type: "SET_STEP", payload: "credentials" });
      return;
    }

    saveSupabaseConfig({ url: normalizedUrl, anonKey });
    dispatch({ type: "SET_MANUAL_URL", payload: normalizedUrl });

    const projectId = extractProjectId(normalizedUrl);
    if (projectId) {
      dispatch({ type: "SET_PROJECT_ID", payload: projectId });
    }

    try {
      const client = createClient(normalizedUrl, anonKey);
      const status = await checkMigrationStatus(client);
      dispatch({
        type: "SET_MIGRATION_STATUS",
        payload: {
          needsMigration: status.needsMigration,
          appVersion: status.appVersion,
          latestMigrationTimestamp: status.latestMigrationTimestamp,
          message: status.message
        }
      });

      if (status.needsMigration) {
        dispatch({ type: "SET_STEP", payload: "migration" });
      } else {
        completeSetup();
      }
    } catch {
      dispatch({
        type: "SET_MIGRATION_STATUS",
        payload: {
          needsMigration: true,
          appVersion: APP_VERSION,
          latestMigrationTimestamp: null,
          message: "Could not verify migration status. Run migration to continue."
        }
      });
      dispatch({ type: "SET_STEP", payload: "migration" });
    }
  }, [completeSetup, state.manual.anonKey, state.manual.url]);

  if (!open) {
    return null;
  }

  const steps = [
    { key: "welcome", label: "Welcome" },
    { key: "config", label: "Configuration", subSteps: ["type", "managed-token", "managed-org", "credentials"] },
    { key: "validation", label: "Validation", subSteps: ["provisioning", "validating"] },
    { key: "migration", label: "Migration" }
  ];

  const getCurrentActiveStep = () => {
    if (state.step === "welcome") return "welcome";
    if (["type", "managed-token", "managed-org", "credentials"].includes(state.step)) return "config";
    if (["provisioning", "validating"].includes(state.step)) return "validation";
    return "migration";
  };

  const activeStepKey = getCurrentActiveStep();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && canClose) onComplete() }}>
      <DialogOverlay className="bg-zinc-950/80 backdrop-blur-sm" />
      <DialogContent className="sm:max-w-[1100px] w-full p-0 overflow-hidden border-none shadow-2xl">
        <div className="flex w-full min-h-[700px]">
          {/* Sidebar */}
          <aside className="w-[300px] border-r bg-muted/30 p-8 flex flex-col gap-10">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Folio Setup</h1>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Foundation Parity Mode</p>
            </div>

            <nav className="flex-1">
              <ul className="space-y-4">
                {steps.map((step) => {
                  const isActive = activeStepKey === step.key;
                  const isCompleted = steps.findIndex(s => s.key === activeStepKey) > steps.findIndex(s => s.key === step.key);
                  return (
                    <li key={step.key} className="flex items-center gap-3">
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-300",
                        isActive ? "border-primary bg-primary text-primary-foreground shadow-sm scale-110" :
                          isCompleted ? "border-emerald-500 bg-emerald-50 text-emerald-500" :
                            "border-muted text-muted-foreground"
                      )}>
                        {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : <div className="text-[10px] font-bold">{steps.indexOf(step) + 1}</div>}
                      </div>
                      <span className={cn(
                        "text-sm font-medium transition-colors",
                        isActive ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {step.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </nav>

            <div className="mt-auto pt-6 border-t flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">Version {APP_VERSION}</span>
              <Badge variant="outline" className="text-[10px] py-0 h-4">Production</Badge>
            </div>
          </aside>

          {/* Content Area */}
          <main className="flex-1 p-12 bg-background relative flex flex-col">
            <div className="max-w-[700px] w-full mx-auto flex-1">
              {state.step === "welcome" && <WelcomeStep onNext={() => dispatch({ type: "SET_STEP", payload: "type" })} />}

              {state.step === "type" && (
                <TypeStep
                  onManaged={() => {
                    dispatch({ type: "RESET_MANUAL_FLOW" });
                    dispatch({ type: "SET_STEP", payload: "managed-token" });
                  }}
                  onManual={() => {
                    dispatch({ type: "RESET_MANAGED_FLOW" });
                    dispatch({ type: "SET_STEP", payload: "credentials" });
                  }}
                  onBack={() => dispatch({ type: "SET_STEP", payload: "welcome" })}
                />
              )}

              {state.step === "managed-token" && (
                <ManagedTokenStep
                  accessToken={state.managed.accessToken}
                  error={state.error}
                  isFetching={state.managed.isFetchingOrgs}
                  onTokenChange={(value) => dispatch({ type: "SET_ACCESS_TOKEN", payload: value })}
                  onFetchOrgs={handleFetchOrgs}
                  onBack={() => dispatch({ type: "SET_STEP", payload: "type" })}
                />
              )}

              {state.step === "managed-org" && (
                <ManagedOrgStep
                  organizations={state.managed.organizations}
                  selectedOrg={state.managed.selectedOrg}
                  projectName={state.managed.projectName}
                  region={state.managed.region}
                  onOrgSelect={(value) => dispatch({ type: "SET_SELECTED_ORG", payload: value })}
                  onProjectNameChange={(value) => dispatch({ type: "SET_PROJECT_NAME", payload: value })}
                  onRegionChange={(value) => dispatch({ type: "SET_REGION", payload: value })}
                  onProvision={handleAutoProvision}
                  onBack={() => dispatch({ type: "SET_STEP", payload: "managed-token" })}
                />
              )}

              {state.step === "provisioning" && (
                <ProvisioningStep
                  logs={state.logs}
                  error={state.error}
                  onRetry={() => dispatch({ type: "SET_STEP", payload: "managed-token" })}
                />
              )}

              {state.step === "credentials" && (
                <CredentialsStep
                  url={state.manual.url}
                  anonKey={state.manual.anonKey}
                  error={state.error}
                  onUrlChange={(value) => dispatch({ type: "SET_MANUAL_URL", payload: value })}
                  onAnonKeyChange={(value) => dispatch({ type: "SET_MANUAL_ANON_KEY", payload: value })}
                  onSave={handleSaveManual}
                  onBack={() => dispatch({ type: "SET_STEP", payload: "type" })}
                />
              )}

              {state.step === "validating" && (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-4 animate-in fade-in zoom-in-95 duration-500">
                  <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold">Validating Credentials</h2>
                    <p className="text-muted-foreground text-sm">Please wait while Folio verifies your Supabase configuration.</p>
                  </div>
                </div>
              )}

              {state.step === "migration" && (
                <MigrationStep
                  logs={state.logs}
                  error={state.error}
                  isMigrating={state.isMigrating}
                  migrationStatus={state.migrationStatus}
                  accessToken={state.managed.accessToken}
                  onTokenChange={(value) => dispatch({ type: "SET_ACCESS_TOKEN", payload: value })}
                  onRunMigration={() => handleRunMigration()}
                  onBypass={completeSetup}
                />
              )}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
