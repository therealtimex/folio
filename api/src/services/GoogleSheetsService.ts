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
    return /^[A-Za-z]+\d*(?::[A-Za-z]+\d*)?$/.test(value) || /^\d+(?::\d+)?$/.test(value);
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

function buildHeaderRange(range: string): string {
    const sheetRef = extractSheetRef(range);
    return sheetRef ? `${sheetRef}!1:1` : "1:1";
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

    private static buildRemediation(reason?: string, activationUrl?: string): GoogleSheetsRemediation | undefined {
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

            const message = apiError?.message;
            if (typeof message === "string" && message.trim().length > 0) {
                errorMessage = `Google Sheets Error: ${message}`;
            }

            const remediation = this.buildRemediation(reason ?? apiError?.status, activationUrl);
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
        if (!range && parsed.gid !== undefined) {
            const gidRange = await this.resolveSheetRangeFromGid(context, parsed.spreadsheetId, parsed.gid);
            if (gidRange) {
                range = gidRange;
            } else {
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

        const headerRange = buildHeaderRange(targetResult.range);
        const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(targetResult.spreadsheetId)}/values/${encodeURIComponent(headerRange)}?majorDimension=ROWS`;
        const requestResult = await this.requestWithRetry(authResult.context, (token) =>
            fetch(endpoint, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
        );

        if (requestResult.error || !requestResult.response) {
            return { success: false, error: requestResult.error ?? "Failed to read Google Sheet template." };
        }

        if (!requestResult.response.ok) {
            const parsedError = await this.parseApiError(requestResult.response, "Template read failed");
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

        return {
            success: true,
            spreadsheetId: targetResult.spreadsheetId,
            range: targetResult.range,
            headers,
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

        const targetResult = await this.resolveSheetTarget(authResult.context, spreadsheetReference, range);
        if (!targetResult.success) {
            return { success: false, error: targetResult.error };
        }

        const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(targetResult.spreadsheetId)}/values/${encodeURIComponent(targetResult.range)}:append?valueInputOption=RAW`;
        const requestResult = await this.requestWithRetry(authResult.context, (token) =>
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

        if (requestResult.error || !requestResult.response) {
            return { success: false, error: requestResult.error ?? "Failed to append to Google Sheet." };
        }

        if (!requestResult.response.ok) {
            const parsedError = await this.parseApiError(requestResult.response, "Append failed");
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
