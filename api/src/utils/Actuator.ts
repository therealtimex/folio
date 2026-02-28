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
import { AppendToGSheetAction } from "./actions/AppendToGSheetAction.js";
import { LogCsvAction } from "./actions/LogCsvAction.js";
import { NotifyAction } from "./actions/NotifyAction.js";
import { WebhookAction } from "./actions/WebhookAction.js";

const logger = createLogger("Actuator");

let warnedMissingServiceRole = false;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toVariableString(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return undefined;
    }
}

function ensureRecord(container: ExtractedData, key: string): Record<string, unknown> {
    const existing = container[key];
    if (isRecord(existing)) {
        return existing;
    }
    const next: Record<string, unknown> = {};
    container[key] = next;
    return next;
}

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
        ["append_to_google_sheet", new AppendToGSheetAction()],
        ["log_csv", new LogCsvAction()],
        ["notify", new NotifyAction()],
        ["webhook", new WebhookAction()],
    ]);

    static registerAction(type: string, handler: ActionHandler) {
        this.handlers.set(type, handler);
    }

    private static mergeActionOutputs(
        runtimeData: ExtractedData,
        runtimeVariables: Record<string, string>,
        actionType: string,
        actionIndex: number,
        outputs: Record<string, unknown>
    ): string[] {
        const outputKeys = Object.keys(outputs);
        if (outputKeys.length === 0) return outputKeys;

        const actionsByType = ensureRecord(runtimeData, "_actions");
        const previousByType = actionsByType[actionType];
        const mergedByType = {
            ...(isRecord(previousByType) ? previousByType : {}),
            ...outputs,
        };
        actionsByType[actionType] = mergedByType;

        const history = Array.isArray(runtimeData._action_history) ? [...runtimeData._action_history] : [];
        const historyEntry: Record<string, unknown> = {
            index: actionIndex,
            type: actionType,
            ...outputs,
        };
        history.push(historyEntry);
        runtimeData._action_history = history;
        runtimeData._last = historyEntry;
        runtimeData._last_action_type = actionType;
        runtimeVariables._last_action_type = actionType;

        for (const key of outputKeys) {
            const value = outputs[key];
            const serialized = toVariableString(value);

            if (runtimeData[key] === undefined) {
                runtimeData[key] = value;
            }

            if (serialized === undefined) continue;

            runtimeVariables[`${actionType}.${key}`] = serialized;
            runtimeVariables[`_actions.${actionType}.${key}`] = serialized;
            runtimeVariables[`_last.${key}`] = serialized;

            if (runtimeVariables[key] === undefined) {
                runtimeVariables[key] = serialized;
            }
        }

        return outputKeys;
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

        const runtimeData: ExtractedData = { ...data };
        const runtimeVariables = deriveVariables(runtimeData, fields);
        runtimeData.current_file_name = currentFile.name;
        runtimeData.current_file_path = currentFile.path;
        runtimeVariables.current_file_name = currentFile.name;
        runtimeVariables.current_file_path = currentFile.path;

        for (const [actionIndex, action] of actions.entries()) {
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
                runtimeData.current_file_name = currentFile.name;
                runtimeData.current_file_path = currentFile.path;
                runtimeVariables.current_file_name = currentFile.name;
                runtimeVariables.current_file_path = currentFile.path;

                const context: ActionContext = {
                    action: action as any,
                    data: runtimeData,
                    file: currentFile,
                    variables: runtimeVariables,
                    userId,
                    ingestionId,
                    supabase,
                };

                const handlerResult = await handler.execute(context);

                result.trace.push(...handlerResult.trace);

                if (handlerResult.success) {
                    if (handlerResult.newFileState) {
                        currentFile = handlerResult.newFileState;
                        runtimeData.current_file_name = currentFile.name;
                        runtimeData.current_file_path = currentFile.path;
                        runtimeVariables.current_file_name = currentFile.name;
                        runtimeVariables.current_file_path = currentFile.path;
                    }
                    if (handlerResult.outputs && Object.keys(handlerResult.outputs).length > 0) {
                        const outputKeys = this.mergeActionOutputs(
                            runtimeData,
                            runtimeVariables,
                            action.type,
                            actionIndex,
                            handlerResult.outputs
                        );
                        result.trace.push({
                            timestamp: new Date().toISOString(),
                            step: "Captured action outputs",
                            details: {
                                action: action.type,
                                outputKeys,
                            },
                        });
                    }
                    result.actionsExecuted.push(...handlerResult.logs);
                } else {
                    const msg = `Action failed (${action.type}): ${handlerResult.error}`;
                    logger.error(msg);
                    result.errors.push(msg);
                    result.success = false;
                    const eventDetails: Record<string, unknown> = {
                        action: action.type,
                        error: handlerResult.error,
                    };
                    if (handlerResult.errorDetails && Object.keys(handlerResult.errorDetails).length > 0) {
                        Object.assign(eventDetails, handlerResult.errorDetails);
                    }
                    Actuator.logEvent(ingestionId, userId, "error", "Action Execution", eventDetails, supabase);
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
