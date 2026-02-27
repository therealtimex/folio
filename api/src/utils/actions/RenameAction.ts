import fs from "node:fs";
import path from "node:path";
import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { pickString, interpolate } from "./utils.js";
import { Actuator } from "../Actuator.js";
import { getServiceRoleSupabase } from "../../services/supabase.js";

export class RenameAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { action, file, variables, userId, ingestionId, supabase } = context;
        const pattern = pickString(action as any, "pattern");

        if (!pattern) {
            return {
                success: false,
                logs: [],
                trace: [{ timestamp: new Date().toISOString(), step: "Rename failed: missing pattern" }],
                error: "Rename action requires a 'pattern' config"
            };
        }

        const ext = path.extname(file.path);
        const dir = path.dirname(file.path);
        let newName = interpolate(pattern, variables);
        if (!newName.endsWith(ext)) newName += ext;
        const newPath = path.join(dir, newName);

        await new Promise<void>((resolve, reject) => {
            fs.rename(file.path, newPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const trace = [{
            timestamp: new Date().toISOString(),
            step: `Renamed file to ${newName}`,
            details: { original: file.name, new: newName }
        }];

        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "rename", original: file.name, new: newName }, supabase);

        // Update DB so re-runs don't break
        const db = supabase ?? getServiceRoleSupabase();
        if (db) {
            await db.from("ingestions").update({ storage_path: newPath, filename: newName }).eq("id", ingestionId);
        }

        return {
            success: true,
            newFileState: { path: newPath, name: newName },
            logs: [`Renamed to '${newName}'`],
            trace
        };
    }
}
