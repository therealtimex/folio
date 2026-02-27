import fs from "node:fs";
import path from "node:path";
import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { pickString, pickColumns, interpolate } from "./utils.js";
import { Actuator } from "../Actuator.js";

export class LogCsvAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { action, variables, data, userId, ingestionId, supabase } = context;
        const csvPathTemplate = pickString(action as any, "path");

        if (!csvPathTemplate) {
            return {
                success: false,
                logs: [],
                trace: [{ timestamp: new Date().toISOString(), step: "Log CSV failed: missing path" }],
                error: "Log CSV action requires a 'path' config"
            };
        }

        const csvPath = interpolate(csvPathTemplate, variables);
        const cols = pickColumns(action as any, Object.keys(data));
        const row = cols.map((c) => variables[c] ?? "").join(",") + "\n";
        const header = cols.join(",") + "\n";

        if (!fs.existsSync(csvPath)) {
            fs.mkdirSync(path.dirname(csvPath), { recursive: true });
            fs.writeFileSync(csvPath, header + row, "utf-8");
        } else {
            fs.appendFileSync(csvPath, row, "utf-8");
        }

        const trace = [{
            timestamp: new Date().toISOString(),
            step: "Executed log_csv action",
            details: { csvPath, cols }
        }];
        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "log_csv", csvPath, cols }, supabase);

        return {
            success: true,
            logs: [`Logged CSV → ${csvPath}`],
            trace
        };
    }
}
