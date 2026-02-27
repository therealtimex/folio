import fs from "node:fs";
import path from "node:path";
import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { pickString, interpolate, resolveFilename } from "./utils.js";
import { Actuator } from "../Actuator.js";
import { GoogleDriveService } from "../../services/GoogleDriveService.js";

export class CopyAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { action, file, variables, userId, ingestionId, supabase } = context;
        const destination = pickString(action as any, "destination");
        const pattern = pickString(action as any, "pattern");
        const filenameConfig = pickString(action as any, "filename");

        if (!destination) {
            return {
                success: false,
                logs: [],
                trace: [{ timestamp: new Date().toISOString(), step: "Copy failed: missing destination" }],
                error: "Copy action requires a 'destination' config"
            };
        }

        const destDir = interpolate(destination, variables);

        // Support legacy gdrive:// destinations before copy_to_gdrive existed.
        if (destDir.startsWith("gdrive://")) {
            const folderPath = destDir.slice("gdrive://".length) || undefined;
            let gdriveFileName: string | undefined;
            if (filenameConfig) {
                const ext = path.extname(file.name);
                const stem = file.name.slice(0, file.name.length - ext.length);
                gdriveFileName = resolveFilename(filenameConfig, variables, stem, ext);
            }
            const uploadResult = await GoogleDriveService.uploadFile(userId, file.path, folderPath, supabase, gdriveFileName);
            if (!uploadResult.success) {
                return {
                    success: false,
                    logs: [],
                    trace: [{ timestamp: new Date().toISOString(), step: "Copy to Google Drive failed", details: { error: uploadResult.error } }],
                    error: uploadResult.error || "Failed to upload to Google Drive"
                };
            }

            const trace = [{
                timestamp: new Date().toISOString(),
                step: "Copied file to Google Drive",
                details: { original: file.path, driveFileId: uploadResult.fileId, destinationFolderId: folderPath }
            }];
            Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "copy_to_gdrive", destinationFolderId: folderPath ?? null, fileId: uploadResult.fileId }, supabase);

            return {
                success: true,
                logs: [`Copied to Google Drive (ID: ${uploadResult.fileId})`],
                trace
            };
        }

        fs.mkdirSync(destDir, { recursive: true });

        const ext = path.extname(file.name);
        const stem = file.name.slice(0, file.name.length - ext.length);
        let newName: string;
        if (filenameConfig) {
            newName = resolveFilename(filenameConfig, variables, stem, ext);
        } else if (pattern) {
            // Backward-compat: treat pattern as a filename template
            newName = interpolate(pattern, variables);
            if (!newName.endsWith(ext)) newName += ext;
        } else {
            newName = file.name;
        }

        const newPath = path.join(destDir, newName);
        await new Promise<void>((resolve, reject) => {
            fs.copyFile(file.path, newPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const trace = [{
            timestamp: new Date().toISOString(),
            step: `Copied file to ${newPath}`,
            details: { original: file.path, copy: newPath }
        }];
        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "copy", destination: destDir, newName }, supabase);

        return {
            success: true,
            logs: [`Copied to '${newPath}'`],
            trace
        };
    }
}
