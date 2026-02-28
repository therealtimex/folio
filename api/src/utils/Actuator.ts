import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "./logger.js";
import type { ExtractField } from "../services/PolicyLoader.js";
import { getServiceRoleSupabase } from "../services/supabase.js";
import { ActionHandler, ActionContext } from "./actions/ActionHandler.js";
import { ActionInput, ExtractedData, deriveVariables } from "./actions/utils.js";

import { RenameAction } from "./actions/RenameAction.js";
import { AutoRenameAction } from "./actions/AutoRenameAction.js";
import { CopyAction } from "./actions/CopyAction.js";
import { CopyToGDriveAction } from "./actions/CopyToGDriveAction.js";
import { LogCsvAction } from "./actions/LogCsvAction.js";
import { NotifyAction } from "./actions/NotifyAction.js";
import { WebhookAction } from "./actions/WebhookAction.js";

const logger = createLogger("Actuator");

let warnedMissingServiceRole = false;

export interface ActuatorResult {
    success: boolean;
    actionsExecuted: string[];
    errors: string[];
    trace: { timestamp: string; step: string; details?: any }[];
}

export class Actuator {
    private static handlers: Map<string, ActionHandler> = new Map([
        ["rename", new RenameAction()],
        ["auto_rename", new AutoRenameAction()],
        ["copy", new CopyAction()],
        ["copy_to_gdrive", new CopyToGDriveAction()],
        ["log_csv", new LogCsvAction()],
        ["notify", new NotifyAction()],
        ["webhook", new WebhookAction()],
    ]);

    static registerAction(type: string, handler: ActionHandler) {
        this.handlers.set(type, handler);
    }

    static async logEvent(
        ingestionId: string | null,
        userId: string | null,
        eventType: "info" | "action" | "error" | "analysis",
        state: string,
        details: any,
        supabaseClient?: SupabaseClient | null
    ) {
        // Fire and forget, don't await blocking execution
        const supabase = supabaseClient ?? getServiceRoleSupabase();
        if (!supabase) {
            if (!warnedMissingServiceRole) {
                logger.warn("Service-role Supabase client unavailable; skipping processing_events stream writes.");
                warnedMissingServiceRole = true;
            }
            return;
        }

        void supabase.from("processing_events").insert({
            ingestion_id: ingestionId ?? null,
            user_id: userId ?? null,
            event_type: eventType,
            agent_state: state,
            details,
        }).then(({ error }: { error: unknown }) => {
            if (error) logger.warn("Failed to stream actuator log", { error });
        });
    }

    /**
     * Executes an array of abstract action definitions.
     */
    static async execute(
        ingestionId: string,
        userId: string,
        actions: ActionInput[],
        data: ExtractedData,
        file: { path: string; name: string },
        fields: ExtractField[] = [],
        supabase?: SupabaseClient | null
    ): Promise<ActuatorResult> {
        const result: ActuatorResult = {
            success: true,
            actionsExecuted: [],
            errors: [],
            trace: [],
        };

        result.trace.push({ timestamp: new Date().toISOString(), step: "Initializing Actuator", details: { actionsCount: actions.length } });
        Actuator.logEvent(ingestionId, userId, "info", "Actuator Initialized", { actionsCount: actions.length }, supabase);

        // Convert the 13-digit Dropzone timestamp into a human-readable local time
        // (e.g. "1772148849046-bill.pdf" -> "2026-02-26_15-34-09_bill.pdf")
        // Note: only `currentFile.name` is normalized; `file.path` (disk path) is unchanged.
        const tsMatch = file.name.match(/^(\d{13})-(.*)$/);
        let currentFile = { ...file };
        if (tsMatch) {
            const date = new Date(parseInt(tsMatch[1], 10));
            const yyyy = date.getFullYear();
            const MM = String(date.getMonth() + 1).padStart(2, "0");
            const dd = String(date.getDate()).padStart(2, "0");
            const HH = String(date.getHours()).padStart(2, "0");
            const mm = String(date.getMinutes()).padStart(2, "0");
            const ss = String(date.getSeconds()).padStart(2, "0");
            currentFile.name = `${yyyy}-${MM}-${dd}_${HH}-${mm}-${ss}_${tsMatch[2]}`;
        }

        const variables = deriveVariables(data, fields);

        for (const action of actions) {
            const handler = this.handlers.get(action.type);

            if (!handler) {
                const msg = `Action failed: Unsupported action type '${action.type}'`;
                logger.error(msg);
                result.errors.push(msg);
                result.success = false;
                result.trace.push({ timestamp: new Date().toISOString(), step: `Unsupported action type`, details: { type: action.type } });
                Actuator.logEvent(ingestionId, userId, "error", "Action Execution", { action: action.type, error: msg }, supabase);
                continue;
            }

            try {
                const context: ActionContext = {
                    action: action as any,
                    data,
                    file: currentFile,
                    variables,
                    userId,
                    ingestionId,
                    supabase,
                };

                const handlerResult = await handler.execute(context);

                result.trace.push(...handlerResult.trace);

                if (handlerResult.success) {
                    if (handlerResult.newFileState) {
                        currentFile = handlerResult.newFileState;
                    }
                    result.actionsExecuted.push(...handlerResult.logs);
                } else {
                    const msg = `Action failed (${action.type}): ${handlerResult.error}`;
                    logger.error(msg);
                    result.errors.push(msg);
                    result.success = false;
                    Actuator.logEvent(ingestionId, userId, "error", "Action Execution", { action: action.type, error: handlerResult.error }, supabase);
                }
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const msg = `Action failed (${action.type}): ${errMsg}`;
                logger.error(msg);
                result.errors.push(msg);
                result.success = false;
                result.trace.push({ timestamp: new Date().toISOString(), step: `Action execution error`, details: { type: action.type, error: errMsg } });
                Actuator.logEvent(ingestionId, userId, "error", "Action Execution", { action: action.type, error: errMsg }, supabase);
            }
        }

        return result;
    }
}
