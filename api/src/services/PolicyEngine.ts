import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";
import { SDKService } from "./SDKService.js";
import { PolicyLoader } from "./PolicyLoader.js";
import { Actuator } from "../utils/Actuator.js";
import type { FolioPolicy, MatchCondition, ExtractField } from "./PolicyLoader.js";
import { DEFAULT_BASELINE_FIELDS } from "./BaselineConfigService.js";
import type { BaselineField } from "./BaselineConfigService.js";

const logger = createLogger("PolicyEngine");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocumentObject {
    /** Original file path */
    filePath: string;
    /** Extracted text content */
    text: string;
    /** ID of the ingestion record */
    ingestionId: string;
    /** ID of the user */
    userId: string;
    /** Authenticated Supabase client used for RLS-safe event writes */
    supabase?: SupabaseClient;
}

export interface TraceLog {
    timestamp: string;
    step: string;
    details?: any;
}

export interface ProcessingResult {
    filePath: string;
    matchedPolicy: string | null;
    extractedData: Record<string, string | number | null>;
    actionsExecuted: string[];
    status: "matched" | "fallback" | "error";
    error?: string;
    trace: TraceLog[];
}

// ─── Matcher ────────────────────────────────────────────────────────────────

async function evaluateCondition(condition: MatchCondition, doc: DocumentObject, trace: TraceLog[], settings: { llm_provider?: string; llm_model?: string } = {}): Promise<boolean> {
    const sdk = SDKService.getSDK();

    if (condition.type === "keyword") {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value ?? ""];
        const text = condition.case_sensitive ? doc.text : doc.text.toLowerCase();
        return values.some((v) => {
            const needle = condition.case_sensitive ? v : v.toLowerCase();
            return text.includes(needle);
        });
    }

    if (condition.type === "filename") {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value ?? ""];
        const name = condition.case_sensitive ? doc.filePath : doc.filePath.toLowerCase();
        return values.some((v) => {
            const needle = condition.case_sensitive ? v : v.toLowerCase();
            return name.includes(needle);
        });
    }

    if (condition.type === "file_type" || condition.type === "mime_type") {
        const ext = doc.filePath.split(".").pop()?.toLowerCase() ?? "";
        // MIME subtype → extension exceptions where they differ
        const MIME_TO_EXT: Record<string, string> = { plain: "txt", markdown: "md", "x-markdown": "md" };
        const values = Array.isArray(condition.value) ? condition.value : [condition.value ?? ""];
        return values.some((v) => {
            const normalized = v.toLowerCase().replace(/^\./, "");
            // Direct extension match: "pdf" or ".pdf"
            if (normalized === ext) return true;
            // MIME type match: "application/pdf" → subtype "pdf"
            if (normalized.includes("/")) {
                const subtype = normalized.split("/").pop() ?? "";
                return (MIME_TO_EXT[subtype] ?? subtype) === ext;
            }
            return false;
        });
    }

    if (condition.type === "llm_verify" || condition.type === "semantic") {
        if (!sdk) return false;

        // For semantic conditions, treat the value(s) as the verification prompt if no explicit prompt is set
        const prompt = condition.prompt
            ?? (Array.isArray(condition.value) ? condition.value.join("; ") : condition.value)
            ?? "";

        if (!prompt) return false;

        trace.push({ timestamp: new Date().toISOString(), step: `Evaluating ${condition.type} condition`, details: { prompt } });
        Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Policy Matching", { action: `Evaluating ${condition.type} condition`, prompt }, doc.supabase);

        try {
            const { provider, model } = await SDKService.resolveChatProvider(settings);
            const result = await sdk.llm.chat(
                [
                    {
                        role: "system",
                        content: "You are a document classifier. Answer with a single JSON object: { \"result\": true/false, \"confidence\": 0.0-1.0 }"
                    },
                    {
                        role: "user",
                        content: `Document text:\n\n${doc.text.slice(0, 2000)}\n\nQuestion: ${prompt}`
                    }
                ],
                { provider, model }
            );

            const raw: string =
                (result as any).response?.content ??
                (result as any).content ??
                (result as any).choices?.[0]?.message?.content ?? "";
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                const threshold = condition.confidence_threshold ?? 0.8;
                const passed = parsed.result === true && (parsed.confidence ?? 1) >= threshold;
                trace.push({ timestamp: new Date().toISOString(), step: `${condition.type} result`, details: { parsed, passed } });
                Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Policy Matching", { action: `${condition.type} result`, parsed, passed }, doc.supabase);
                return passed;
            }
        } catch (err) {
            logger.warn(`${condition.type} condition failed`, { err });
        }
        return false;
    }

    logger.warn(`Unknown condition type "${(condition as any).type}" — skipping`);
    return false;
}

async function matchPolicy(policy: FolioPolicy, doc: DocumentObject, trace: TraceLog[], settings: { llm_provider?: string; llm_model?: string } = {}): Promise<boolean> {
    const { strategy, conditions } = policy.spec.match;
    trace.push({ timestamp: new Date().toISOString(), step: `Evaluating policy rules`, details: { policyId: policy.metadata.id, strategy, conditionsCount: conditions.length } });
    Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Policy Matching", { action: "Evaluating policy rules", policyId: policy.metadata.id, strategy, conditionsCount: conditions.length }, doc.supabase);

    if (strategy === "ALL") {
        for (const cond of conditions) {
            if (!(await evaluateCondition(cond, doc, trace, settings))) {
                trace.push({ timestamp: new Date().toISOString(), step: `Match failed on condition`, details: { condition: cond } });
                Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Policy Matching", { action: "Match failed on condition", condition: cond }, doc.supabase);
                return false;
            }
        }
        trace.push({ timestamp: new Date().toISOString(), step: `All conditions matched`, details: { policyId: policy.metadata.id } });
        Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Policy Matching", { action: "All conditions matched", policyId: policy.metadata.id }, doc.supabase);
        return true;
    }

    // ANY strategy
    for (const cond of conditions) {
        if (await evaluateCondition(cond, doc, trace, settings)) {
            trace.push({ timestamp: new Date().toISOString(), step: `Condition matched (ANY strategy)`, details: { condition: cond } });
            Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Policy Matching", { action: "Condition matched (ANY strategy)", condition: cond }, doc.supabase);
            return true;
        }
    }
    trace.push({ timestamp: new Date().toISOString(), step: `No conditions matched (ANY strategy)` });
    Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Policy Matching", { action: "No conditions matched (ANY strategy)" }, doc.supabase);
    return false;
}

// ─── Extractor ───────────────────────────────────────────────────────────────

async function extractData(
    fields: ExtractField[],
    doc: DocumentObject,
    trace: TraceLog[],
    settings: { llm_provider?: string; llm_model?: string } = {}
): Promise<Record<string, string | number | null>> {
    const sdk = SDKService.getSDK();
    if (!sdk || fields.length === 0) return {};
    trace.push({ timestamp: new Date().toISOString(), step: "Starting data extraction", details: { fieldsCount: fields.length } });
    Actuator.logEvent(doc.ingestionId, doc.userId, "analysis", "Data Extraction", { action: "Starting data extraction", fieldsCount: fields.length }, doc.supabase);

    const { provider, model } = await SDKService.resolveChatProvider(settings);
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
            const parsed = JSON.parse(match[0]);
            trace.push({ timestamp: new Date().toISOString(), step: "Data extracted successfully", details: { extractedKeys: Object.keys(parsed) } });
            Actuator.logEvent(doc.ingestionId, doc.userId, "analysis", "Data Extraction", { action: "Data extracted successfully", extractedKeys: Object.keys(parsed), raw_response: parsed }, doc.supabase);
            return parsed;
        }
    } catch (err) {
        logger.error("Data extraction failed", { err });
        trace.push({ timestamp: new Date().toISOString(), step: "Data extraction failed", details: { error: String(err) } });
        Actuator.logEvent(doc.ingestionId, doc.userId, "error", "Data Extraction", { action: "Data extraction failed", error: String(err) }, doc.supabase);
    }

    return {};
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class PolicyEngine {
    /**
     * Run a document through the policy pipeline.
     * Returns the first matched policy result, or the fallback.
     */
    static async process(doc: DocumentObject, settings: { llm_provider?: string; llm_model?: string } = {}): Promise<ProcessingResult> {
        logger.info(`Processing document: ${doc.filePath}`);
        const policies = await PolicyLoader.load();
        const globalTrace: TraceLog[] = [{ timestamp: new Date().toISOString(), step: "Loaded policies", details: { count: policies.length } }];
        Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Triage", { action: "Loaded policies", count: policies.length }, doc.supabase);

        for (const policy of policies) {
            try {
                const matched = await matchPolicy(policy, doc, globalTrace, settings);
                if (!matched) continue;

                logger.info(`Matched policy: ${policy.metadata.id} (priority: ${policy.metadata.priority})`);

                // Extract data
                const extractedData = await extractData(policy.spec.extract ?? [], doc, globalTrace, settings);

                // Validate required fields
                const missingRequired = (policy.spec.extract ?? [])
                    .filter((f) => f.required && (extractedData[f.key] == null))
                    .map((f) => f.key);

                if (missingRequired.length > 0) {
                    globalTrace.push({ timestamp: new Date().toISOString(), step: "Missing required fields", details: { missingRequired } });
                    Actuator.logEvent(doc.ingestionId, doc.userId, "error", "Data Extraction", { action: "Missing required fields", missingRequired }, doc.supabase);
                    logger.warn(`Missing required fields: ${missingRequired.join(", ")} — routing to Human Review`);
                    return {
                        filePath: doc.filePath,
                        matchedPolicy: policy.metadata.id,
                        extractedData,
                        actionsExecuted: [],
                        status: "error",
                        error: `Missing required fields: ${missingRequired.join(", ")}`,
                        trace: globalTrace
                    };
                }

                // Execute actions
                const actuatorResult = await Actuator.execute(
                    doc.ingestionId,
                    doc.userId,
                    policy.spec.actions ?? [],
                    extractedData,
                    { path: doc.filePath, name: doc.filePath.split('/').pop() || doc.filePath },
                    policy.spec.extract ?? [],
                    doc.supabase
                );

                globalTrace.push(...actuatorResult.trace);

                return {
                    filePath: actuatorResult.actionsExecuted.find((a) => a.startsWith("Moved") || a.startsWith("Renamed"))
                        ? doc.filePath
                        : doc.filePath,
                    matchedPolicy: policy.metadata.id,
                    extractedData,
                    actionsExecuted: actuatorResult.actionsExecuted,
                    status: "matched",
                    error: actuatorResult.errors[0],
                    trace: globalTrace
                };
            } catch (err) {
                logger.error(`Error evaluating policy ${policy.metadata.id}`, { err });
            }
        }

        // Fallback: Inbox Zero
        globalTrace.push({ timestamp: new Date().toISOString(), step: "No policy matched - routed to fallback" });
        Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Triage", { action: "No policy matched - routed to fallback" }, doc.supabase);
        logger.info(`No policy matched — routing to fallback`);
        return {
            filePath: doc.filePath,
            matchedPolicy: null,
            extractedData: {},
            actionsExecuted: ["Moved to /_Needs_Review"],
            status: "fallback",
            trace: globalTrace
        };
    }

    /**
     * Same as process() but uses a pre-loaded list of policies.
     * Used by IngestionService so user-scoped policies are evaluated.
     */
    static async processWithPolicies(doc: DocumentObject, policies: FolioPolicy[], settings: { llm_provider?: string; llm_model?: string } = {}): Promise<ProcessingResult> {
        logger.info(`Processing document with ${policies.length} policies: ${doc.filePath}`);
        const globalTrace: TraceLog[] = [{ timestamp: new Date().toISOString(), step: "Loaded user policies", details: { count: policies.length } }];
        Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Triage", { action: "Loaded user policies", count: policies.length }, doc.supabase);

        for (const policy of policies) {
            try {
                const matched = await matchPolicy(policy, doc, globalTrace, settings);
                if (!matched) continue;

                logger.info(`Matched policy: ${policy.metadata.id}`);
                const extractedData = await extractData(policy.spec.extract ?? [], doc, globalTrace, settings);

                const missingRequired = (policy.spec.extract ?? [])
                    .filter((f) => f.required && extractedData[f.key] == null)
                    .map((f) => f.key);

                if (missingRequired.length > 0) {
                    globalTrace.push({ timestamp: new Date().toISOString(), step: "Missing required fields", details: { missingRequired } });
                    Actuator.logEvent(doc.ingestionId, doc.userId, "error", "Data Extraction", { action: "Missing required fields", missingRequired }, doc.supabase);
                    return {
                        filePath: doc.filePath,
                        matchedPolicy: policy.metadata.id,
                        extractedData,
                        actionsExecuted: [],
                        status: "error",
                        error: `Missing required fields: ${missingRequired.join(", ")}`,
                        trace: globalTrace
                    };
                }

                const actuatorResult = await Actuator.execute(
                    doc.ingestionId,
                    doc.userId,
                    policy.spec.actions ?? [],
                    extractedData,
                    { path: doc.filePath, name: doc.filePath.split('/').pop() || doc.filePath },
                    policy.spec.extract ?? [],
                    doc.supabase
                );

                globalTrace.push(...actuatorResult.trace);

                return {
                    filePath: doc.filePath,
                    matchedPolicy: policy.metadata.id,
                    extractedData,
                    actionsExecuted: actuatorResult.actionsExecuted,
                    status: "matched",
                    error: actuatorResult.errors[0],
                    trace: globalTrace
                };
            } catch (err) {
                logger.error(`Error evaluating policy ${policy.metadata.id}`, { err });
            }
        }

        globalTrace.push({ timestamp: new Date().toISOString(), step: "No policy matched - routed to fallback" });
        Actuator.logEvent(doc.ingestionId, doc.userId, "info", "Triage", { action: "No policy matched - routed to fallback" }, doc.supabase);
        return {
            filePath: doc.filePath,
            matchedPolicy: null,
            extractedData: {},
            actionsExecuted: [],
            status: "fallback",
            trace: globalTrace
        };
    }

    /**
     * Stage 1 of the optimised pipeline: extract baseline entities from a document
     * using the user's active baseline config (or the built-in defaults).
     *
     * The result is always persisted on the ingestion record regardless of whether
     * any policy ultimately matches — every document leaves the Fast Path with
     * structured entities attached.
     *
     * Returns the extracted entity map plus a list of field keys the model flagged
     * as uncertain or absent, which are later used by the confidence-gating logic
     * to decide whether a targeted deep call is worth firing.
     */
    static async extractBaseline(
        doc: DocumentObject,
        config: { context?: string | null; fields?: BaselineField[] },
        settings: { llm_provider?: string; llm_model?: string } = {}
    ): Promise<{ entities: Record<string, unknown>; uncertain_fields: string[] }> {
        const sdk = SDKService.getSDK();
        if (!sdk) {
            logger.warn("SDK unavailable — skipping baseline extraction");
            return { entities: {}, uncertain_fields: [] };
        }

        const fields = (config.fields ?? DEFAULT_BASELINE_FIELDS).filter((f) => f.enabled);
        if (fields.length === 0) return { entities: {}, uncertain_fields: [] };

        const { provider, model } = await SDKService.resolveChatProvider(settings);

        const fieldList = fields
            .map((f) => `- "${f.key}" (${f.type}): ${f.description}`)
            .join("\n");

        const contextBlock = config.context?.trim()
            ? `\nAdditional context about this user's documents:\n${config.context.trim()}\n`
            : "";

        const systemPrompt =
            `You are a precise document entity extractor.${contextBlock}\n` +
            `Return ONLY a valid JSON object with two keys:\n` +
            `  "entities": an object containing each requested field (use null for absent fields),\n` +
            `  "uncertain_fields": an array of field keys you are not confident about.\n` +
            `No markdown, no explanation — only the JSON object.`;

        const userPrompt =
            `Extract the following fields from the document text:\n${fieldList}\n\n` +
            `Document text:\n${doc.text.slice(0, 4000)}`;

        try {
            const result = await sdk.llm.chat(
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                { provider, model }
            );

            const raw: string =
                (result as any).response?.content ??
                (result as any).content ??
                (result as any).choices?.[0]?.message?.content ??
                "";

            const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
            const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : raw.trim();
            const parsed = JSON.parse(jsonStr);

            const entities: Record<string, unknown> = parsed.entities ?? parsed;
            const uncertain_fields: string[] = Array.isArray(parsed.uncertain_fields)
                ? parsed.uncertain_fields
                : [];

            logger.info(`Baseline extraction complete — ${Object.keys(entities).length} fields, ${uncertain_fields.length} uncertain`);
            Actuator.logEvent(doc.ingestionId, doc.userId, "analysis", "Baseline Extraction", { action: "Baseline extraction complete", fields: Object.keys(entities).length, uncertain: uncertain_fields.length, extracted: entities }, doc.supabase);
            return { entities, uncertain_fields };
        } catch (err) {
            logger.error("Baseline extraction failed", { err });
            Actuator.logEvent(doc.ingestionId, doc.userId, "error", "Baseline Extraction", { action: "Baseline extraction failed", error: String(err) }, doc.supabase);
            return { entities: {}, uncertain_fields: [] };
        }
    }

    /**
     * Suggest a baseline config (context + fields) from a workflow description.
     * Returns a draft { context, fields } the user can review before saving.
     */
    static async suggestBaseline(
        description: string,
        currentFields: BaselineField[],
        opts: { provider?: string; model?: string } = {}
    ): Promise<{ suggestion: { context: string; fields: BaselineField[] } | null; error?: string }> {
        const sdk = SDKService.getSDK();
        if (!sdk) {
            const msg = "SDK not available for baseline suggestion";
            logger.warn(msg);
            return { suggestion: null, error: msg };
        }

        const defaults = await SDKService.getDefaultChatProvider();
        const provider = opts.provider || defaults.provider;
        const model = opts.model || defaults.model;
        logger.info(`Suggesting baseline config via ${provider}/${model}`);

        // Summarise the current field keys so the LLM knows what already exists
        const existingKeys = currentFields.map((f) => f.key).join(", ");

        const systemPrompt = `You are a document intelligence expert helping configure a baseline extraction schema for Folio, a local document automation tool.

Given a description of the user's workflow, return ONLY a valid JSON object with this exact shape (no markdown, no backticks, no explanation):
{
  "context": "one or two sentences injected into the LLM extraction prompt — describe document types, languages, vendors, or any domain detail that helps the model",
  "fields": [
    { "key": "snake_case_key", "type": "string|number|date|currency|string[]", "description": "what to extract and why", "enabled": true, "is_default": false }
  ]
}

Rules:
- "context" must be a single concise string (≤ 3 sentences). Focus on what makes these documents distinctive.
- "fields" must only contain CUSTOM fields the user should ADD — do not repeat any of the existing field keys: ${existingKeys}
- Each custom field needs a clear key (snake_case, no spaces), the most precise type, and a description that doubles as a hint to the extraction model.
- Suggest between 2 and 6 custom fields — quality over quantity.
- Return an empty fields array if no meaningful custom fields apply.`;

        try {
            const result = await sdk.llm.chat(
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `My workflow: ${description}` }
                ],
                { provider, model }
            );

            const raw: string =
                (result as any).response?.content ??
                (result as any).content ??
                (result as any).message?.content ??
                (result as any).choices?.[0]?.message?.content ??
                (result as any).text ??
                (result as any).result ??
                (result as any).output ??
                "";

            if (!raw) return { suggestion: null, error: "LLM returned empty response" };

            const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
            const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : raw.trim();

            let parsed: { context: string; fields: BaselineField[] };
            try {
                parsed = JSON.parse(jsonStr);
            } catch {
                logger.error("JSON parse failed for baseline suggestion", { raw: jsonStr.slice(0, 300) });
                return { suggestion: null, error: "LLM response was not valid JSON" };
            }

            if (typeof parsed.context !== "string" || !Array.isArray(parsed.fields)) {
                return { suggestion: null, error: "LLM response did not match expected shape" };
            }

            // Ensure all suggested fields are marked as custom
            parsed.fields = parsed.fields.map((f) => ({ ...f, is_default: false, enabled: true }));

            logger.info(`Baseline suggestion: context length=${parsed.context.length}, custom fields=${parsed.fields.length}`);
            return { suggestion: parsed };

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("Baseline suggestion failed", { err });
            return { suggestion: null, error: msg };
        }
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
    "actions": [{ "type": "copy", "destination": "/path/to/folder" }]
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
