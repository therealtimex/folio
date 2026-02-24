import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Alert, AlertDescription } from "../../ui/alert";
import { ChevronLeft, AlertCircle, Key, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateAccessToken } from "../validators";

interface ManagedTokenStepProps {
  accessToken: string;
  error: string | null;
  isFetching: boolean;
  onTokenChange: (value: string) => void;
  onFetchOrgs: () => void;
  onBack: () => void;
}

export function ManagedTokenStep({
  accessToken,
  error,
  isFetching,
  onTokenChange,
  onFetchOrgs,
  onBack
}: ManagedTokenStepProps) {
  const validation = validateAccessToken(accessToken);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Supabase Access Token</h2>
        <p className="text-muted-foreground text-sm">
          Enter a management token (<code className="text-primary">sbp_...</code>) so Folio can discover organizations and provision a project.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="access-token">Personal Access Token</Label>
          <div className="relative">
            <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="access-token"
              type="password"
              value={accessToken}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder="sbp_xxxxxxxxxxxxx"
              className={cn("pl-9", !validation.valid && accessToken.length > 0 ? "border-destructive focus-visible:ring-destructive" : "")}
            />
          </div>
          {accessToken.length > 0 && (
            <p className={cn("text-xs flex items-center gap-1", validation.valid ? "text-emerald-500" : "text-destructive")}>
              {validation.valid ? <CheckCircle2 className="w-3" /> : <AlertCircle className="w-3" />}
              {validation.message}
            </p>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onBack} disabled={isFetching}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button
          className="ml-auto"
          onClick={onFetchOrgs}
          disabled={!validation.valid || isFetching}
        >
          {isFetching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching...
            </>
          ) : (
            "Fetch Organizations"
          )}
        </Button>
      </div>
    </div>
  );
}
