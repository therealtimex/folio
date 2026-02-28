import type { ExtractField } from "../../services/PolicyLoader.js";
import { createLogger } from "../logger.js";

const logger = createLogger("ActionUtils");

export type ExtractedData = Record<string, string | number | null>;

export type ActionInput = {
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

// ─── Variable Interpolation ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function maybeParseJson(value: unknown): unknown {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
}

function tokenizePath(path: string): Array<string | number> {
    const tokens: Array<string | number> = [];
    let i = 0;

    while (i < path.length) {
        const ch = path[i];
        if (ch === ".") {
            i += 1;
            continue;
        }

        if (ch === "[") {
            const end = path.indexOf("]", i + 1);
            if (end < 0) break;
            const raw = path.slice(i + 1, end).trim();
            if (/^\d+$/.test(raw)) {
                tokens.push(Number(raw));
            } else {
                const unquoted = raw.replace(/^["']|["']$/g, "");
                if (unquoted) tokens.push(unquoted);
            }
            i = end + 1;
            continue;
        }

        let j = i;
        while (j < path.length && path[j] !== "." && path[j] !== "[") {
            j += 1;
        }
        const token = path.slice(i, j).trim();
        if (token) tokens.push(token);
        i = j;
    }

    return tokens;
}

function toTemplateString(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function getNestedVariable(
    keyPath: string,
    vars: Record<string, string>,
    data?: ExtractedData
): string | undefined {
    const key = keyPath.trim();
    if (!key) return undefined;

    if (vars[key] !== undefined) {
        return vars[key];
    }

    const root: Record<string, unknown> = {
        ...(data ?? {}),
        ...vars,
    };

    const tokens = tokenizePath(key);
    if (tokens.length === 0) return undefined;

    let current: unknown = root;

    for (let i = 0; i < tokens.length; i += 1) {
        if (typeof current === "string") {
            const parsed = maybeParseJson(current);
            if (parsed !== undefined) {
                current = parsed;
            }
        }

        const token = tokens[i];
        if (Array.isArray(current)) {
            if (typeof token !== "number") return undefined;
            current = current[token];
            continue;
        }

        if (!isRecord(current)) {
            return undefined;
        }

        if (typeof token === "number") {
            current = current[String(token)];
            continue;
        }

        const lookupToken =
            i === 0 && token === "enrichment" && current["_enrichment"] !== undefined
                ? "_enrichment"
                : token;
        current = current[lookupToken];
    }

    return toTemplateString(current);
}

export function interpolate(
    template: string,
    vars: Record<string, string>,
    data?: ExtractedData
): string {
    return template.replace(/\{([^{}]+)\}/g, (match, rawKey: string) => {
        const resolved = getNestedVariable(rawKey, vars, data);
        return resolved ?? match;
    });
}

/**
 * Derive computed variables from extracted data using transformer definitions.
 */
export function deriveVariables(
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

export function pickString(action: ActionInput, key: string): string | undefined {
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

// ─── Filename Helpers ──────────────────────────────────────────────────────

/**
 * Build a filename stem from extracted metadata when suggested_filename is unavailable.
 * Format: YYYY-MM-DD_Issuer_DocType  (any missing parts are simply omitted)
 */
export function deriveNameFromVariables(variables: Record<string, string>): string | null {
    const parts: string[] = [];

    if (variables.date) {
        const d = new Date(variables.date);
        if (!isNaN(d.getTime())) {
            const yyyy = d.getFullYear();
            const MM = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            parts.push(`${yyyy}-${MM}-${dd}`);
        }
    }

    if (variables.issuer) {
        parts.push(variables.issuer.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }

    if (variables.document_type) {
        parts.push(variables.document_type.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]+/g, ""));
    }

    if (variables.amount || variables.total_amount) {
        const raw = (variables.amount ?? variables.total_amount).replace(/[^0-9.$€£]/g, "");
        if (raw) parts.push(raw);
    }

    return parts.length > 0 ? parts.join("_") : null;
}

/**
 * Resolve a final filename given the action's `filename` config field.
 *
 * Modes:
 *   undefined / "" / "original" → keep original stem + ext
 *   "auto"                       → AI suggested_filename → derived → originalStem, then + ext
 *   any other string             → treat as a {variable} interpolation pattern
 */
export function resolveFilename(
    filenameConfig: string | undefined,
    variables: Record<string, string>,
    originalStem: string,
    ext: string,
    data?: ExtractedData
): string {
    if (!filenameConfig || filenameConfig === "original") {
        return originalStem + ext;
    }

    if (filenameConfig === "auto") {
        const smart =
            deriveNameFromVariables(variables) ||
            variables.suggested_filename?.trim() ||
            originalStem;
        return smart.endsWith(ext) ? smart : smart + ext;
    }

    // Custom interpolation pattern
    const interpolated = interpolate(filenameConfig, variables, data);
    return interpolated.endsWith(ext) ? interpolated : interpolated + ext;
}

export function pickColumns(action: ActionInput, fallback: string[]): string[] {
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
