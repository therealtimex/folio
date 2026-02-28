import { ActionHandler, ActionContext, ActionResult } from "./ActionHandler.js";
import { pickString, interpolate } from "./utils.js";
import { Actuator } from "../Actuator.js";

export class WebhookAction implements ActionHandler {
    async execute(context: ActionContext): Promise<ActionResult> {
        const { action, variables, data, userId, ingestionId, supabase } = context;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const webhookUrlTemplate = pickString(action as any, "url");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const webhookPayloadTemplate = pickString(action as any, "payload");

        if (!webhookUrlTemplate || !webhookPayloadTemplate) {
            return {
                success: false,
                logs: [],
                trace: [{ timestamp: new Date().toISOString(), step: "Webhook failed: missing url or payload" }],
                error: "Webhook action requires 'url' and 'payload' configs"
            };
        }

        const url = interpolate(webhookUrlTemplate, variables, data);
        const payloadStr = interpolate(webhookPayloadTemplate, variables, data);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let payload: any;

        try {
            payload = JSON.parse(payloadStr);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            return {
                success: false,
                logs: [],
                trace: [{ timestamp: new Date().toISOString(), step: "Webhook failed: invalid JSON payload" }],
                error: "Webhook payload must be valid JSON"
            };
        }

        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const trace = [{
            timestamp: new Date().toISOString(),
            step: `Webhook payload sent to ${url}`,
            details: { url, payload }
        }];
        Actuator.logEvent(ingestionId, userId, "action", "Action Execution", { action: "webhook", url }, supabase);

        return {
            success: true,
            logs: [`Logged via webhook`],
            trace
        };
    }
}
