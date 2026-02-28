import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabase } from "./supabase.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("GoogleSheetsService");

type IntegrationCredentials = {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    client_id?: string;
    client_secret?: string;
};

type AppendResult = {
    success: boolean;
    error?: string;
    errorDetails?: GoogleSheetsErrorDetails;
    spreadsheetId?: string;
    range?: string;
};

type ResolveTemplateResult = {
    success: boolean;
    error?: string;
    errorDetails?: GoogleSheetsErrorDetails;
    spreadsheetId?: string;
    range?: string;
    headers?: string[];
    headerDropdowns?: Array<TemplateHeaderDropdown | null>;
};

type ParsedSpreadsheetReference = {
    spreadsheetId: string;
    gid?: number;
};

type SheetsAuthContext = {
    supabase: SupabaseClient;
    integrationId: string;
    credentials: IntegrationCredentials;
    accessToken: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
};

type GoogleSheetsHelpLink = {
    label: string;
    url: string;
};

type GoogleSheetsRemediation = {
    provider: "google_sheets";
    code?: string;
    title: string;
    summary: string;
    steps: string[];
    links?: GoogleSheetsHelpLink[];
};

type GoogleSheetsErrorDetails = {
    provider: "google_sheets";
    httpStatus: number;
    googleCode?: number;
    googleStatus?: string;
    reason?: string;
    activationUrl?: string;
    remediation?: GoogleSheetsRemediation;
};

type ParsedGoogleErrorDetail = {
    reason?: string;
    metadata?: {
        activationUrl?: string;
        service?: string;
        serviceTitle?: string;
        consumer?: string;
    };
    links?: Array<{
        description?: string;
        url?: string;
    }>;
};

type ParsedGoogleApiError = {
    code?: number;
    message?: string;
    status?: string;
    details?: ParsedGoogleErrorDetail[];
};

type ParsedGoogleErrorResponse = {
    error?: ParsedGoogleApiError;
};

type GoogleDataValidationConditionValue = {
    userEnteredValue?: string;
};

type GoogleDataValidationCondition = {
    type?: string;
    values?: GoogleDataValidationConditionValue[];
};

type GoogleDataValidationRule = {
    condition?: GoogleDataValidationCondition;
    strict?: boolean;
};

type GoogleCellData = {
    dataValidation?: GoogleDataValidationRule;
};

type TemplateHeaderDropdown = {
    strict: boolean;
    allowedValues: string[];
};

function parseCredentials(value: unknown): IntegrationCredentials {
    if (!value || typeof value !== "object") {
        return {};
    }

    const record = value as Record<string, unknown>;
    return {
        access_token: typeof record.access_token === "string" ? record.access_token : undefined,
        refresh_token: typeof record.refresh_token === "string" ? record.refresh_token : undefined,
        expires_at: typeof record.expires_at === "number" ? record.expires_at : undefined,
        client_id: typeof record.client_id === "string" ? record.client_id : undefined,
        client_secret: typeof record.client_secret === "string" ? record.client_secret : undefined,
    };
}

function parseGid(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return undefined;
    return parsed;
}

function parseSpreadsheetReference(reference: string): ParsedSpreadsheetReference | null {
    const raw = reference.trim();
    if (!raw) return null;

    const idFromPath = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (idFromPath?.[1]) {
        let gid: number | undefined;
        try {
            const url = new URL(raw);
            gid = parseGid(url.searchParams.get("gid"));
            if (gid === undefined && url.hash) {
                const hashGid = url.hash.match(/gid=(\d+)/)?.[1];
                gid = parseGid(hashGid);
            }
        } catch {
            // Best-effort URL parsing; we still have spreadsheet ID.
        }
        if (gid === undefined) {
            gid = parseGid(raw.match(/[?#]gid=(\d+)/)?.[1]);
        }

        return {
            spreadsheetId: idFromPath[1],
            ...(gid !== undefined ? { gid } : {}),
        };
    }

    const idOnly = raw.match(/^([a-zA-Z0-9-_]{20,})$/);
    if (idOnly?.[1]) {
        return { spreadsheetId: idOnly[1] };
    }

    return null;
}

function toSheetRef(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return "Sheet1";
    if (/^'.*'$/.test(trimmed)) return trimmed;
    if (/^[A-Za-z0-9_]+$/.test(trimmed)) return trimmed;
    return `'${trimmed.replace(/'/g, "''")}'`;
}

function isA1CoordinateRange(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;

    // Row-based references: "1", "1:10"
    if (/^\d+(?::\d+)?$/.test(trimmed)) return true;

    // Column range references: "A:Z", "AA:AZ", "$A:$Z"
    if (/^\$?[A-Za-z]{1,4}\$?(?::\$?[A-Za-z]{1,4}\$?)$/.test(trimmed)) return true;

    // Cell / partial references: "A1", "A1:B20", "A1:B", "A:B20", "$A$1:$B$20"
    if (/^\$?[A-Za-z]{1,4}\$?\d+(?::\$?[A-Za-z]{1,4}\$?\d*)?$/.test(trimmed)) return true;
    if (/^\$?[A-Za-z]{1,4}\$?(?::\$?[A-Za-z]{1,4}\$?\d+)$/.test(trimmed)) return true;

    // Single column references like "A", "AA" are valid A1,
    // but long alphabetic strings are usually sheet names (e.g. "Transaction").
    if (/^\$?[A-Za-z]{1,4}\$?$/.test(trimmed)) return true;

    return false;
}

function extractSheetRef(range: string): string | null {
    const trimmed = range.trim();
    if (!trimmed) return null;
    const bang = trimmed.indexOf("!");
    if (bang >= 0) {
        const sheetRef = trimmed.slice(0, bang).trim();
        return sheetRef || null;
    }
    if (isA1CoordinateRange(trimmed)) return null;
    return trimmed;
}

function normalizeSheetRefForComparison(value: string): string {
    const trimmed = value.trim();
    if (/^'.*'$/.test(trimmed)) {
        return trimmed.slice(1, -1).replace(/''/g, "'").trim().toLowerCase();
    }
    return trimmed.toLowerCase();
}

function isDefaultSheetRef(sheetRef: string): boolean {
    return normalizeSheetRefForComparison(sheetRef) === "sheet1";
}

function applySheetRefToRange(range: string, sheetRef: string): string {
    const trimmed = range.trim();
    if (!trimmed) return sheetRef;

    // If caller already passed the target sheet title as a bare range, keep it as-is.
    if (normalizeSheetRefForComparison(trimmed) === normalizeSheetRefForComparison(sheetRef)) {
        return sheetRef;
    }

    const bang = trimmed.indexOf("!");
    if (bang >= 0) {
        const tail = trimmed.slice(bang + 1).trim();
        return tail ? `${sheetRef}!${tail}` : sheetRef;
    }

    if (isA1CoordinateRange(trimmed)) {
        return `${sheetRef}!${trimmed}`;
    }

    return sheetRef;
}

function shouldUseGidSheetRef(range: string): boolean {
    const sheetRef = extractSheetRef(range);
    if (!sheetRef) return true;
    return isDefaultSheetRef(sheetRef);
}

function buildHeaderRange(range: string): string {
    const sheetRef = extractSheetRef(range);
    return sheetRef ? `${sheetRef}!1:1` : "1:1";
}

function toA1ColumnLabel(index: number): string {
    let n = Math.max(0, Math.floor(index));
    let label = "";
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
}

function normalizeDropdownOption(value: string): string {
    return value.trim().toLowerCase();
}

export class GoogleSheetsService {
    private static async createAuthContext(
        userId: string,
        supabaseClient?: SupabaseClient | null
    ): Promise<{ success: true; context: SheetsAuthContext } | { success: false; error: string }> {
        const supabase = supabaseClient ?? getServiceRoleSupabase();
        if (!supabase) {
            return { success: false, error: "System error: Supabase client unavailable." };
        }

        const { data: integration, error } = await supabase
            .from("integrations")
            .select("*")
            .eq("user_id", userId)
            .eq("provider", "google_drive")
            .single();

        if (error || !integration) {
            return { success: false, error: "Google Drive is not securely connected for this user." };
        }

        const integrationRecord = integration as { id?: string; credentials?: unknown };
        if (!integrationRecord.id) {
            return { success: false, error: "Google integration is invalid. Please reconnect the drive." };
        }

        const credentials = parseCredentials(integrationRecord.credentials);
        let accessToken = credentials.access_token;
        const refreshToken = credentials.refresh_token;
        const clientId = credentials.client_id;
        const clientSecret = credentials.client_secret;

        if (!accessToken) {
            return { success: false, error: "Google credentials are incomplete. Please reconnect the drive." };
        }

        const tokenIsStale = !!credentials.expires_at && Date.now() >= credentials.expires_at - 60_000;
        if (tokenIsStale && refreshToken && clientId && clientSecret) {
            const refreshResult = await this.refreshAccessToken(refreshToken, clientId, clientSecret);
            if (!refreshResult.success) {
                return { success: false, error: refreshResult.error };
            }

            accessToken = refreshResult.accessToken;
            const updatedCredentials: IntegrationCredentials = {
                ...credentials,
                access_token: accessToken,
                ...(refreshResult.refreshToken ? { refresh_token: refreshResult.refreshToken } : {}),
                ...(refreshResult.expiresAt ? { expires_at: refreshResult.expiresAt } : {}),
            };
            await supabase
                .from("integrations")
                .update({
                    credentials: updatedCredentials,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", integrationRecord.id);
        }

        return {
            success: true,
            context: {
                supabase,
                integrationId: integrationRecord.id,
                credentials,
                accessToken,
                refreshToken,
                clientId,
                clientSecret,
            },
        };
    }

    private static async refreshAccessToken(
        refreshToken: string,
        clientId: string,
        clientSecret: string
    ): Promise<
        | { success: true; accessToken: string; refreshToken?: string; expiresAt?: number }
        | { success: false; error: string }
    > {
        try {
            const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: refreshToken,
                    grant_type: "refresh_token",
                }),
            });

            if (!tokenResp.ok) {
                return { success: false, error: "Google Auth expired and could not be refreshed. Please reconnect." };
            }

            const tokenData = await tokenResp.json() as Record<string, unknown>;
            const accessToken = typeof tokenData.access_token === "string" ? tokenData.access_token : undefined;
            if (!accessToken) {
                return { success: false, error: "Google OAuth token response was invalid." };
            }

            const nextRefreshToken = typeof tokenData.refresh_token === "string" && tokenData.refresh_token
                ? tokenData.refresh_token
                : undefined;
            const expiresAt = typeof tokenData.expires_in === "number"
                ? Date.now() + tokenData.expires_in * 1000
                : undefined;

            return { success: true, accessToken, refreshToken: nextRefreshToken, expiresAt };
        } catch (error) {
            logger.error("Failed to refresh Google OAuth token", { error });
            return { success: false, error: "Failed to communicate with Google Auth server." };
        }
    }

    private static async requestWithRetry(
        context: SheetsAuthContext,
        request: (token: string) => Promise<Response>
    ): Promise<{ response?: Response; error?: string }> {
        try {
            let response = await request(context.accessToken);

            if (response.status !== 401) {
                return { response };
            }

            if (!context.refreshToken || !context.clientId || !context.clientSecret) {
                return { response };
            }

            const refreshResult = await this.refreshAccessToken(context.refreshToken, context.clientId, context.clientSecret);
            if (!refreshResult.success) {
                return { error: refreshResult.error };
            }

            context.accessToken = refreshResult.accessToken;
            context.credentials = {
                ...context.credentials,
                access_token: refreshResult.accessToken,
                ...(refreshResult.refreshToken ? { refresh_token: refreshResult.refreshToken } : {}),
                ...(refreshResult.expiresAt ? { expires_at: refreshResult.expiresAt } : {}),
            };

            await context.supabase
                .from("integrations")
                .update({
                    credentials: context.credentials,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", context.integrationId);

            response = await request(context.accessToken);
            return { response };
        } catch (error) {
            logger.error("Google Sheets API request failed", { error });
            return { error: "Failed to communicate with Google Sheets API." };
        }
    }

    private static normalizeHelpUrl(value: unknown): string | undefined {
        if (typeof value !== "string" || value.trim().length === 0) {
            return undefined;
        }
        const candidate = value.trim();
        try {
            const parsed = new URL(candidate);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return undefined;
            }
            return parsed.toString();
        } catch {
            return undefined;
        }
    }

    private static extractReason(details: ParsedGoogleErrorDetail[]): string | undefined {
        for (const item of details) {
            if (typeof item.reason === "string" && item.reason.trim().length > 0) {
                return item.reason.trim();
            }
        }
        return undefined;
    }

    private static extractActivationUrl(details: ParsedGoogleErrorDetail[]): string | undefined {
        for (const item of details) {
            const metadataUrl = this.normalizeHelpUrl(item.metadata?.activationUrl);
            if (metadataUrl) {
                return metadataUrl;
            }

            const links = Array.isArray(item.links) ? item.links : [];
            for (const link of links) {
                const helpUrl = this.normalizeHelpUrl(link.url);
                if (helpUrl) {
                    return helpUrl;
                }
            }
        }

        return undefined;
    }

    private static buildRemediation(reason?: string, activationUrl?: string, message?: string): GoogleSheetsRemediation | undefined {
        const normalizedMessage = typeof message === "string" ? message.toLowerCase() : "";

        if (reason === "SERVICE_DISABLED") {
            const links: GoogleSheetsHelpLink[] = [];
            if (activationUrl) {
                links.push({ label: "Enable Google Sheets API", url: activationUrl });
            }
            return {
                provider: "google_sheets",
                code: reason,
                title: "Google Sheets API is disabled for your project.",
                summary: "Enable the Google Sheets API in Google Cloud, wait a few minutes, then retry the ingestion.",
                steps: [
                    activationUrl ? "Open the enable-API link and click Enable." : "Open Google Cloud Console and enable the Google Sheets API.",
                    "Wait 1-5 minutes for Google API activation to propagate.",
                    "Retry the ingestion in Folio.",
                ],
                ...(links.length > 0 ? { links } : {}),
            };
        }

        if (
            (reason === "PERMISSION_DENIED" || reason === "FAILED_PRECONDITION") &&
            /(protected|cannot edit|not have permission|insufficient permissions|permission)/.test(normalizedMessage)
        ) {
            return {
                provider: "google_sheets",
                code: reason,
                title: "Google Sheets write access is blocked for this tab or range.",
                summary: "The connected account can read the sheet but cannot write to the target cells.",
                steps: [
                    "Share the sheet with the connected Google account as Editor.",
                    "If the tab/range is protected, allow this account to edit it or remove protection.",
                    "Retry the ingestion after permissions update.",
                ],
            };
        }

        if (reason === "PERMISSION_DENIED" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
            return {
                provider: "google_sheets",
                code: reason,
                title: "Google Sheets access is not permitted.",
                summary: "The connected Google account cannot append to this sheet yet.",
                steps: [
                    "Share the target Google Sheet with the connected Google account as Editor.",
                    "If permissions were just changed, retry the ingestion.",
                    "If it still fails, reconnect Google Drive/Sheets integration to refresh scopes.",
                ],
            };
        }

        if (
            reason === "INVALID_ARGUMENT" &&
            /(data validation|must be one of|invalid value at 'data\.values|dropdown)/.test(normalizedMessage)
        ) {
            return {
                provider: "google_sheets",
                code: reason,
                title: "Google Sheets rejected one or more values due to dropdown validation.",
                summary: "A strict dropdown column received a value outside the allowed list.",
                steps: [
                    "Open the sheet and check the dropdown options for the target tab.",
                    "Update policy extraction/mapping so values match allowed dropdown choices exactly.",
                    "If the dropdown is meant for humans only, leave that column unmapped so Folio appends blank and a human can select it.",
                ],
            };
        }

        if (reason === "INVALID_ARGUMENT" && /unable to parse range/i.test(normalizedMessage)) {
            return {
                provider: "google_sheets",
                code: reason,
                title: "Google Sheets range is invalid for this spreadsheet tab.",
                summary: "The configured range points to a tab name that does not exist.",
                steps: [
                    "Set range to the exact tab name (for example: 'Receipts' or 'Receipts!A:Z').",
                    "If your spreadsheet URL includes #gid=..., you can omit range and Folio will resolve the tab automatically.",
                    "Retry the ingestion after updating the policy.",
                ],
            };
        }

        return undefined;
    }

    private static async parseApiError(
        response: Response,
        fallbackPrefix: string
    ): Promise<{ message: string; errorDetails: GoogleSheetsErrorDetails }> {
        const errorBody = await response.text();
        logger.error("Google Sheets API rejected request", { status: response.status, body: errorBody });

        const errorDetails: GoogleSheetsErrorDetails = {
            provider: "google_sheets",
            httpStatus: response.status,
        };

        let errorMessage = `${fallbackPrefix}: HTTP ${response.status}.`;

        try {
            const parsedError = JSON.parse(errorBody) as ParsedGoogleErrorResponse;
            const apiError = parsedError.error;

            if (apiError?.code !== undefined) {
                errorDetails.googleCode = apiError.code;
            }

            if (typeof apiError?.status === "string" && apiError.status.trim().length > 0) {
                errorDetails.googleStatus = apiError.status.trim();
            }

            const details = Array.isArray(apiError?.details) ? apiError.details : [];
            const reason = this.extractReason(details);
            const activationUrl = this.extractActivationUrl(details);

            if (reason) {
                errorDetails.reason = reason;
            }
            if (activationUrl) {
                errorDetails.activationUrl = activationUrl;
            }

            const apiMessage = apiError?.message;
            if (typeof apiMessage === "string" && apiMessage.trim().length > 0) {
                errorMessage = `Google Sheets Error: ${apiMessage}`;
            }

            const remediation = this.buildRemediation(reason ?? apiError?.status, activationUrl, apiMessage);
            if (remediation) {
                errorDetails.remediation = remediation;
            }
        } catch {
            // Non-JSON error body; keep fallback error message.
        }

        return { message: errorMessage, errorDetails };
    }

    private static async resolveSheetRangeFromGid(
        context: SheetsAuthContext,
        spreadsheetId: string,
        gid: number
    ): Promise<string | null> {
        const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`;
        const requestResult = await this.requestWithRetry(context, (token) =>
            fetch(endpoint, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
        );

        if (requestResult.error || !requestResult.response) {
            logger.warn("Failed to resolve Google Sheet gid", { error: requestResult.error, spreadsheetId, gid });
            return null;
        }

        if (!requestResult.response.ok) {
            logger.warn("Google Sheets metadata request failed", { status: requestResult.response.status, spreadsheetId, gid });
            return null;
        }

        const payload = await requestResult.response.json() as {
            sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
        };
        const matchedSheet = payload.sheets?.find((sheet) => sheet.properties?.sheetId === gid);
        const title = matchedSheet?.properties?.title;
        if (!title) return null;

        return toSheetRef(title);
    }

    private static extractDropdownValidation(rule?: GoogleDataValidationRule): {
        strict: boolean;
        allowedValues: string[];
        rangeRef?: string;
    } | null {
        if (!rule?.condition?.type) return null;

        const conditionType = rule.condition.type.trim().toUpperCase();
        if (conditionType !== "ONE_OF_LIST" && conditionType !== "ONE_OF_RANGE") {
            return null;
        }

        const conditionValues = Array.isArray(rule.condition.values) ? rule.condition.values : [];
        const strict = rule.strict === true;

        if (conditionType === "ONE_OF_LIST") {
            const allowedValues = conditionValues
                .map((entry) => (typeof entry.userEnteredValue === "string" ? entry.userEnteredValue.trim() : ""))
                .filter((entry) => entry.length > 0);
            return { strict, allowedValues };
        }

        const rawRange = conditionValues
            .map((entry) => (typeof entry.userEnteredValue === "string" ? entry.userEnteredValue.trim() : ""))
            .find(Boolean);
        if (!rawRange) {
            return { strict, allowedValues: [] };
        }

        const rangeRef = rawRange.startsWith("=") ? rawRange.slice(1).trim() : rawRange;
        return { strict, allowedValues: [], rangeRef };
    }

    private static async readDropdownOptionsFromRange(
        context: SheetsAuthContext,
        spreadsheetId: string,
        rangeRef: string
    ): Promise<string[]> {
        const normalizedRange = rangeRef.trim();
        if (!normalizedRange) return [];

        const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(normalizedRange)}?majorDimension=ROWS`;
        const requestResult = await this.requestWithRetry(context, (token) =>
            fetch(endpoint, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
        );

        if (requestResult.error || !requestResult.response) {
            logger.warn("Failed to resolve Google Sheets dropdown options from range", {
                spreadsheetId,
                rangeRef: normalizedRange,
                error: requestResult.error,
            });
            return [];
        }

        if (!requestResult.response.ok) {
            logger.warn("Google Sheets dropdown options range request failed", {
                spreadsheetId,
                rangeRef: normalizedRange,
                status: requestResult.response.status,
            });
            return [];
        }

        const payload = await requestResult.response.json() as { values?: unknown[][] };
        const rows = Array.isArray(payload.values) ? payload.values : [];
        const seen = new Set<string>();
        const options: string[] = [];

        for (const row of rows) {
            if (!Array.isArray(row)) continue;
            for (const cell of row) {
                const value = String(cell ?? "").trim();
                if (!value) continue;
                const key = normalizeDropdownOption(value);
                if (seen.has(key)) continue;
                seen.add(key);
                options.push(value);
            }
        }

        return options;
    }

    private static async resolveHeaderDropdowns(
        context: SheetsAuthContext,
        spreadsheetId: string,
        range: string,
        headerCount: number
    ): Promise<Array<TemplateHeaderDropdown | null>> {
        if (headerCount <= 0) return [];

        const sheetRef = extractSheetRef(range);
        if (!sheetRef) return new Array(headerCount).fill(null);

        const lastColumn = toA1ColumnLabel(headerCount - 1);
        const gridRange = `${sheetRef}!A1:${lastColumn}2`;
        const endpoint =
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
            `?includeGridData=true&ranges=${encodeURIComponent(gridRange)}` +
            "&fields=sheets(data(rowData(values(dataValidation))))";

        const requestResult = await this.requestWithRetry(context, (token) =>
            fetch(endpoint, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
        );

        if (requestResult.error || !requestResult.response) {
            logger.warn("Failed to read Google Sheets dropdown validations", {
                spreadsheetId,
                range: gridRange,
                error: requestResult.error,
            });
            return new Array(headerCount).fill(null);
        }

        if (!requestResult.response.ok) {
            logger.warn("Google Sheets dropdown validation metadata request failed", {
                spreadsheetId,
                range: gridRange,
                status: requestResult.response.status,
            });
            return new Array(headerCount).fill(null);
        }

        const payload = await requestResult.response.json() as {
            sheets?: Array<{
                data?: Array<{
                    rowData?: Array<{
                        values?: GoogleCellData[];
                    }>;
                }>;
            }>;
        };

        const rowData = payload.sheets?.[0]?.data?.[0]?.rowData ?? [];
        const headerRow = Array.isArray(rowData?.[0]?.values) ? rowData[0].values : [];
        const exampleDataRow = Array.isArray(rowData?.[1]?.values) ? rowData[1].values : [];

        const dropdowns: Array<TemplateHeaderDropdown | null> = new Array(headerCount).fill(null);
        const pendingRangeLookups = new Map<number, { strict: boolean; rangeRef: string }>();
        const rangeCache = new Map<string, string[]>();

        for (let i = 0; i < headerCount; i += 1) {
            const rule =
                exampleDataRow[i]?.dataValidation ??
                headerRow[i]?.dataValidation;
            const dropdown = this.extractDropdownValidation(rule);
            if (!dropdown) continue;

            if (dropdown.allowedValues.length > 0) {
                dropdowns[i] = {
                    strict: dropdown.strict,
                    allowedValues: dropdown.allowedValues,
                };
                continue;
            }

            if (dropdown.rangeRef) {
                pendingRangeLookups.set(i, {
                    strict: dropdown.strict,
                    rangeRef: dropdown.rangeRef,
                });
            }
        }

        for (const [columnIndex, pending] of pendingRangeLookups.entries()) {
            if (!rangeCache.has(pending.rangeRef)) {
                const options = await this.readDropdownOptionsFromRange(context, spreadsheetId, pending.rangeRef);
                rangeCache.set(pending.rangeRef, options);
            }
            const allowedValues = rangeCache.get(pending.rangeRef) ?? [];
            if (allowedValues.length > 0) {
                dropdowns[columnIndex] = {
                    strict: pending.strict,
                    allowedValues,
                };
            }
        }

        return dropdowns;
    }

    private static async resolveSheetTarget(
        context: SheetsAuthContext,
        spreadsheetReference: string,
        preferredRange?: string
    ): Promise<{ success: true; spreadsheetId: string; range: string } | { success: false; error: string }> {
        const parsed = parseSpreadsheetReference(spreadsheetReference);
        if (!parsed) {
            return { success: false, error: "Invalid Google Sheet reference. Provide a spreadsheet ID or full URL." };
        }

        let range = preferredRange?.trim();
        if (parsed.gid !== undefined) {
            const gidSheetRef = await this.resolveSheetRangeFromGid(context, parsed.spreadsheetId, parsed.gid);
            if (gidSheetRef) {
                if (!range) {
                    range = gidSheetRef;
                } else if (shouldUseGidSheetRef(range)) {
                    const originalRange = range;
                    range = applySheetRefToRange(range, gidSheetRef);
                    logger.info("Adjusted Google Sheets range using gid-resolved tab", {
                        spreadsheetId: parsed.spreadsheetId,
                        gid: parsed.gid,
                        originalRange,
                        resolvedRange: range,
                    });
                }
            } else if (!range) {
                return {
                    success: false,
                    error: "Could not resolve sheet tab from URL gid. Provide an explicit range like 'Sheet1!A:Z'.",
                };
            }
        }

        return {
            success: true,
            spreadsheetId: parsed.spreadsheetId,
            range: range || "Sheet1",
        };
    }

    static async resolveTemplate(
        userId: string,
        spreadsheetReference: string,
        preferredRange?: string,
        supabaseClient?: SupabaseClient | null
    ): Promise<ResolveTemplateResult> {
        logger.info(`Resolving Google Sheet template for user ${userId}`);

        const authResult = await this.createAuthContext(userId, supabaseClient);
        if (!authResult.success) {
            return { success: false, error: authResult.error };
        }

        const targetResult = await this.resolveSheetTarget(authResult.context, spreadsheetReference, preferredRange);
        if (!targetResult.success) {
            return { success: false, error: targetResult.error };
        }

        const parsedReference = parseSpreadsheetReference(spreadsheetReference);
        const requestHeaders = async (rangeToRead: string) => {
            const headerRange = buildHeaderRange(rangeToRead);
            const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(targetResult.spreadsheetId)}/values/${encodeURIComponent(headerRange)}?majorDimension=ROWS`;
            return this.requestWithRetry(authResult.context, (token) =>
                fetch(endpoint, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                })
            );
        };

        let resolvedRange = targetResult.range;
        const requestResult = await requestHeaders(resolvedRange);

        if (requestResult.error || !requestResult.response) {
            return { success: false, error: requestResult.error ?? "Failed to read Google Sheet template." };
        }

        if (!requestResult.response.ok) {
            const parsedError = await this.parseApiError(requestResult.response, "Template read failed");
            const isRangeParseError =
                parsedError.errorDetails.googleStatus === "INVALID_ARGUMENT" &&
                /unable to parse range/i.test(parsedError.message);

            if (parsedReference?.gid !== undefined && isRangeParseError) {
                const gidSheetRef = await this.resolveSheetRangeFromGid(
                    authResult.context,
                    targetResult.spreadsheetId,
                    parsedReference.gid
                );

                if (gidSheetRef) {
                    const fallbackRange = applySheetRefToRange(targetResult.range, gidSheetRef);
                    if (fallbackRange !== targetResult.range) {
                        logger.warn("Retrying Google Sheet template read with gid-resolved range", {
                            spreadsheetId: targetResult.spreadsheetId,
                            originalRange: targetResult.range,
                            fallbackRange,
                        });

                        const fallbackRequestResult = await requestHeaders(fallbackRange);
                        if (fallbackRequestResult.response?.ok) {
                            resolvedRange = fallbackRange;
                            const fallbackPayload = await fallbackRequestResult.response.json() as { values?: unknown[][] };
                            const fallbackFirstRow = Array.isArray(fallbackPayload.values?.[0]) ? fallbackPayload.values[0] : [];
                            const fallbackHeaders = fallbackFirstRow.map((cell) => String(cell).trim()).filter(Boolean);
                            if (fallbackHeaders.length === 0) {
                                return {
                                    success: false,
                                    error: "Google Sheet template has no header row. Add column names in row 1.",
                                };
                            }

                            const fallbackHeaderDropdowns = await this.resolveHeaderDropdowns(
                                authResult.context,
                                targetResult.spreadsheetId,
                                resolvedRange,
                                fallbackHeaders.length
                            );

                            return {
                                success: true,
                                spreadsheetId: targetResult.spreadsheetId,
                                range: resolvedRange,
                                headers: fallbackHeaders,
                                headerDropdowns: fallbackHeaderDropdowns,
                            };
                        }
                    }
                }
            }

            return { success: false, error: parsedError.message, errorDetails: parsedError.errorDetails };
        }

        const payload = await requestResult.response.json() as { values?: unknown[][] };
        const firstRow = Array.isArray(payload.values?.[0]) ? payload.values[0] : [];
        const headers = firstRow.map((cell) => String(cell).trim()).filter(Boolean);

        if (headers.length === 0) {
            return {
                success: false,
                error: "Google Sheet template has no header row. Add column names in row 1.",
            };
        }

        const headerDropdowns = await this.resolveHeaderDropdowns(
            authResult.context,
            targetResult.spreadsheetId,
            resolvedRange,
            headers.length
        );

        return {
            success: true,
            spreadsheetId: targetResult.spreadsheetId,
            range: resolvedRange,
            headers,
            headerDropdowns,
        };
    }

    /**
     * Appends a row to a specific Google Sheet using the Sheets API v4.
     * `spreadsheetReference` accepts either a spreadsheet ID or full Google Sheet URL.
     */
    static async appendRow(
        userId: string,
        spreadsheetReference: string,
        range: string | undefined,
        values: string[],
        supabaseClient?: SupabaseClient | null
    ): Promise<AppendResult> {
        logger.info(`Initiating Google Sheets append for user ${userId}`);

        const authResult = await this.createAuthContext(userId, supabaseClient);
        if (!authResult.success) {
            return { success: false, error: authResult.error };
        }

        const parsedReference = parseSpreadsheetReference(spreadsheetReference);
        const targetResult = await this.resolveSheetTarget(authResult.context, spreadsheetReference, range);
        if (!targetResult.success) {
            return { success: false, error: targetResult.error };
        }

        const requestAppend = async (rangeToAppend: string) => {
            const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(targetResult.spreadsheetId)}/values/${encodeURIComponent(rangeToAppend)}:append?valueInputOption=RAW`;
            return this.requestWithRetry(authResult.context, (token) =>
                fetch(endpoint, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        values: [values], // Sheets API expects an array of arrays (rows)
                    }),
                })
            );
        };

        const requestResult = await requestAppend(targetResult.range);

        if (requestResult.error || !requestResult.response) {
            return { success: false, error: requestResult.error ?? "Failed to append to Google Sheet." };
        }

        if (!requestResult.response.ok) {
            const parsedError = await this.parseApiError(requestResult.response, "Append failed");
            const isRangeParseError =
                parsedError.errorDetails.googleStatus === "INVALID_ARGUMENT" &&
                /unable to parse range/i.test(parsedError.message);

            if (parsedReference?.gid !== undefined && isRangeParseError) {
                const gidSheetRef = await this.resolveSheetRangeFromGid(
                    authResult.context,
                    targetResult.spreadsheetId,
                    parsedReference.gid
                );

                if (gidSheetRef) {
                    const fallbackRange = applySheetRefToRange(targetResult.range, gidSheetRef);
                    if (fallbackRange !== targetResult.range) {
                        logger.warn("Retrying Google Sheets append with gid-resolved range", {
                            spreadsheetId: targetResult.spreadsheetId,
                            originalRange: targetResult.range,
                            fallbackRange,
                        });

                        const fallbackRequestResult = await requestAppend(fallbackRange);
                        if (fallbackRequestResult.response?.ok) {
                            logger.info("Google Sheets append succeeded after range fallback", {
                                spreadsheetId: targetResult.spreadsheetId,
                                range: fallbackRange,
                            });
                            return {
                                success: true,
                                spreadsheetId: targetResult.spreadsheetId,
                                range: fallbackRange,
                            };
                        }
                    }
                }
            }

            return { success: false, error: parsedError.message, errorDetails: parsedError.errorDetails };
        }

        logger.info(`Successfully appended row to Google Sheet ${targetResult.spreadsheetId}`);
        return {
            success: true,
            spreadsheetId: targetResult.spreadsheetId,
            range: targetResult.range,
        };
    }
}
