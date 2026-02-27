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
     * Walks a slash-separated sub-path under a root Drive folder, creating any
     * missing folders along the way, and returns the final folder ID.
     *
     * e.g. resolveFolderPath(token, "rootId", ["Utilities", "PGE", "Energy Statements"])
     *      → ID of "Energy Statements" folder (created if absent)
     */
    private static async resolveFolderPath(
        token: string,
        rootFolderId: string,
        subSegments: string[]
    ): Promise<string> {
        let parentId = rootFolderId;

        for (const segment of subSegments) {
            const name = segment.trim();
            if (!name) continue;

            // Search for an existing folder with this name under the current parent.
            const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
            const searchResp = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!searchResp.ok) {
                throw new Error(`Drive folder search failed: HTTP ${searchResp.status}`);
            }

            const { files } = await searchResp.json() as { files?: { id: string }[] };
            if (files && files.length > 0) {
                parentId = files[0].id;
            } else {
                // Folder doesn't exist — create it.
                const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        name,
                        mimeType: "application/vnd.google-apps.folder",
                        parents: [parentId],
                    }),
                });
                if (!createResp.ok) {
                    throw new Error(`Drive folder creation failed for '${name}': HTTP ${createResp.status}`);
                }
                const { id } = await createResp.json() as { id?: string };
                if (!id) throw new Error(`Folder '${name}' was created but Drive returned no ID.`);
                logger.info(`Created Drive folder '${name}' (${id}) under parent ${parentId}`);
                parentId = id;
            }
        }

        return parentId;
    }

    /**
     * Uploads a local file to a user's connected Google Drive.
     * Handles automatic token refreshment if the access_token has expired.
     *
     * `folderPath` can be:
     *   - undefined / empty  → upload to My Drive root
     *   - a bare folder ID   → upload directly into that folder
     *   - "rootId/Sub/Path"  → resolve (and auto-create) the subfolder hierarchy,
     *                          then upload into the deepest folder
     */
    static async uploadFile(
        userId: string,
        localFilePath: string,
        folderId?: string,
        supabaseClient?: SupabaseClient | null,
        fileName?: string
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

        // 2. Proactively refresh the token if it is expired or expires within 60 s.
        // This must happen before any Drive API calls (folder resolution, upload initiation).
        const tokenIsStale = credentials.expires_at && Date.now() >= credentials.expires_at - 60_000;
        if (tokenIsStale && refreshToken && clientId && clientSecret) {
            logger.info("Google Drive token is stale, refreshing before Drive API calls...");
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
                    return { success: false, error: "Google Drive authentication expired and could not be refreshed. Please reconnect the drive." };
                }
                const tokenData = await tokenResp.json();
                if (!tokenData?.access_token) {
                    return { success: false, error: "Google OAuth token response was invalid." };
                }
                accessToken = tokenData.access_token as string;
                const updatedCredentials: IntegrationCredentials = {
                    ...credentials,
                    access_token: accessToken,
                    ...(typeof tokenData.refresh_token === "string" && tokenData.refresh_token
                        ? { refresh_token: tokenData.refresh_token }
                        : {}),
                    ...(typeof tokenData.expires_in === "number"
                        ? { expires_at: Date.now() + tokenData.expires_in * 1000 }
                        : {}),
                };
                await supabase.from("integrations").update({
                    credentials: updatedCredentials,
                    updated_at: new Date().toISOString(),
                }).eq("id", integration.id);
            } catch (refreshErr) {
                logger.error("Proactive token refresh failed", { error: refreshErr });
                return { success: false, error: "Failed to communicate with Google Auth server." };
            }
        }

        // 3. Resolve subfolder path (auto-creates missing folders).
        // folderPath may be "rootId", "rootId/Sub/Folder", or undefined.
        // Drive folder IDs are stable across token refreshes so we resolve once.
        let resolvedFolderId: string | undefined;
        if (folderId && folderId.trim().length > 0) {
            const parts = folderId.trim().split("/");
            const rootId = parts[0];
            const subSegments = parts.slice(1);
            try {
                resolvedFolderId = subSegments.length > 0
                    ? await GoogleDriveService.resolveFolderPath(accessToken, rootId, subSegments)
                    : rootId;
            } catch (pathErr) {
                const msg = pathErr instanceof Error ? pathErr.message : String(pathErr);
                return { success: false, error: `Failed to resolve Drive folder path: ${msg}` };
            }
        }

        // 4. Perform upload (optimistic; catches 401 as a last-resort fallback).
        const performUpload = async (token: string): Promise<Response> => {
            const resolvedFileName = fileName ?? path.basename(localFilePath);
            const mimeType = "application/octet-stream";

            const metadata: Record<string, unknown> = { name: resolvedFileName };
            if (resolvedFolderId) {
                metadata.parents = [resolvedFolderId];
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

        // 5. Handle Token Expiry (last-resort retry if upload still returns 401)
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
