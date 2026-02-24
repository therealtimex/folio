import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./logger.js";
import type { PolicyAction, ExtractField } from "../services/PolicyLoader.js";

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
}

export class Actuator {
    static async execute(
        filePath: string,
        actions: PolicyAction[],
        data: ExtractedData,
        fields: ExtractField[] = []
    ): Promise<ActuatorResult> {
        const result: ActuatorResult = {
            success: true,
            actionsExecuted: [],
            errors: [],
        };

        const vars = deriveVariables(data, fields);
        let currentPath = filePath;

        for (const action of actions) {
            try {
                if (action.type === "rename" && action.pattern) {
                    const ext = path.extname(currentPath);
                    const dir = path.dirname(currentPath);
                    let newName = interpolate(action.pattern, vars);
                    if (!newName.endsWith(ext)) newName += ext;
                    const newPath = path.join(dir, newName);
                    fs.renameSync(currentPath, newPath);
                    currentPath = newPath;
                    result.actionsExecuted.push(`Renamed → ${newName}`);

                } else if (action.type === "move" && action.destination) {
                    const destDir = interpolate(action.destination, vars);
                    fs.mkdirSync(destDir, { recursive: true });
                    const newPath = path.join(destDir, path.basename(currentPath));
                    fs.renameSync(currentPath, newPath);
                    currentPath = newPath;
                    result.actionsExecuted.push(`Moved → ${destDir}`);

                } else if (action.type === "log_csv" && action.path) {
                    const csvPath = interpolate(action.path, vars);
                    const cols = action.columns || Object.keys(data);
                    const row = cols.map((c) => vars[c] ?? "").join(",") + "\n";
                    const header = cols.join(",") + "\n";
                    if (!fs.existsSync(csvPath)) {
                        fs.mkdirSync(path.dirname(csvPath), { recursive: true });
                        fs.writeFileSync(csvPath, header + row, "utf-8");
                    } else {
                        fs.appendFileSync(csvPath, row, "utf-8");
                    }
                    result.actionsExecuted.push(`Logged CSV → ${csvPath}`);

                } else if (action.type === "notify" && action.message) {
                    const msg = interpolate(action.message, vars);
                    logger.info(`[NOTIFY] ${msg}`);
                    result.actionsExecuted.push(`Notified: ${msg}`);
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                logger.error(`Action '${action.type}' failed: ${errMsg}`);
                result.errors.push(`${action.type}: ${errMsg}`);
                result.success = false;
            }
        }

        return result;
    }
}
