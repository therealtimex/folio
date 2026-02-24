export type WizardStep =
  | "welcome"
  | "type"
  | "managed-token"
  | "managed-org"
  | "provisioning"
  | "credentials"
  | "migration"
  | "validating";

export interface Organization {
  id: string;
  name: string;
}

export interface MigrationStatusSnapshot {
  needsMigration: boolean;
  appVersion: string;
  latestMigrationTimestamp: string | null;
  message: string;
}

export interface LogEntry {
  type: "stdout" | "stderr" | "info" | "error" | "success";
  message: string;
  timestamp: number;
}

export interface SetupWizardProps {
  onComplete: () => void;
  open?: boolean;
  canClose?: boolean;
}

export interface ProvisioningResult {
  projectId: string;
  url: string;
  anonKey: string;
  dbPass: string;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export interface WizardState {
  step: WizardStep;
  managed: {
    accessToken: string;
    organizations: Organization[];
    selectedOrg: string;
    projectName: string;
    region: string;
    isFetchingOrgs: boolean;
  };
  manual: {
    url: string;
    anonKey: string;
  };
  projectId: string;
  logs: LogEntry[];
  error: string | null;
  isMigrating: boolean;
  migrationStatus: MigrationStatusSnapshot | null;
}

export type WizardAction =
  | { type: "SET_STEP"; payload: WizardStep }
  | { type: "SET_ACCESS_TOKEN"; payload: string }
  | { type: "SET_ORGANIZATIONS"; payload: Organization[] }
  | { type: "SET_SELECTED_ORG"; payload: string }
  | { type: "SET_PROJECT_NAME"; payload: string }
  | { type: "SET_REGION"; payload: string }
  | { type: "SET_FETCHING_ORGS"; payload: boolean }
  | { type: "SET_MANUAL_URL"; payload: string }
  | { type: "SET_MANUAL_ANON_KEY"; payload: string }
  | { type: "SET_PROJECT_ID"; payload: string }
  | { type: "ADD_LOG"; payload: Omit<LogEntry, "timestamp"> }
  | { type: "CLEAR_LOGS" }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_MIGRATING"; payload: boolean }
  | { type: "SET_MIGRATION_STATUS"; payload: MigrationStatusSnapshot | null }
  | { type: "RESET_MANAGED_FLOW" }
  | { type: "RESET_MANUAL_FLOW" };

export interface SSEEvent {
  type: "info" | "error" | "success" | "project_id" | "stdout" | "stderr" | "done";
  data: unknown;
}
