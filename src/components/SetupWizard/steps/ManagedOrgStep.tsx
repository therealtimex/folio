import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Label } from "../../ui/label";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Card } from "../../ui/card";
import { ChevronLeft, Building2, Globe, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Organization } from "../types";

interface ManagedOrgStepProps {
  organizations: Organization[];
  selectedOrg: string;
  projectName: string;
  region: string;
  onOrgSelect: (orgId: string) => void;
  onProjectNameChange: (name: string) => void;
  onRegionChange: (region: string) => void;
  onProvision: () => void;
  onBack: () => void;
}

const REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-west-1", label: "US West (N. California)" },
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" }
];

export function ManagedOrgStep({
  organizations,
  selectedOrg,
  projectName,
  region,
  onOrgSelect,
  onProjectNameChange,
  onRegionChange,
  onProvision,
  onBack
}: ManagedOrgStepProps) {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Provisioning Parameters</h2>
        <p className="text-muted-foreground text-sm">
          Choose an organization and project configuration for Folio deployment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="project-name">Project Name</Label>
          <Input
            id="project-name"
            value={projectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder="my-folio-app"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="region">Region</Label>
          <Select value={region} onValueChange={onRegionChange}>
            <SelectTrigger id="region">
              <SelectValue placeholder="Select region" />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Select Organization
        </Label>
        <div className="grid gap-2 max-h-[160px] overflow-y-auto p-1 rounded-lg border bg-muted/20">
          {organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => onOrgSelect(org.id)}
              className={cn(
                "flex items-center justify-between p-3 rounded-md border text-sm transition-all",
                selectedOrg === org.id
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background hover:border-primary/50"
              )}
            >
              <span>{org.name}</span>
              {selectedOrg === org.id && <Globe className="w-3 h-3 opacity-70" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button
          className="ml-auto"
          onClick={onProvision}
          disabled={!selectedOrg || !projectName}
        >
          <Rocket className="mr-2 h-4 w-4" />
          Auto-Provision
        </Button>
      </div>
    </div>
  );
}
