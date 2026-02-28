import path from "node:path";
import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { pickString, interpolate, resolveFilename } from "./utils.js";
import { Actuator } from "../Actuator.js";
import { GoogleDriveService } from "../../services/GoogleDriveService.js";

export class CopyToGDriveAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { action, file, variables, data, userId, ingestionId, supabase } = context;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const destination = pickString(action as any, "destination");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filenameConfig = pickString(action as any, "filename");

        const destDirId = destination ? interpolate(destination, variables, data) : undefined;

        let resolvedFileName: string | undefined;
        if (filenameConfig) {
            const ext = path.extname(file.name);
            const stem = file.name.slice(0, file.name.length - ext.length);
            resolvedFileName = resolveFilename(filenameConfig, variables, stem, ext, data);
        }

        const uploadResult = await GoogleDriveService.uploadFile(userId, file.path, destDirId, supabase, resolvedFileName);

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
            step: `Copied file to Google Drive`,
            details: { original: file.path, driveFileId: uploadResult.fileId, destinationFolderId: destDirId }
        }];
        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "copy_to_gdrive", destinationFolderId: destDirId ?? null, fileId: uploadResult.fileId }, supabase);

        const fileId = uploadResult.fileId as string;
        const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;
        const outputs: Record<string, unknown> = {
            provider: "google_drive",
            file_id: fileId,
            file_url: fileUrl,
            drive_file_id: fileId,
            drive_file_url: fileUrl,
            destination_folder_id: destDirId ?? null,
            uploaded_file_name: resolvedFileName ?? file.name,
        };
        if (/\.(jpg|jpeg|png|webp|gif|bmp|tiff|tif|heic)$/i.test(file.name)) {
            outputs.image_link = fileUrl;
        }

        return {
            success: true,
            logs: [`Copied to Google Drive (ID: ${uploadResult.fileId})`],
            trace,
            outputs,
        };
    }
}
