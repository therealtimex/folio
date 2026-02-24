import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { Label } from "../../ui/label";
import { Alert, AlertDescription } from "../../ui/alert";
import { ChevronLeft, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateKeyFormat, validateUrlFormat } from "../validators";

interface CredentialsStepProps {
  url: string;
  anonKey: string;
  error: string | null;
  onUrlChange: (value: string) => void;
  onAnonKeyChange: (value: string) => void;
  onSave: () => void;
  onBack: () => void;
}

export function CredentialsStep({
  url,
  anonKey,
  error,
  onUrlChange,
  onAnonKeyChange,
  onSave,
  onBack
}: CredentialsStepProps) {
  const urlValidation = validateUrlFormat(url);
  const keyValidation = validateKeyFormat(anonKey);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Manual Credentials</h2>
        <p className="text-muted-foreground text-sm">
          Connect Folio to an existing Supabase project with URL and anon key.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="supabase-url">Supabase URL or Project ID</Label>
          <Input
            id="supabase-url"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="https://project.supabase.co or project-id"
            className={!urlValidation.valid && url.length > 0 ? "border-destructive focus-visible:ring-destructive" : ""}
          />
          {url.length > 0 && (
            <p className={cn("text-xs flex items-center gap-1", urlValidation.valid ? "text-emerald-500" : "text-destructive")}>
              {urlValidation.valid ? <CheckCircle2 className="w-3" /> : <AlertCircle className="w-3" />}
              {urlValidation.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="supabase-anon-key">Anon Key</Label>
          <Textarea
            id="supabase-anon-key"
            value={anonKey}
            onChange={(event) => onAnonKeyChange(event.target.value)}
            placeholder="eyJ..."
            className={cn("min-h-[120px] font-mono text-xs", !keyValidation.valid && anonKey.length > 0 ? "border-destructive focus-visible:ring-destructive" : "")}
          />
          {anonKey.length > 0 && (
            <p className={cn("text-xs flex items-center gap-1", keyValidation.valid ? "text-emerald-500" : "text-destructive")}>
              {keyValidation.valid ? <CheckCircle2 className="w-3" /> : <AlertCircle className="w-3" />}
              {keyValidation.message}
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
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button
          className="ml-auto"
          onClick={onSave}
          disabled={!urlValidation.valid || !keyValidation.valid}
        >
          Validate and Continue
        </Button>
      </div>
    </div>
  );
}
