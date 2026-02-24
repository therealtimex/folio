import { createLogger } from "../utils/logger.js";
import { SDKService } from "./SDKService.js";
import { PolicyLoader } from "./PolicyLoader.js";
import { Actuator } from "../utils/Actuator.js";
import type { FolioPolicy, MatchCondition, ExtractField } from "./PolicyLoader.js";

const logger = createLogger("PolicyEngine");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocumentObject {
    /** Original file path */
    filePath: string;
    /** Extracted text content */
    text: string;
}

export interface ProcessingResult {
    filePath: string;
    matchedPolicy: string | null;
    extractedData: Record<string, string | number | null>;
    actionsExecuted: string[];
    status: "matched" | "fallback" | "error";
    error?: string;
}

// ─── Matcher ────────────────────────────────────────────────────────────────

async function evaluateCondition(condition: MatchCondition, doc: DocumentObject): Promise<boolean> {
    const sdk = SDKService.getSDK();

    if (condition.type === "keyword") {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value ?? ""];
        const text = condition.case_sensitive ? doc.text : doc.text.toLowerCase();
        return values.some((v) => {
            const needle = condition.case_sensitive ? v : v.toLowerCase();
            return text.includes(needle);
        });
    }

    if (condition.type === "llm_verify") {
        if (!sdk || !condition.prompt) return false;
        try {
            const { provider, model } = await SDKService.getDefaultChatProvider();
            const result = await sdk.llm.chat(
                [
                    {
                        role: "system",
                        content: "You are a document classifier. Answer with a single JSON object: { \"result\": true/false, \"confidence\": 0.0-1.0 }"
                    },
                    {
                        role: "user",
                        content: `Document text:\n\n${doc.text.slice(0, 2000)}\n\nQuestion: ${condition.prompt}`
                    }
                ],
                { provider, model }
            );

            const raw: string = (result as any).content ?? (result as any).choices?.[0]?.message?.content ?? "";
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                const threshold = condition.confidence_threshold ?? 0.8;
                return parsed.result === true && (parsed.confidence ?? 1) >= threshold;
            }
        } catch (err) {
            logger.warn("llm_verify condition failed", { err });
        }
        return false;
    }

    return false;
}

async function matchPolicy(policy: FolioPolicy, doc: DocumentObject): Promise<boolean> {
    const { strategy, conditions } = policy.spec.match;

    if (strategy === "ALL") {
        for (const cond of conditions) {
            if (!(await evaluateCondition(cond, doc))) return false;
        }
        return true;
    }

    // ANY strategy
    for (const cond of conditions) {
        if (await evaluateCondition(cond, doc)) return true;
    }
    return false;
}

// ─── Extractor ───────────────────────────────────────────────────────────────

async function extractData(
    fields: ExtractField[],
    doc: DocumentObject
): Promise<Record<string, string | number | null>> {
    const sdk = SDKService.getSDK();
    if (!sdk || fields.length === 0) return {};

    const { provider, model } = await SDKService.getDefaultChatProvider();
    const fieldDescriptions = fields
        .map((f) => `- "${f.key}" (${f.type}): ${f.description}${f.required ? " [REQUIRED]" : ""}`)
        .join("\n");

    const prompt = `Extract the following fields from the document text. Return ONLY a valid JSON object with the field keys and their extracted values. Use null for fields that cannot be found.

Fields to extract:
${fieldDescriptions}

Document text:
${doc.text.slice(0, 3000)}`;

    try {
        const result = await sdk.llm.chat(
            [
                { role: "system", content: "You are a precise data extraction engine. Return only valid JSON." },
                { role: "user", content: prompt }
            ],
            { provider, model }
        );

        const raw: string = (result as any).response?.content ?? (result as any).content ?? (result as any).choices?.[0]?.message?.content ?? "";
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
            return JSON.parse(match[0]);
        }
    } catch (err) {
        logger.error("Data extraction failed", { err });
    }

    return {};
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class PolicyEngine {
    /**
     * Run a document through the policy pipeline.
     * Returns the first matched policy result, or the fallback.
     */
    static async process(doc: DocumentObject): Promise<ProcessingResult> {
        logger.info(`Processing document: ${doc.filePath}`);
        const policies = await PolicyLoader.load();

        for (const policy of policies) {
            try {
                const matched = await matchPolicy(policy, doc);
                if (!matched) continue;

                logger.info(`Matched policy: ${policy.metadata.id} (priority: ${policy.metadata.priority})`);

                // Extract data
                const extractedData = await extractData(policy.spec.extract ?? [], doc);

                // Validate required fields
                const missingRequired = (policy.spec.extract ?? [])
                    .filter((f) => f.required && (extractedData[f.key] == null))
                    .map((f) => f.key);

                if (missingRequired.length > 0) {
                    logger.warn(`Missing required fields: ${missingRequired.join(", ")} — routing to Human Review`);
                    return {
                        filePath: doc.filePath,
                        matchedPolicy: policy.metadata.id,
                        extractedData,
                        actionsExecuted: [],
                        status: "error",
                        error: `Missing required fields: ${missingRequired.join(", ")}`
                    };
                }

                // Execute actions
                const actuatorResult = await Actuator.execute(
                    doc.filePath,
                    policy.spec.actions ?? [],
                    extractedData,
                    policy.spec.extract ?? []
                );

                return {
                    filePath: actuatorResult.actionsExecuted.find((a) => a.startsWith("Moved") || a.startsWith("Renamed"))
                        ? doc.filePath
                        : doc.filePath,
                    matchedPolicy: policy.metadata.id,
                    extractedData,
                    actionsExecuted: actuatorResult.actionsExecuted,
                    status: "matched",
                    error: actuatorResult.errors[0]
                };
            } catch (err) {
                logger.error(`Error evaluating policy ${policy.metadata.id}`, { err });
            }
        }

        // Fallback: Inbox Zero
        logger.info(`No policy matched — routing to fallback`);
        return {
            filePath: doc.filePath,
            matchedPolicy: null,
            extractedData: {},
            actionsExecuted: ["Moved to /_Needs_Review"],
            status: "fallback"
        };
    }

    /**
     * Synthesize a FolioPolicy from a natural language description using the LLM.
     */
    static async synthesizeFromNL(
        description: string,
        opts: { provider?: string; model?: string } = {}
    ): Promise<{ policy: FolioPolicy | null; raw?: string; error?: string }> {
        const sdk = SDKService.getSDK();
        if (!sdk) {
            const msg = "SDK not available for policy synthesis";
            logger.warn(msg);
            return { policy: null, error: msg };
        }

        // Use explicitly provided provider/model, else fall back to SDK defaults
        const defaults = await SDKService.getDefaultChatProvider();
        const provider = opts.provider || defaults.provider;
        const model = opts.model || defaults.model;
        logger.info(`Synthesizing policy via ${provider}/${model}`);

        const systemPrompt = `You are a Folio Policy Engine expert. Convert natural language descriptions into a valid FolioPolicy JSON object.

Return ONLY a valid JSON object with this exact shape (no markdown, no backticks):
{
  "apiVersion": "folio/v1",
  "kind": "Policy",
  "metadata": { "id": "kebab-case-id", "name": "Human Name", "version": "1.0.0", "description": "Brief description", "priority": 100, "tags": ["tag1"], "enabled": true },
  "spec": {
    "match": { "strategy": "ALL", "conditions": [{ "type": "keyword", "value": ["keyword1", "keyword2"], "case_sensitive": false }] },
    "extract": [{ "key": "field_name", "type": "string", "description": "what to extract", "required": true }],
    "actions": [{ "type": "move", "destination": "/path/to/folder" }]
  }
}`;

        try {
            const result = await sdk.llm.chat(
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Create a policy for: ${description}` }
                ],
                { provider, model }
            );

            // Log the entire result to discover the SDK response schema
            logger.info(`Full SDK result keys: ${Object.keys(result as any).join(", ")}`);
            logger.info(`Full SDK result: ${JSON.stringify(result).slice(0, 1000)}`);

            // SDK response shape: { success: true, response: { content: "..." } }
            const raw: string =
                (result as any).response?.content ??
                (result as any).content ??
                (result as any).message?.content ??
                (result as any).choices?.[0]?.message?.content ??
                (result as any).text ??
                (result as any).result ??
                (result as any).output ??
                "";

            logger.info(`Synthesis raw response (first 500 chars): ${raw.slice(0, 500)}`);

            if (!raw) {
                return { policy: null, error: "LLM returned empty response", raw };
            }

            // Extract JSON block — handle both raw JSON and markdown code blocks
            const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
            const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : raw.trim();

            let parsed: FolioPolicy;
            try {
                parsed = JSON.parse(jsonStr);
            } catch (parseErr) {
                logger.error("JSON parse failed", { raw: jsonStr.slice(0, 300), parseErr });
                return { policy: null, error: "LLM response was not valid JSON", raw };
            }

            if (PolicyLoader.validate(parsed)) {
                return { policy: parsed };
            }

            // Return as draft even if validation fails — let the UI show a preview
            logger.warn("Synthesized policy failed strict validation, returning as draft");
            return { policy: parsed, error: "Policy schema may be incomplete — please review before saving" };

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("Policy synthesis failed", { err });
            return { policy: null, error: msg };
        }
    }
}
