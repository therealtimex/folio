import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { pickString, interpolate } from "./utils.js";
import { Actuator } from "../Actuator.js";
import { createLogger } from "../logger.js";

const logger = createLogger("NotifyAction");

export class NotifyAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { action, variables, data, userId, ingestionId, supabase } = context;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messageTemplate = pickString(action as any, "message");

        if (!messageTemplate) {
            return {
                success: false,
                logs: [],
                trace: [{ timestamp: new Date().toISOString(), step: "Notify failed: missing message" }],
                error: "Notify action requires a 'message' config"
            };
        }

        const msg = interpolate(messageTemplate, variables, data);
        logger.info(`[NOTIFY] ${msg}`);

        const trace = [{
            timestamp: new Date().toISOString(),
            step: "Executed notify action",
            details: { message: msg }
        }];
        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "notify", message: msg }, supabase);

        return {
            success: true,
            logs: [`Notified: ${msg}`],
            trace
        };
    }
}
