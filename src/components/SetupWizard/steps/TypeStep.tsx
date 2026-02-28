import { Button } from "../../ui/button";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Card, CardHeader, CardTitle, CardDescription } from "../../ui/card";
import { ChevronLeft, Zap, Settings2, ChevronRight } from "lucide-react";

interface TypeStepProps {
  onManaged: () => void;
  onManual: () => void;
  onBack: () => void;
}

export function TypeStep({ onManaged, onManual, onBack }: TypeStepProps) {
  return (
    <div className="flex flex-col h-full justify-center gap-10 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-3">
        <h2 className="text-4xl font-black tracking-tight">Setup Mode</h2>
        <p className="text-muted-foreground text-lg leading-relaxed max-w-md">
          Select whether Folio should auto-provision a project or connect to an existing one.
        </p>
      </div>

      <div className="grid gap-6">
        <button
          onClick={onManaged}
          className="group relative flex flex-col items-start p-8 text-left border border-border/40 rounded-3xl hover:border-primary hover:bg-primary/5 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-500">
              <Zap className="w-6 h-6 fill-primary/20" />
            </div>
            <strong className="text-xl font-bold">Managed Setup</strong>
          </div>
          <span className="text-muted-foreground leading-relaxed">
            Use an access token to auto-provision project + run migration automatically. Recommended for most users.
          </span>
          <div className="absolute top-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <ChevronRight className="w-6 h-6 text-primary" />
          </div>
        </button>

        <button
          onClick={onManual}
          className="group relative flex flex-col items-start p-8 text-left border border-border/40 rounded-3xl hover:border-primary hover:bg-primary/5 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary group-hover:scale-110 transition-all duration-500">
              <Settings2 className="w-6 h-6" />
            </div>
            <strong className="text-xl font-bold">Manual Connection</strong>
          </div>
          <span className="text-muted-foreground leading-relaxed">
            Provide your own Supabase URL + anon key. Use this if you already have a configured project.
          </span>
          <div className="absolute top-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <ChevronRight className="w-6 h-6 text-primary" />
          </div>
        </button>
      </div>

      <div className="pt-4">
        <Button variant="ghost" size="sm" className="w-fit -ml-2 text-muted-foreground hover:text-foreground h-10 px-4 rounded-xl font-bold" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Welcome
        </Button>
      </div>
    </div>
  );
}
