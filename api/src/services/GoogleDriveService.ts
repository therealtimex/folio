import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabase } from "./supabase.js";
import { createLogger } from "../utils/logger.js";
import fs from "node:fs";
import path from "node:path";

const logger = createLogger("GoogleDriveService");

type IntegrationCredentials = {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    client_id?: string;
    client_secret?: string;
};

type UploadResult = { success: boolean; fileId?: string; error?: string };

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

export class GoogleDriveService {
    /**
     * Uploads a local file to a user's connected Google Drive.
     * Handles automatic token refreshment if the access_token has expired.
     */
    static async uploadFile(
        userId: string,
        localFilePath: string,
        folderId?: string,
        supabaseClient?: SupabaseClient | null
    ): Promise<UploadResult> {
        logger.info(`Initiating Google Drive upload for user ${userId}: ${localFilePath}`);
        const supabase = supabaseClient ?? getServiceRoleSupabase();
        if (!supabase) {
            return { success: false, error: "System error: Supabase client unavailable." };
        }

        let fileStat: fs.Stats;
        try {
            fileStat = await fs.promises.stat(localFilePath);
            if (!fileStat.isFile()) {
                return { success: false, error: "Source path is not a file." };
            }
        } catch {
            return { success: false, error: "Source file not found." };
        }

        // 1. Fetch Integration
        const { data: integration, error } = await supabase
            .from("integrations")
            .select("*")
            .eq("user_id", userId)
            .eq("provider", "google_drive")
            .single();

        if (error || !integration) {
            return { success: false, error: "Google Drive is not securely connected for this user." };
        }

        const credentials = parseCredentials((integration as { credentials?: unknown }).credentials);

        let accessToken = credentials.access_token;
        const clientId = credentials.client_id;
        const clientSecret = credentials.client_secret;
        const refreshToken = credentials.refresh_token;

        if (!accessToken) {
            return { success: false, error: "Google Drive credentials are incomplete. Please reconnect the drive." };
        }

        // 2. Refresh Token if needed (optimistic upload, catch 401)
        const performUpload = async (token: string): Promise<Response> => {
            const fileName = path.basename(localFilePath);
            const mimeType = "application/octet-stream";

            const metadata: Record<string, unknown> = { name: fileName };
            if (folderId && folderId.trim().length > 0) {
                metadata.parents = [folderId.trim()];
            }

            // Resumable upload avoids buffering/base64 encoding the full file in memory.
            const startResponse = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": mimeType,
                    "X-Upload-Content-Length": String(fileStat.size),
                },
                body: JSON.stringify(metadata),
            });
            if (!startResponse.ok) {
                return startResponse;
            }

            const uploadUrl = startResponse.headers.get("location");
            if (!uploadUrl) {
                throw new Error("Google Drive did not return an upload URL.");
            }

            const contentRange = fileStat.size === 0
                ? `bytes */${fileStat.size}`
                : `bytes 0-${fileStat.size - 1}/${fileStat.size}`;

            // duplex: "half" is required by Node.js fetch when the request body is a stream.
            const uploadRequest: RequestInit & { duplex?: "half" } = {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": mimeType,
                    "Content-Length": String(fileStat.size),
                    "Content-Range": contentRange,
                },
                body: fs.createReadStream(localFilePath) as unknown as BodyInit,
                duplex: "half",
            };

            return fetch(uploadUrl, uploadRequest);
        };

        let response = await performUpload(accessToken);

        // 3. Handle Token Expiry
        if (response.status === 401 && refreshToken && clientId && clientSecret) {
            logger.info("Google Drive token expired, attempting refresh...");
            try {
                const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        refresh_token: refreshToken,
                        grant_type: "refresh_token"
                    })
                });

                if (tokenResp.ok) {
                    const tokenData = await tokenResp.json();
                    if (!tokenData?.access_token) {
                        return { success: false, error: "Google OAuth token response was invalid." };
                    }

                    const refreshedAccessToken = tokenData.access_token as string;
                    accessToken = refreshedAccessToken;

                    const updatedCredentials: IntegrationCredentials = {
                        ...credentials,
                        access_token: accessToken,
                    };
                    if (typeof tokenData.refresh_token === "string" && tokenData.refresh_token) {
                        updatedCredentials.refresh_token = tokenData.refresh_token;
                    }
                    if (typeof tokenData.expires_in === "number") {
                        updatedCredentials.expires_at = Date.now() + tokenData.expires_in * 1000;
                    }

                    // Transparently save refreshed credentials.
                    await supabase.from("integrations").update({
                        credentials: updatedCredentials,
                        updated_at: new Date().toISOString()
                    }).eq("id", integration.id);

                    // Retry Upload
                    logger.info("Retrying Google Drive upload with fresh token...");
                    response = await performUpload(refreshedAccessToken);
                } else {
                    return { success: false, error: "Google Drive authentication expired and could not be refreshed. Please reconnect the drive." };
                }
            } catch (authErr) {
                logger.error("Failed to refresh Google Drive token", { error: authErr });
                return { success: false, error: "Failed to communicate with Google Auth server." };
            }
        }

        if (!response.ok) {
            const errorBody = await response.text();
            logger.error("Google Drive API rejected upload", { status: response.status, body: errorBody });
            return { success: false, error: `Upload failed: HTTP ${response.status}.` };
        }

        const responseData = await response.json() as { id?: string };
        if (!responseData.id) {
            return { success: false, error: "Google Drive upload succeeded but no file ID was returned." };
        }

        logger.info(`Successfully uploaded file to Google Drive: ${responseData.id}`);

        return { success: true, fileId: responseData.id };
    }
}
