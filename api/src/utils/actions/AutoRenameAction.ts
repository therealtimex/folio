import fs from "node:fs";
import path from "node:path";
import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { resolveFilename } from "./utils.js";
import { Actuator } from "../Actuator.js";
import { getServiceRoleSupabase } from "../../services/supabase.js";
import { createLogger } from "../logger.js";

const logger = createLogger("AutoRenameAction");

export class AutoRenameAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { file, variables, data, userId, ingestionId, supabase } = context;

        const ext = path.extname(file.path);
        const dir = path.dirname(file.path);
        const stem = file.name.slice(0, file.name.length - ext.length);

        logger.info("AutoRename variables", {
            suggested_filename: variables.suggested_filename ?? "(missing)",
            date: variables.date ?? "(missing)",
            issuer: variables.issuer ?? "(missing)",
            document_type: variables.document_type ?? "(missing)",
        });

        const newName = resolveFilename("auto", variables, stem, ext, data);
        const newPath = path.join(dir, newName);

        await new Promise<void>((resolve, reject) => {
            fs.rename(file.path, newPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const trace = [{
            timestamp: new Date().toISOString(),
            step: `Auto-Renamed file to ${newName}`,
            details: { original: file.name, new: newName }
        }];

        logger.info(`AutoRename: '${file.name}' → '${newName}'`);
        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "auto_rename", original: file.name, new: newName }, supabase);

        // Update DB so re-runs don't break
        const db = supabase ?? getServiceRoleSupabase();
        if (db) {
            await db.from("ingestions").update({ storage_path: newPath, filename: newName }).eq("id", ingestionId);
        }

        return {
            success: true,
            newFileState: { path: newPath, name: newName },
            logs: [`Auto-Renamed to '${newName}'`],
            trace
        };
    }
}
