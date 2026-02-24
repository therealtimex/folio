import { LogEntry } from "../types";
import { TerminalLogs } from "../TerminalLogs";
import { Button } from "../../ui/button";
import { AlertCircle, Loader2 } from "lucide-react";

interface ProvisioningStepProps {
  logs: LogEntry[];
  error: string | null;
  onRetry: () => void;
}

export function ProvisioningStep({ logs, error, onRetry }: ProvisioningStepProps) {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Provisioning</h2>
        <p className="text-muted-foreground text-sm flex items-center gap-2">
          {!error && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          Folio is creating a Supabase project and preparing runtime credentials.
        </p>
      </div>

      <TerminalLogs logs={logs} />

      {error ? (
        <div className="flex items-center gap-3">
          <Button variant="destructive" onClick={onRetry}>
            <AlertCircle className="w-4 h-4 mr-2" />
            Retry Provisioning
          </Button>
        </div>
      ) : null}
    </div>
  );
}
