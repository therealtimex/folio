import type { SupabaseClient } from "@supabase/supabase-js";
import { PolicyAction } from "../../services/PolicyLoader.js";

export interface TraceLog {
    timestamp: string;
    step: string;
    details?: any;
}

export interface ActionContext {
    action: PolicyAction;
    data: Record<string, string | number | null>;
    file: { path: string; name: string };
    variables: Record<string, string>;
    userId: string;
    ingestionId: string;
    supabase?: SupabaseClient | null;
}

export interface ActionResult {
    success: boolean;
    newFileState?: { path: string; name: string };
    logs: string[];
    trace: TraceLog[];
    error?: string;
    errorDetails?: Record<string, unknown>;
}

export interface ActionHandler {
    execute(context: ActionContext): Promise<ActionResult>;
}
