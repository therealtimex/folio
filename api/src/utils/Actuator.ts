import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "path";
import { createLogger } from "./logger.js";
import type { ExtractField } from "../services/PolicyLoader.js";
import { getServiceRoleSupabase } from "../services/supabase.js";

const logger = createLogger("Actuator");

type ExtractedData = Record<string, string | number | null>;

// ─── Variable Interpolation ────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/**
 * Derive computed variables from extracted data using transformer definitions.
 */
function deriveVariables(
    data: ExtractedData,
    fields: ExtractField[]
): Record<string, string> {
    const vars: Record<string, string> = {};

    // Populate raw extracted values as strings
    for (const [k, v] of Object.entries(data)) {
        if (v != null) vars[k] = String(v);
    }

    // Run transformers
    for (const field of fields) {
        if (!field.transformers) continue;
        const rawValue = vars[field.key];
        if (!rawValue) continue;

        for (const t of field.transformers) {
            try {
                if (t.name === "get_year") {
                    vars[t.as] = new Date(rawValue).getFullYear().toString();
                } else if (t.name === "get_month_name") {
                    vars[t.as] = new Date(rawValue).toLocaleString("en-US", { month: "long" });
                } else if (t.name === "get_month") {
                    vars[t.as] = String(new Date(rawValue).getMonth() + 1).padStart(2, "0");
                }
            } catch {
                logger.warn(`Transformer '${t.name}' failed for key '${field.key}'`);
            }
        }
    }

    return vars;
}

// ─── Actuator ───────────────────────────────────────────────────────────────

export interface ActuatorResult {
    success: boolean;
    actionsExecuted: string[];
    errors: string[];
    trace: { timestamp: string; step: string; details?: any }[];
}

type ActionInput = {
    type: string;
    config?: Record<string, unknown>;
    pattern?: string;
    destination?: string;
    path?: string;
    columns?: string[] | string;
    message?: string;
    url?: string;
    payload?: string;
};

let warnedMissingServiceRole = false;

function pickString(action: ActionInput, key: string): string | undefined {
    const value = action.config?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }

    const legacyValue = (action as Record<string, unknown>)[key];
    if (typeof legacyValue === "string" && legacyValue.trim().length > 0) {
        return legacyValue;
    }

    return undefined;
}

function pickColumns(action: ActionInput, fallback: string[]): string[] {
    const value = action.config?.columns;
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
    }

    const legacyColumns = action.columns;
    if (Array.isArray(legacyColumns)) {
        return legacyColumns.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof legacyColumns === "string") {
        return legacyColumns.split(",").map((item) => item.trim()).filter(Boolean);
    }

    return fallback;
}

export class Actuator {
    static async logEvent(
        ingestionId: string,
        userId: string,
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
            ingestion_id: ingestionId,
            user_id: userId,
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

        const vars = deriveVariables(data, fields);
        let currentPath = file.path;

        for (const action of actions) {
            try {
                const pattern = pickString(action, "pattern");
                const destination = pickString(action, "destination");
                const csvPathTemplate = pickString(action, "path");
                const messageTemplate = pickString(action, "message");
                const webhookUrlTemplate = pickString(action, "url");
                const webhookPayloadTemplate = pickString(action, "payload");

                if (action.type === "rename" && pattern) {
                    const ext = path.extname(currentPath);
                    const dir = path.dirname(currentPath);
                    let newName = interpolate(pattern, vars);
                    if (!newName.endsWith(ext)) newName += ext;
                    const newPath = path.join(dir, newName);
                    await new Promise<void>((resolve, reject) => {
                        fs.rename(currentPath, newPath, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    currentPath = newPath;
                    result.actionsExecuted.push(`Renamed to '${newName}'`);
                    result.trace.push({ timestamp: new Date().toISOString(), step: `Renamed file to ${newName}`, details: { original: file.name, new: newName } });
                    Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "rename", original: file.name, new: newName }, supabase);
                    file = { ...file, path: newPath, name: newName };

                } else if (action.type === "move" && destination) {
                    const destDir = interpolate(destination, vars);
                    fs.mkdirSync(destDir, { recursive: true });
                    const newPath = path.join(destDir, path.basename(currentPath));
                    await new Promise<void>((resolve, reject) => {
                        fs.rename(currentPath, newPath, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    currentPath = newPath;
                    result.actionsExecuted.push(`Moved to '${destDir}'`);
                    result.trace.push({ timestamp: new Date().toISOString(), step: `Moved file to ${destDir}` });
                    Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "move", destination: destDir }, supabase);
                    file = { ...file, path: newPath };

                } else if (action.type === "log_csv" && csvPathTemplate) {
                    const csvPath = interpolate(csvPathTemplate, vars);
                    const cols = pickColumns(action, Object.keys(data));
                    const row = cols.map((c) => vars[c] ?? "").join(",") + "\n";
                    const header = cols.join(",") + "\n";
                    if (!fs.existsSync(csvPath)) {
                        fs.mkdirSync(path.dirname(csvPath), { recursive: true });
                        fs.writeFileSync(csvPath, header + row, "utf-8");
                    } else {
                        fs.appendFileSync(csvPath, row, "utf-8");
                    }
                    result.actionsExecuted.push(`Logged CSV → ${csvPath}`);
                    result.trace.push({ timestamp: new Date().toISOString(), step: "Executed log_csv action", details: { csvPath, cols } });
                    Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "log_csv", csvPath, cols }, supabase);

                } else if (action.type === "notify" && messageTemplate) {
                    const msg = interpolate(messageTemplate, vars);
                    logger.info(`[NOTIFY] ${msg}`);
                    result.actionsExecuted.push(`Notified: ${msg}`);
                    result.trace.push({ timestamp: new Date().toISOString(), step: "Executed notify action", details: { message: msg } });
                    Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "notify", message: msg }, supabase);

                } else if (action.type === "webhook" && webhookUrlTemplate && webhookPayloadTemplate) {
                    const url = interpolate(webhookUrlTemplate, vars);
                    const payload = JSON.parse(interpolate(webhookPayloadTemplate, vars));
                    await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });
                    result.actionsExecuted.push(`Logged via webhook`);
                    result.trace.push({ timestamp: new Date().toISOString(), step: `Webhook payload sent to ${url}`, details: { url, payload } });
                    Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "webhook", url }, supabase);
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
