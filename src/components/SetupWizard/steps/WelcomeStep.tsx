import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { ShieldCheck, Layers } from "lucide-react";

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col h-full justify-center gap-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-4 text-center sm:text-left">
        <h2 className="text-5xl font-black tracking-tight leading-tight">
          Welcome to <span className="text-primary">Folio</span>
        </h2>
        <p className="text-muted-foreground text-lg max-w-lg leading-relaxed">
          Let's configure your foundation runtime: local desktop app, remote Supabase database, and
          RealTimeX SDK backend connectivity.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Card className="bg-muted/30 border-border/40 shadow-sm hover:shadow-md transition-all duration-300">
          <CardHeader className="pb-3 px-6">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Secure by Default
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Credentials are stored locally and used to configure runtime contracts only.
            </p>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/40 shadow-sm hover:shadow-md transition-all duration-300">
          <CardHeader className="pb-3 px-6">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <Layers className="w-5 h-5 text-primary" />
              No Feature Lock-In
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              This step only prepares infrastructure, not document automation features.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="pt-4 flex justify-center sm:justify-start">
        <Button size="lg" className="h-14 px-10 rounded-2xl text-base font-black shadow-xl shadow-primary/20 hover:scale-105 transition-all" onClick={onNext}>
          Start Setup
        </Button>
      </div>
    </div>
  );
}
