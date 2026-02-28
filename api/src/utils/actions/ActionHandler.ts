import type { SupabaseClient } from "@supabase/supabase-js";
import { PolicyAction } from "../../services/PolicyLoader.js";
import type { ExtractedData } from "./utils.js";

export interface TraceLog {
    timestamp: string;
    step: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    details?: any;
}

export interface ActionContext {
    action: PolicyAction;
    data: ExtractedData;
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
    outputs?: Record<string, unknown>;
    error?: string;
    errorDetails?: Record<string, unknown>;
}

export interface ActionHandler {
    execute(context: ActionContext): Promise<ActionResult>;
}
