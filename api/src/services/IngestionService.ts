import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import { createLogger } from "../utils/logger.js";
import { PolicyLoader } from "./PolicyLoader.js";
import { PolicyEngine } from "./PolicyEngine.js";
import { BaselineConfigService } from "./BaselineConfigService.js";
import { Actuator } from "../utils/Actuator.js";
import { RAGService } from "./RAGService.js";
import { SDKService } from "./SDKService.js";

const logger = createLogger("IngestionService");

/**
 * Multi-signal classifier that decides whether pdf-parse extracted enough
 * real text to skip GPU OCR and go straight to the local LLM (Fast Path).
 *
 * Four independent signals must all pass:
 *
 *  1. Minimum content  – collapse whitespace before counting so sparse/formatted
 *                        PDFs (forms, invoices) don't fail on raw length alone.
 *  2. Word count       – Unicode-aware (\p{L}) so French, German, Japanese, etc.
 *                        aren't penalised; pure symbol/number docs are caught.
 *  3. Garbage ratio    – control chars + U+FFFD are the signature of image bytes
 *                        that were mis-decoded as text.  >2 % → encoding failure.
 *  4. Page coverage    – only for multi-page docs: if fewer than 40 % of pages
 *                        yield non-trivial text the document is mostly scanned.
 */
function isPdfTextExtractable(pdfData: {
    text: string;
    pages: Array<{ num: number; text: string }>;
    total: number;
}): boolean {
    const raw = pdfData.text ?? '';

    // Signal 1: at least 100 printable characters after whitespace normalisation
    if (raw.replace(/\s+/g, ' ').trim().length < 100) return false;

    // Signal 2: at least 20 word-like tokens (≥2 Unicode letters)
    const words = raw.match(/\p{L}{2,}/gu) ?? [];
    if (words.length < 20) return false;

    // Signal 3: garbage character ratio must be below 2 %
    const garbageCount = (raw.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]/g) ?? []).length;
    if (raw.length > 0 && garbageCount / raw.length > 0.02) return false;

    // Signal 4: page coverage — getText() always emits one entry per page,
    // so pages.length === total.  For docs with >2 pages, at least 40 % of
    // pages must contain >30 non-whitespace characters.
    if (pdfData.total > 2 && pdfData.pages.length > 0) {
        const pagesWithText = pdfData.pages.filter(
            (p) => (p.text ?? '').replace(/\s/g, '').length > 30
        ).length;
        if (pagesWithText / pdfData.total < 0.4) return false;
    }

    return true;
}

export type IngestionStatus = "pending" | "processing" | "matched" | "no_match" | "error" | "duplicate";
export type IngestionSource = "upload" | "dropzone" | "email" | "url";

export interface Ingestion {
    id: string;
    user_id: string;
    source: IngestionSource;
    filename: string;
    mime_type?: string;
    file_size?: number;
    file_hash?: string;
    status: IngestionStatus;
    policy_id?: string;
    policy_name?: string;
    extracted?: Record<string, unknown>;
    actions_taken?: string[];
    error_message?: string;
    storage_path?: string;
    trace?: Array<{ timestamp: string; step: string; details?: any }>;
    tags?: string[];
    summary?: string | null;
    created_at: string;
    updated_at: string;
}

export class IngestionService {
    /**
     * Ingest a document using Hybrid Routing Architecture.
     */
    static async ingest(opts: {
        supabase: SupabaseClient;
        userId: string;
        filename: string;
        mimeType?: string;
        fileSize?: number;
        source?: IngestionSource;
        filePath: string;
        content: string;
        fileHash?: string;
    }): Promise<Ingestion> {
        const { supabase, userId, filename, mimeType, fileSize, source = "upload", filePath, content, fileHash } = opts;

        // Duplicate detection — check if this exact file content was already ingested
        if (fileHash) {
            const { data: existing } = await supabase
                .from("ingestions")
                .select("id, filename, created_at")
                .eq("user_id", userId)
                .eq("file_hash", fileHash)
                .eq("status", "matched")
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();

            if (existing) {
                logger.info(`Duplicate file detected: '${filename}' matches ingestion ${existing.id} ('${existing.filename}')`);
                const { data: dupIngestion } = await supabase
                    .from("ingestions")
                    .insert({
                        user_id: userId,
                        source,
                        filename,
                        mime_type: mimeType,
                        file_size: fileSize,
                        storage_path: filePath,
                        file_hash: fileHash,
                        status: "duplicate",
                        extracted: { duplicate_of: existing.id, original_filename: existing.filename },
                    })
                    .select()
                    .single();
                return dupIngestion as Ingestion;
            }
        }

        // 1. Insert into ingestions
        const { data: ingestion, error: insertErr } = await supabase
            .from("ingestions")
            .insert({
                user_id: userId,
                source,
                filename,
                mime_type: mimeType,
                file_size: fileSize,
                storage_path: filePath,
                file_hash: fileHash ?? null,
                status: "processing"
            })
            .select()
            .single();

        if (insertErr || !ingestion) throw new Error(`Failed to create ingestion record: ${insertErr?.message}`);

        logger.info(`Processing ingestion ${ingestion.id}: ${filename}`);
        Actuator.logEvent(ingestion.id, userId, "info", "Triage", { action: "Ingestion started", source, filename, fileSize }, supabase);

        // 2. Document Triage
        let isFastPath = false;
        let extractionContent = content;
        const ext = filename.toLowerCase().split('.').pop() || '';
        const fastExts = ['txt', 'md', 'csv', 'json'];

        if (fastExts.includes(ext)) {
            isFastPath = true;
        } else if (ext === 'pdf') {
            try {
                const buffer = await fs.readFile(filePath);
                const parser = new PDFParse({ data: buffer });
                const pdfData = await parser.getText();
                if (isPdfTextExtractable(pdfData)) {
                    isFastPath = true;
                    extractionContent = pdfData.text;
                    logger.info(`Smart Triage: PDF ${filename} passed text quality check (${pdfData.pages.filter(p => p.text.trim().length > 30).length}/${pdfData.total} pages with text). Routing to Fast Path.`);
                    Actuator.logEvent(ingestion.id, userId, "info", "Triage", { action: "Smart Triage passed", type: "pdf", fast_path: true }, supabase);
                } else {
                    logger.info(`Smart Triage: PDF ${filename} failed text quality check. Routing to Heavy Path.`);
                    Actuator.logEvent(ingestion.id, userId, "info", "Triage", { action: "Smart Triage failed", type: "pdf", fast_path: false }, supabase);
                }
            } catch (err) {
                logger.warn(`Failed to parse PDF ${filename}. Routing to Heavy Path.`, { err });
                Actuator.logEvent(ingestion.id, userId, "error", "Triage", { action: "PDF parse failed", error: String(err) }, supabase);
            }
        }

        if (isFastPath) {
            try {
                // 3. Fast Path — fetch all dependencies in parallel
                const [userPolicies, settingsRow, baselineConfig] = await Promise.all([
                    PolicyLoader.load(false, supabase),
                    supabase.from("user_settings").select("llm_provider, llm_model, embedding_provider, embedding_model").eq("user_id", userId).maybeSingle(),
                    BaselineConfigService.getActive(supabase, userId),
                ]);
                const llmSettings = {
                    llm_provider: settingsRow.data?.llm_provider ?? undefined,
                    llm_model: settingsRow.data?.llm_model ?? undefined,
                };
                const embedSettings = {
                    embedding_provider: settingsRow.data?.embedding_provider ?? undefined,
                    embedding_model: settingsRow.data?.embedding_model ?? undefined,
                };
                const doc = { filePath: filePath, text: extractionContent, ingestionId: ingestion.id, userId, supabase };

                // Fire and forget Semantic Embedding Storage
                RAGService.chunkAndEmbed(ingestion.id, userId, doc.text, supabase, embedSettings).catch(err => {
                    logger.error(`RAG embedding failed for ${ingestion.id}`, err);
                });

                // 4. Stage 1: Baseline extraction (always runs, LLM call 1 of max 2)
                const { entities: baselineEntities, tags: autoTags } = await PolicyEngine.extractBaseline(
                    doc,
                    { context: baselineConfig?.context, fields: baselineConfig?.fields },
                    llmSettings
                );

                // Enrich the document with extracted entities so policy keyword/semantic
                // conditions can match against semantic field values (e.g. document_type:
                // "invoice") even when those exact words don't appear in the raw text.
                const entityLines = Object.entries(baselineEntities)
                    .filter(([, v]) => v != null)
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}`);
                const enrichedDoc = entityLines.length > 0
                    ? { ...doc, text: doc.text + "\n\n[Extracted fields]\n" + entityLines.join("\n") }
                    : doc;

                // 5. Stage 2: Policy matching + policy-specific field extraction
                let result;
                if (userPolicies.length > 0) {
                    result = await PolicyEngine.processWithPolicies(enrichedDoc, userPolicies, llmSettings, baselineEntities);
                } else {
                    result = await PolicyEngine.process(enrichedDoc, llmSettings, baselineEntities);
                }

                const policyName = userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name;
                const finalStatus = result.status === "fallback" ? "no_match" : result.status;

                // Merge: baseline entities are the foundation; policy-specific fields
                // are overlaid on top so more precise extractions take precedence.
                const mergedExtracted = { ...baselineEntities, ...result.extractedData };

                const { data: updatedIngestion } = await supabase
                    .from("ingestions")
                    .update({
                        status: finalStatus,
                        policy_id: result.matchedPolicy,
                        policy_name: policyName,
                        extracted: mergedExtracted,
                        actions_taken: result.actionsExecuted,
                        trace: result.trace,
                        tags: autoTags,
                        baseline_config_id: baselineConfig?.id ?? null,
                    })
                    .eq("id", ingestion.id)
                    .select()
                    .single();

                return updatedIngestion as Ingestion;

            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                Actuator.logEvent(ingestion.id, userId, "error", "Processing", { error: msg }, supabase);
                const { data: updatedIngestion } = await supabase
                    .from("ingestions")
                    .update({ status: "error", error_message: msg })
                    .eq("id", ingestion.id)
                    .select()
                    .single();
                return updatedIngestion as Ingestion;
            }
        } else {
            // 4. Heavy Path (Delegate to RealTimeX)
            const { error: rtxErr } = await supabase
                .from("rtx_activities")
                .insert({
                    user_id: userId,
                    status: "pending", // Waiting for RealTimeX
                    raw_data: {
                        source,
                        filename,
                        mime_type: mimeType,
                        file_size: fileSize,
                        file_path: filePath,
                        ingestion_id: ingestion.id
                    }
                });

            if (rtxErr) {
                logger.error(`Failed to delegate to rtx_activities`, { rtxErr });
            }

            const { data: pendingIngestion } = await supabase
                .from("ingestions")
                .update({ status: "pending" }) // UI shows pending
                .eq("id", ingestion.id)
                .select()
                .single();

            return pendingIngestion as Ingestion;
        }
    }

    /**
     * Re-run an existing ingestion
     */
    static async rerun(ingestionId: string, supabase: SupabaseClient, userId: string): Promise<boolean> {
        const { data: ingestion, error } = await supabase
            .from("ingestions")
            .select("*")
            .eq("id", ingestionId)
            .eq("user_id", userId)
            .single();

        if (error || !ingestion) throw new Error("Ingestion not found");

        await supabase
            .from("ingestions")
            .update({ status: "processing", error_message: null, policy_id: null, policy_name: null, extracted: {}, actions_taken: [], summary: null })
            .eq("id", ingestionId);

        Actuator.logEvent(ingestionId, userId, "info", "Triage", { action: "Re-run Initiated" }, supabase);

        const filename = ingestion.filename;
        const filePath = ingestion.storage_path;
        if (!filePath) throw new Error("No storage path found for this ingestion");

        let isFastPath = false;
        let extractionContent = "";
        const ext = filename.toLowerCase().split('.').pop() || '';
        const fastExts = ['txt', 'md', 'csv', 'json'];

        if (fastExts.includes(ext)) {
            isFastPath = true;
            extractionContent = await fs.readFile(filePath, "utf-8");
        } else if (ext === 'pdf') {
            try {
                const buffer = await fs.readFile(filePath);
                const parser = new PDFParse({ data: buffer });
                const pdfData = await parser.getText();
                if (isPdfTextExtractable(pdfData)) {
                    isFastPath = true;
                    extractionContent = pdfData.text;
                }
            } catch (err) {
                // ignore
            }
        }

        if (isFastPath) {
            const [userPolicies, settingsRow, baselineConfig] = await Promise.all([
                PolicyLoader.load(false, supabase),
                supabase.from("user_settings").select("llm_provider, llm_model, embedding_provider, embedding_model").eq("user_id", userId).maybeSingle(),
                BaselineConfigService.getActive(supabase, userId),
            ]);
            const llmSettings = {
                llm_provider: settingsRow.data?.llm_provider ?? undefined,
                llm_model: settingsRow.data?.llm_model ?? undefined,
            };
            const embedSettings = {
                embedding_provider: settingsRow.data?.embedding_provider ?? undefined,
                embedding_model: settingsRow.data?.embedding_model ?? undefined,
            };
            const doc = { filePath, text: extractionContent, ingestionId, userId, supabase };

            // Fire and forget Semantic Embedding Storage for re-runs
            RAGService.chunkAndEmbed(ingestionId, userId, doc.text, supabase, embedSettings).catch(err => {
                logger.error(`RAG embedding failed during rerun for ${ingestionId}`, err);
            });

            const { entities: baselineEntities, tags: autoTags } = await PolicyEngine.extractBaseline(
                doc,
                { context: baselineConfig?.context, fields: baselineConfig?.fields },
                llmSettings
            );

            const entityLines = Object.entries(baselineEntities)
                .filter(([, v]) => v != null)
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}`);
            const enrichedDoc = entityLines.length > 0
                ? { ...doc, text: doc.text + "\n\n[Extracted fields]\n" + entityLines.join("\n") }
                : doc;

            let result;
            if (userPolicies.length > 0) {
                result = await PolicyEngine.processWithPolicies(enrichedDoc, userPolicies, llmSettings, baselineEntities);
            } else {
                result = await PolicyEngine.process(enrichedDoc, llmSettings, baselineEntities);
            }

            const policyName = userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name;
            const finalStatus = result.status === "fallback" ? "no_match" : result.status;
            const mergedExtracted = { ...baselineEntities, ...result.extractedData };

            // Preserve any human-added tags; merge with freshly generated auto-tags.
            const existingTags: string[] = Array.isArray(ingestion.tags) ? ingestion.tags : [];
            const mergedTags = [...new Set([...autoTags, ...existingTags])];

            await supabase
                .from("ingestions")
                .update({
                    status: finalStatus,
                    policy_id: result.matchedPolicy,
                    policy_name: policyName,
                    extracted: mergedExtracted,
                    actions_taken: result.actionsExecuted,
                    trace: [
                        ...(ingestion.trace || []),
                        { timestamp: new Date().toISOString(), step: "--- Re-run Initiated ---" },
                        ...(result.trace || [])
                    ],
                    tags: mergedTags,
                    baseline_config_id: baselineConfig?.id ?? null,
                })
                .eq("id", ingestionId);

            return finalStatus === "matched";
        } else {
            // Re-delegate to rtx_activities
            await supabase
                .from("rtx_activities")
                .insert({
                    user_id: userId,
                    status: "pending",
                    raw_data: {
                        source: ingestion.source,
                        filename,
                        mime_type: ingestion.mime_type,
                        file_size: ingestion.file_size,
                        file_path: filePath,
                        ingestion_id: ingestion.id
                    }
                });

            await supabase
                .from("ingestions")
                .update({ status: "pending" })
                .eq("id", ingestionId);

            return true;
        }
    }

    /**
     * List ingestions for a user, newest first.
     */
    static async list(supabase: SupabaseClient, userId: string, limit = 50): Promise<Ingestion[]> {
        const { data, error } = await supabase
            .from("ingestions")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) throw new Error(`Failed to list ingestions: ${error.message}`);
        return data as Ingestion[];
    }

    /**
     * Get a single ingestion by ID.
     */
    static async get(id: string, supabase: SupabaseClient, userId: string): Promise<Ingestion | null> {
        const { data } = await supabase
            .from("ingestions")
            .select("*")
            .eq("id", id)
            .eq("user_id", userId)
            .single();
        return data as Ingestion | null;
    }

    /**
     * Delete an ingestion record.
     */
    static async delete(id: string, supabase: SupabaseClient, userId: string): Promise<boolean> {
        const { count, error } = await supabase
            .from("ingestions")
            .delete({ count: "exact" })
            .eq("id", id)
            .eq("user_id", userId);

        if (error) throw new Error(`Failed to delete ingestion: ${error.message}`);
        return (count ?? 0) > 0;
    }

    /**
     * Generate (or return cached) a 2-3 sentence prose summary for an ingestion.
     * Builds the prompt from already-extracted entities — no file I/O needed.
     * The result is saved back to ingestion.summary so subsequent calls are instant.
     */
    static async summarize(
        id: string,
        supabase: SupabaseClient,
        userId: string,
        llmSettings: { llm_provider?: string; llm_model?: string } = {}
    ): Promise<string | null> {
        const { data: ing } = await supabase
            .from("ingestions")
            .select("id, filename, extracted, summary, status")
            .eq("id", id)
            .eq("user_id", userId)
            .single();

        if (!ing) throw new Error("Ingestion not found");

        // Return cached summary if available
        if (ing.summary) return ing.summary as string;

        // Cannot summarise documents that haven't been processed yet
        if (ing.status === "pending" || ing.status === "processing") return null;

        const sdk = SDKService.getSDK();
        if (!sdk) {
            logger.warn("SDK unavailable — skipping summary generation");
            return null;
        }

        const extracted: Record<string, unknown> = ing.extracted ?? {};
        const entityLines = Object.entries(extracted)
            .filter(([, v]) => v != null && String(v).trim() !== "")
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}`);

        if (entityLines.length === 0) return null;

        const { provider, model } = await SDKService.resolveChatProvider(llmSettings);

        const userPrompt =
            `Summarize this document:\nFilename: ${ing.filename}\n` +
            entityLines.join("\n");

        try {
            const result = await sdk.llm.chat(
                [
                    {
                        role: "system",
                        content:
                            "You are a document assistant. Write a concise 2-3 sentence prose summary of a document " +
                            "based on its extracted metadata. Be specific — name the issuer, amount, date, and purpose " +
                            "where available. Plain prose only, no bullet points or markdown formatting."
                    },
                    { role: "user", content: userPrompt }
                ],
                { provider, model }
            );

            const summary: string =
                (result as any).response?.content ??
                (result as any).content ??
                (result as any).message?.content ??
                (result as any).choices?.[0]?.message?.content ??
                "";

            if (!summary.trim()) return null;

            // Cache the result
            await supabase
                .from("ingestions")
                .update({ summary })
                .eq("id", id)
                .eq("user_id", userId);

            logger.info(`Summary generated and cached for ingestion ${id}`);
            return summary;
        } catch (err) {
            logger.error("Summary generation failed", { err });
            return null;
        }
    }
}
