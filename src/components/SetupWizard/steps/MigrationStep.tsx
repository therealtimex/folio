import { APP_VERSION } from "../../../lib/migration-check";
import { TerminalLogs } from "../TerminalLogs";
import { LogEntry, MigrationStatusSnapshot } from "../types";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Alert, AlertDescription } from "../../ui/alert";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Database, Key, Loader2, Play, ChevronRight, AlertCircle } from "lucide-react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { cn } from "@/lib/utils";

interface MigrationStepProps {
  logs: LogEntry[];
  error: string | null;
  isMigrating: boolean;
  migrationStatus: MigrationStatusSnapshot | null;
  accessToken: string;
  onTokenChange: (value: string) => void;
  onRunMigration: () => void;
  onBypass: () => void;
}

export function MigrationStep({
  logs,
  error,
  isMigrating,
  migrationStatus,
  accessToken,
  onTokenChange,
  onRunMigration,
  onBypass
}: MigrationStepProps) {
  const canBypass = migrationStatus ? !migrationStatus.needsMigration : false;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Database Migration</h2>
        <p className="text-muted-foreground text-sm">
          {migrationStatus?.message || `Run migration to align database with app v${APP_VERSION}.`}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="migration-token" className="flex items-center gap-2">
          <Key className="w-4 h-4" />
          Supabase Access Token
        </Label>
        <Input
          id="migration-token"
          type="password"
          value={accessToken}
          onChange={(event) => onTokenChange(event.target.value)}
          placeholder="sbp_xxxxxxxxxxxxx"
        />
      </div>

      <TerminalLogs logs={logs} />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3 pt-2">
        {canBypass && (
          <Button variant="ghost" size="sm" onClick={onBypass} disabled={isMigrating}>
            Skip for now
          </Button>
        )}
        <Button
          className="ml-auto"
          onClick={onRunMigration}
          disabled={isMigrating || accessToken.trim() === ""}
        >
          {isMigrating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Migrating...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Run Migration
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
