import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { GoogleSheetsService } from "../../services/GoogleSheetsService.js";
import { pickString, pickColumns, interpolate } from "./utils.js";
import { Actuator } from "../Actuator.js";

const HEADER_ALIASES: Record<string, string[]> = {
    amount: ["total_amount", "amount", "amount_due"],
    total: ["total_amount", "amount", "amount_due"],
    total_amount: ["amount", "amount_due"],
    vendor: ["issuer", "merchant", "store_name", "seller"],
    merchant: ["issuer", "vendor", "store_name", "seller"],
    supplier: ["issuer", "vendor", "merchant"],
    store: ["issuer", "vendor", "merchant", "store_name"],
    document: ["document_type"],
    type: ["document_type"],
    category: ["document_type"],
    issued_on: ["date"],
    invoice_date: ["date"],
    receipt_date: ["date"],
};

function normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildNormalizedVariableLookup(variables: Record<string, string>): Record<string, string> {
    const lookup: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
        const normalized = normalizeKey(key);
        if (normalized && !(normalized in lookup)) {
            lookup[normalized] = value;
        }
    }
    return lookup;
}

function resolveHeaderValue(
    header: string,
    variables: Record<string, string>,
    normalizedVariables: Record<string, string>
): string {
    const trimmed = header.trim();
    if (!trimmed) return "";

    if (variables[trimmed] !== undefined) {
        return variables[trimmed];
    }

    const normalizedHeader = normalizeKey(trimmed);
    if (!normalizedHeader) return "";

    if (normalizedVariables[normalizedHeader] !== undefined) {
        return normalizedVariables[normalizedHeader];
    }

    const aliases = HEADER_ALIASES[normalizedHeader] ?? [];
    for (const alias of aliases) {
        if (normalizedVariables[alias] !== undefined) {
            return normalizedVariables[alias];
        }
    }

    return "";
}

export class AppendToGSheetAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { ingestionId, userId, supabase } = context;
        const result: ActionResult = {
            success: true,
            logs: [],
            trace: [],
        };

        const spreadsheetReference =
            pickString(context.action, "spreadsheet_id") ??
            pickString(context.action, "spreadsheet_url");

        if (!spreadsheetReference) {
            result.success = false;
            result.error = "Missing required Action configuration: 'spreadsheet_id'";
            return result;
        }

        const configuredRange = pickString(context.action, "range");
        const columnTemplates = pickColumns(context.action, []);
        let rangeToAppend = configuredRange;
        let values: string[] = [];
        let usedDynamicMapping = false;

        if (columnTemplates.length > 0) {
            values = columnTemplates.map((template) => interpolate(template, context.variables));
        } else {
            const templateResult = await GoogleSheetsService.resolveTemplate(
                context.userId,
                spreadsheetReference,
                configuredRange,
                context.supabase
            );

            if (!templateResult.success) {
                result.success = false;
                result.error = templateResult.error || "Failed to read Google Sheet template headers";
                if (templateResult.errorDetails) {
                    result.errorDetails = templateResult.errorDetails;
                }
                return result;
            }

            const headers = templateResult.headers ?? [];
            if (headers.length === 0) {
                result.success = false;
                result.error = "Google Sheet template has no header row. Add column names in row 1.";
                return result;
            }

            rangeToAppend = templateResult.range;
            const normalizedVariables = buildNormalizedVariableLookup(context.variables);
            values = headers.map((header) => resolveHeaderValue(header, context.variables, normalizedVariables));
            usedDynamicMapping = true;

            result.trace.push({
                timestamp: new Date().toISOString(),
                step: "Resolved Google Sheet template",
                details: {
                    spreadsheetId: templateResult.spreadsheetId,
                    range: templateResult.range,
                    headersCount: headers.length,
                },
            });

            if (values.every((value) => value.trim().length === 0)) {
                result.success = false;
                result.error = "Unable to map extracted fields to Google Sheet headers. Provide explicit columns mapping or align header names with extracted keys.";
                return result;
            }
        }

        result.trace.push({
            timestamp: new Date().toISOString(),
            step: "Appending to Google Sheet",
            details: { spreadsheetReference, range: rangeToAppend || "Sheet1", columnsCount: values.length, dynamicMapping: usedDynamicMapping },
        });

        const appendResult = await GoogleSheetsService.appendRow(
            context.userId,
            spreadsheetReference,
            rangeToAppend,
            values,
            context.supabase
        );

        if (!appendResult.success) {
            result.success = false;
            result.error = appendResult.error;
            if (appendResult.errorDetails) {
                result.errorDetails = appendResult.errorDetails;
            }
            return result;
        }

        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", {
            action: "append_to_google_sheet",
            spreadsheetId: appendResult.spreadsheetId ?? spreadsheetReference,
            range: appendResult.range ?? rangeToAppend ?? "Sheet1",
            columnsCount: values.length,
            dynamicMapping: usedDynamicMapping,
        }, supabase);

        result.logs.push(`Appended ${values.length} columns to Google Sheet ${appendResult.spreadsheetId ?? spreadsheetReference} at ${appendResult.range ?? rangeToAppend ?? "Sheet1"}`);

        return result;
    }
}
