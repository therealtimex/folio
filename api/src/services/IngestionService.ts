import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import { createLogger } from "../utils/logger.js";
import { PolicyLoader } from "./PolicyLoader.js";
import type { FolioPolicy } from "./PolicyLoader.js";
import { PolicyEngine } from "./PolicyEngine.js";
import { PolicyLearningService } from "./PolicyLearningService.js";
import { BaselineConfigService } from "./BaselineConfigService.js";
import { Actuator } from "../utils/Actuator.js";
import { extractLlmResponse, previewLlmText } from "../utils/llmResponse.js";
import { RAGService } from "./RAGService.js";
import { SDKService } from "./SDKService.js";
import { ModelCapabilityService, type VisionCapabilityModality } from "./ModelCapabilityService.js";

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
    // eslint-disable-next-line no-control-regex
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trace?: Array<{ timestamp: string; step: string; details?: any }>;
    tags?: string[];
    summary?: string | null;
    created_at: string;
    updated_at: string;
}

export class IngestionService {
    private static readonly FAST_EXTS = ["txt", "md", "csv", "json"] as const;
    private static readonly IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"] as const;

    private static readonly NON_IDEMPOTENT_ACTION_TYPES = new Set([
        "append_to_google_sheet",
        "webhook",
        "copy_to_gdrive",
        "copy",
        "log_csv",
        "notify",
    ]);

    private static listNonIdempotentPolicyActions(policy: FolioPolicy): string[] {
        const actionTypes = Array.isArray(policy.spec.actions)
            ? policy.spec.actions.map((action) => String(action?.type ?? "").trim()).filter(Boolean)
            : [];
        return Array.from(new Set(actionTypes.filter((actionType) => this.NON_IDEMPOTENT_ACTION_TYPES.has(actionType))));
    }

    private static valueToSemanticText(value: unknown): string {
        if (value == null) return "";
        if (Array.isArray(value)) {
            return value
                .map((item) => this.valueToSemanticText(item))
                .filter(Boolean)
                .join(", ");
        }
        if (typeof value === "object") {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }
        return String(value);
    }

    private static buildVlmSemanticText(opts: {
        filename: string;
        finalStatus: string;
        policyName?: string;
        extracted: Record<string, unknown>;
        tags: string[];
        modality: VisionCapabilityModality;
    }): string {
        const { filename, finalStatus, policyName, extracted, tags, modality } = opts;
        const lines: string[] = [
            `Document filename: ${filename}`,
            `Document source: VLM ${modality} extraction`,
            `Processing status: ${finalStatus}`,
        ];

        if (policyName) {
            lines.push(`Matched policy: ${policyName}`);
        }
        if (tags.length > 0) {
            lines.push(`Tags: ${tags.join(", ")}`);
        }

        const fieldLines = Object.entries(extracted)
            .filter(([key]) => key !== "_enrichment")
            .map(([key, value]) => ({ key, value: this.valueToSemanticText(value).trim() }))
            .filter((entry) => entry.value.length > 0)
            .slice(0, 80)
            .map((entry) => `- ${entry.key}: ${entry.value}`);

        if (fieldLines.length > 0) {
            lines.push("Extracted fields:");
            lines.push(...fieldLines);
        } else {
            lines.push("Extracted fields: none");
        }

        const enrichment = extracted["_enrichment"];
        if (enrichment && typeof enrichment === "object" && !Array.isArray(enrichment)) {
            const enrichmentKeys = Object.keys(enrichment as Record<string, unknown>);
            if (enrichmentKeys.length > 0) {
                lines.push(`Enrichment fields: ${enrichmentKeys.join(", ")}`);
            }
        }

        lines.push("Synthetic semantic text generated from VLM output for retrieval.");
        return lines.join("\n");
    }

    private static countExtractedSemanticFields(extracted: Record<string, unknown>): number {
        return Object.entries(extracted)
            .filter(([key]) => key !== "_enrichment")
            .map(([, value]) => value)
            .map((value) => this.valueToSemanticText(value).trim())
            .filter((value) => value.length > 0).length;
    }

    private static queueVlmSemanticEmbedding(opts: {
        ingestionId: string;
        userId: string;
        filename: string;
        finalStatus: string;
        policyName?: string;
        extracted: Record<string, unknown>;
        tags: string[];
        modality: VisionCapabilityModality;
        supabase: SupabaseClient;
        embedSettings: { embedding_provider?: string; embedding_model?: string };
    }): { synthetic_chars: number; extracted_fields: number; tags_count: number } {
        const syntheticText = this.buildVlmSemanticText({
            filename: opts.filename,
            finalStatus: opts.finalStatus,
            policyName: opts.policyName,
            extracted: opts.extracted,
            tags: opts.tags,
            modality: opts.modality,
        });
        const details = {
            synthetic_chars: syntheticText.length,
            extracted_fields: this.countExtractedSemanticFields(opts.extracted),
            tags_count: opts.tags.length,
        };

        Actuator.logEvent(opts.ingestionId, opts.userId, "analysis", "RAG Embedding", {
            action: "Queued synthetic VLM embedding",
            ...details,
        }, opts.supabase);

        RAGService.chunkAndEmbed(
            opts.ingestionId,
            opts.userId,
            syntheticText,
            opts.supabase,
            opts.embedSettings
        ).then(() => {
            Actuator.logEvent(opts.ingestionId, opts.userId, "analysis", "RAG Embedding", {
                action: "Completed synthetic VLM embedding",
                ...details,
            }, opts.supabase);
        }).catch((err) => {
            logger.error(`RAG embedding failed for synthetic VLM text ${opts.ingestionId}`, err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            Actuator.logEvent(opts.ingestionId, opts.userId, "error", "RAG Embedding", {
                action: "Synthetic VLM embedding failed",
                error: errorMessage,
                ...details,
            }, opts.supabase);
        });

        return details;
    }

    private static buildVlmPayloadMarker(modality: VisionCapabilityModality, dataUrl: string): string {
        const prefix = modality === "pdf" ? "VLM_PDF_DATA" : "VLM_IMAGE_DATA";
        return `[${prefix}:${dataUrl}]`;
    }

    private static async fileToDataUrl(filePath: string, mimeType: string): Promise<string> {
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString("base64");
        return `data:${mimeType};base64,${base64}`;
    }

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
        Actuator.logEvent(ingestion.id, userId, "info", "Triage", { action: "Ingestion started", source, filename, fileSize, is_high_intent: true }, supabase);

        // 2. Document Triage
        let isFastPath = false;
        let isMultimodalFastPath = false;
        let multimodalModality: VisionCapabilityModality | null = null;
        let extractionContent = content;
        const ext = filename.toLowerCase().split('.').pop() || '';

        // Pre-fetch settings to decide whether we should attempt VLM.
        const { data: triageSettingsRow } = await supabase
            .from("user_settings")
            .select("llm_provider, llm_model, embedding_provider, embedding_model, vision_model_capabilities")
            .eq("user_id", userId)
            .maybeSingle();
        const imageResolution = ModelCapabilityService.resolveVisionSupport(triageSettingsRow, "image");
        const pdfResolution = ModelCapabilityService.resolveVisionSupport(triageSettingsRow, "pdf");
        const llmModel = imageResolution.model;
        const llmProvider = imageResolution.provider;

        if (this.FAST_EXTS.includes(ext as typeof this.FAST_EXTS[number])) {
            isFastPath = true;
        } else if (this.IMAGE_EXTS.includes(ext as typeof this.IMAGE_EXTS[number]) && imageResolution.shouldAttempt) {
            try {
                const mimeTypeActual = mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                const dataUrl = await this.fileToDataUrl(filePath, mimeTypeActual);
                extractionContent = this.buildVlmPayloadMarker("image", dataUrl);
                isFastPath = true;
                isMultimodalFastPath = true;
                multimodalModality = "image";
                logger.info(`Smart Triage: Image ${filename} routed to Fast Path using native VLM (${llmModel}).`);
                Actuator.logEvent(ingestion.id, userId, "info", "Triage", { action: "VLM Fast Path selected", type: ext, model: llmModel }, supabase);
            } catch (err) {
                logger.warn(`Failed to read VLM image ${filename}. Routing to Heavy Path.`, { err });
            }
        } else if (this.IMAGE_EXTS.includes(ext as typeof this.IMAGE_EXTS[number])) {
            logger.info(`Smart Triage: Image ${filename} kept on Heavy Path because ${llmProvider}/${llmModel} is marked vision-unsupported.`);
            Actuator.logEvent(ingestion.id, userId, "info", "Triage", {
                action: "VLM skipped (model marked unsupported)",
                type: ext,
                model: llmModel,
                provider: llmProvider
            }, supabase);
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
                } else if (pdfResolution.shouldAttempt) {
                    // Reuse the already-loaded parse buffer; avoid a second readFile in fileToDataUrl.
                    const dataUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;
                    extractionContent = this.buildVlmPayloadMarker("pdf", dataUrl);
                    isFastPath = true;
                    isMultimodalFastPath = true;
                    multimodalModality = "pdf";
                    logger.info(`Smart Triage: PDF ${filename} routed to multimodal Fast Path using native VLM (${llmModel}).`);
                    Actuator.logEvent(ingestion.id, userId, "info", "Triage", {
                        action: "VLM Fast Path selected",
                        type: "pdf",
                        modality: "pdf",
                        model: llmModel,
                    }, supabase);
                } else {
                    logger.info(`Smart Triage: PDF ${filename} kept on Heavy Path because ${llmProvider}/${llmModel} is marked PDF-unsupported.`);
                    Actuator.logEvent(ingestion.id, userId, "info", "Triage", {
                        action: "VLM skipped (model marked unsupported)",
                        type: "pdf",
                        modality: "pdf",
                        model: llmModel,
                        provider: llmProvider,
                    }, supabase);
                }
            } catch (err) {
                logger.warn(`Failed to parse PDF ${filename}. Routing to Heavy Path.`, { err });
                Actuator.logEvent(ingestion.id, userId, "error", "Triage", { action: "PDF parse failed", error: String(err) }, supabase);
            }
        }

        if (isFastPath) {
            try {
                // 3. Fast Path — fetch all dependencies in parallel
                const [userPolicies, processingSettingsRow, baselineConfig] = await Promise.all([
                    PolicyLoader.load(false, supabase),
                    supabase.from("user_settings").select("llm_provider, llm_model, embedding_provider, embedding_model").eq("user_id", userId).maybeSingle(),
                    BaselineConfigService.getActive(supabase, userId),
                ]);
                const llmSettings = {
                    llm_provider: processingSettingsRow.data?.llm_provider ?? undefined,
                    llm_model: processingSettingsRow.data?.llm_model ?? undefined,
                };
                const embedSettings = {
                    embedding_provider: processingSettingsRow.data?.embedding_provider ?? undefined,
                    embedding_model: processingSettingsRow.data?.embedding_model ?? undefined,
                };
                const doc = { filePath: filePath, text: extractionContent, ingestionId: ingestion.id, userId, supabase };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const baselineTrace: Array<{ timestamp: string; step: string; details?: any }> = [];

                // Fire and forget Semantic Embedding Storage
                RAGService.chunkAndEmbed(ingestion.id, userId, doc.text, supabase, embedSettings).catch(err => {
                    logger.error(`RAG embedding failed for ${ingestion.id}`, err);
                });

                // 4. Stage 1: Baseline extraction (always runs, LLM call 1 of max 2)
                baselineTrace.push({
                    timestamp: new Date().toISOString(),
                    step: "LLM request (baseline extraction)",
                    details: {
                        provider: llmSettings.llm_provider ?? llmProvider,
                        model: llmSettings.llm_model ?? llmModel,
                        mode: isMultimodalFastPath ? `vision:${multimodalModality ?? "image"}` : "text",
                    }
                });

                const baselineResult = await PolicyEngine.extractBaseline(
                    doc,
                    { context: baselineConfig?.context, fields: baselineConfig?.fields },
                    llmSettings
                );
                const baselineEntities = baselineResult.entities;
                const autoTags = baselineResult.tags;
                baselineTrace.push({
                    timestamp: new Date().toISOString(),
                    step: "LLM response (baseline extraction)",
                    details: {
                        entities_count: Object.keys(baselineEntities).length,
                        uncertain_count: baselineResult.uncertain_fields.length,
                        tags_count: autoTags.length,
                    }
                });

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
                let finalTrace = [...baselineTrace, ...(result.trace || [])];

                const { data: updatedIngestion } = await supabase
                    .from("ingestions")
                    .update({
                        status: finalStatus,
                        policy_id: result.matchedPolicy,
                        policy_name: policyName,
                        extracted: mergedExtracted,
                        actions_taken: result.actionsExecuted,
                        trace: finalTrace,
                        tags: autoTags,
                        baseline_config_id: baselineConfig?.id ?? null,
                    })
                    .eq("id", ingestion.id)
                    .select()
                    .single();

                if (isMultimodalFastPath && multimodalModality) {
                    const embeddingMeta = this.queueVlmSemanticEmbedding({
                        ingestionId: ingestion.id,
                        userId,
                        filename,
                        finalStatus,
                        policyName,
                        extracted: mergedExtracted,
                        tags: autoTags,
                        modality: multimodalModality,
                        supabase,
                        embedSettings,
                    });
                    finalTrace = [
                        ...finalTrace,
                        {
                            timestamp: new Date().toISOString(),
                            step: "Queued synthetic VLM embedding",
                            details: embeddingMeta,
                        }
                    ];
                    await supabase
                        .from("ingestions")
                        .update({ trace: finalTrace })
                        .eq("id", ingestion.id);
                }

                if (isMultimodalFastPath && multimodalModality) {
                    await ModelCapabilityService.learnVisionSuccess({
                        supabase,
                        userId,
                        provider: llmSettings.llm_provider ?? llmProvider,
                        model: llmSettings.llm_model ?? llmModel,
                        modality: multimodalModality,
                    });
                }

                return updatedIngestion as Ingestion;

            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);

                if (isMultimodalFastPath && multimodalModality) {
                    const learnedState = await ModelCapabilityService.learnVisionFailure({
                        supabase,
                        userId,
                        provider: llmProvider,
                        model: llmModel,
                        error: err,
                        modality: multimodalModality,
                    });
                    logger.warn(`VLM extraction failed for ${filename}. Falling back to Heavy Path. Error: ${msg}`);
                    Actuator.logEvent(ingestion.id, userId, "error", "Processing", {
                        action: "VLM Failed, Fallback to Heavy",
                        error: msg,
                        learned_state: learnedState,
                    }, supabase);
                    // Fall back to Heavy Path
                    isFastPath = false;
                } else {
                    Actuator.logEvent(ingestion.id, userId, "error", "Processing", { error: msg }, supabase);
                    const { data: updatedIngestion } = await supabase
                        .from("ingestions")
                        .update({ status: "error", error_message: msg })
                        .eq("id", ingestion.id)
                        .select()
                        .single();
                    return updatedIngestion as Ingestion;
                }
            }
        }

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

    /**
     * Re-run an existing ingestion
     */
    static async rerun(
        ingestionId: string,
        supabase: SupabaseClient,
        userId: string,
        opts: { forcedPolicyId?: string } = {}
    ): Promise<boolean> {
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

        Actuator.logEvent(ingestionId, userId, "info", "Triage", { action: "Re-run Initiated", is_high_intent: true }, supabase);

        const filename = ingestion.filename;
        const filePath = ingestion.storage_path;
        if (!filePath) throw new Error("No storage path found for this ingestion");

        let isFastPath = false;
        let isMultimodalFastPath = false;
        let multimodalModality: VisionCapabilityModality | null = null;
        let extractionContent = "";
        const ext = filename.toLowerCase().split('.').pop() || '';

        const { data: triageSettingsRow } = await supabase
            .from("user_settings")
            .select("llm_provider, llm_model, embedding_provider, embedding_model, vision_model_capabilities")
            .eq("user_id", userId)
            .maybeSingle();
        const imageResolution = ModelCapabilityService.resolveVisionSupport(triageSettingsRow, "image");
        const pdfResolution = ModelCapabilityService.resolveVisionSupport(triageSettingsRow, "pdf");
        const llmModel = imageResolution.model;
        const llmProvider = imageResolution.provider;

        if (this.FAST_EXTS.includes(ext as typeof this.FAST_EXTS[number])) {
            isFastPath = true;
            extractionContent = await fs.readFile(filePath, "utf-8");
        } else if (this.IMAGE_EXTS.includes(ext as typeof this.IMAGE_EXTS[number]) && imageResolution.shouldAttempt) {
            try {
                const mimeTypeActual = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                const dataUrl = await this.fileToDataUrl(filePath, mimeTypeActual);
                extractionContent = this.buildVlmPayloadMarker("image", dataUrl);
                isFastPath = true;
                isMultimodalFastPath = true;
                multimodalModality = "image";
                logger.info(`Smart Triage: Re-run image ${filename} routed to Fast Path using native VLM (${llmModel}).`);
                Actuator.logEvent(ingestionId, userId, "info", "Triage", { action: "VLM Fast Path selected", type: ext, model: llmModel }, supabase);
            } catch (err) {
                logger.warn(`Failed to read VLM image ${filename} during rerun. Routing to Heavy Path.`, { err });
            }
        } else if (this.IMAGE_EXTS.includes(ext as typeof this.IMAGE_EXTS[number])) {
            logger.info(`Smart Triage: Re-run image ${filename} kept on Heavy Path because ${llmProvider}/${llmModel} is marked vision-unsupported.`);
            Actuator.logEvent(ingestionId, userId, "info", "Triage", {
                action: "VLM skipped (model marked unsupported)",
                type: ext,
                model: llmModel,
                provider: llmProvider
            }, supabase);
        } else if (ext === 'pdf') {
            try {
                const buffer = await fs.readFile(filePath);
                const parser = new PDFParse({ data: buffer });
                const pdfData = await parser.getText();
                if (isPdfTextExtractable(pdfData)) {
                    isFastPath = true;
                    extractionContent = pdfData.text;
                } else if (pdfResolution.shouldAttempt) {
                    // Reuse the already-loaded parse buffer; avoid a second readFile in fileToDataUrl.
                    const dataUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;
                    extractionContent = this.buildVlmPayloadMarker("pdf", dataUrl);
                    isFastPath = true;
                    isMultimodalFastPath = true;
                    multimodalModality = "pdf";
                    logger.info(`Smart Triage: Re-run PDF ${filename} routed to multimodal Fast Path using native VLM (${llmModel}).`);
                    Actuator.logEvent(ingestionId, userId, "info", "Triage", {
                        action: "VLM Fast Path selected",
                        type: "pdf",
                        modality: "pdf",
                        model: llmModel,
                    }, supabase);
                } else {
                    logger.info(`Smart Triage: Re-run PDF ${filename} kept on Heavy Path because ${llmProvider}/${llmModel} is marked PDF-unsupported.`);
                    Actuator.logEvent(ingestionId, userId, "info", "Triage", {
                        action: "VLM skipped (model marked unsupported)",
                        type: "pdf",
                        modality: "pdf",
                        model: llmModel,
                        provider: llmProvider
                    }, supabase);
                }
            } catch (err) {
                logger.warn(`Failed to parse PDF ${filename} during rerun. Routing to Heavy Path.`, { err });
            }
        }

        if (isFastPath) {
            const [userPolicies, processingSettingsRow, baselineConfig] = await Promise.all([
                PolicyLoader.load(false, supabase),
                supabase.from("user_settings").select("llm_provider, llm_model, embedding_provider, embedding_model").eq("user_id", userId).maybeSingle(),
                BaselineConfigService.getActive(supabase, userId),
            ]);
            const llmSettings = {
                llm_provider: processingSettingsRow.data?.llm_provider ?? undefined,
                llm_model: processingSettingsRow.data?.llm_model ?? undefined,
            };
            const embedSettings = {
                embedding_provider: processingSettingsRow.data?.embedding_provider ?? undefined,
                embedding_model: processingSettingsRow.data?.embedding_model ?? undefined,
            };
            const doc = { filePath, text: extractionContent, ingestionId, userId, supabase };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const baselineTrace: Array<{ timestamp: string; step: string; details?: any }> = [];

            // Fire and forget Semantic Embedding Storage for re-runs
            RAGService.chunkAndEmbed(ingestionId, userId, doc.text, supabase, embedSettings).catch(err => {
                logger.error(`RAG embedding failed during rerun for ${ingestionId}`, err);
            });

            baselineTrace.push({
                timestamp: new Date().toISOString(),
                step: "LLM request (baseline extraction)",
                    details: {
                        provider: llmSettings.llm_provider ?? llmProvider,
                        model: llmSettings.llm_model ?? llmModel,
                        mode: isMultimodalFastPath ? `vision:${multimodalModality ?? "image"}` : "text",
                    }
                });

            const baselineResult = await PolicyEngine.extractBaseline(
                doc,
                { context: baselineConfig?.context, fields: baselineConfig?.fields },
                llmSettings
            );
            const baselineEntities = baselineResult.entities;
            const autoTags = baselineResult.tags;
            baselineTrace.push({
                timestamp: new Date().toISOString(),
                step: "LLM response (baseline extraction)",
                details: {
                    entities_count: Object.keys(baselineEntities).length,
                    uncertain_count: baselineResult.uncertain_fields.length,
                    tags_count: autoTags.length,
                }
            });

            const entityLines = Object.entries(baselineEntities)
                .filter(([, v]) => v != null)
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}`);
            const enrichedDoc = entityLines.length > 0
                ? { ...doc, text: doc.text + "\n\n[Extracted fields]\n" + entityLines.join("\n") }
                : doc;

            let finalStatus = "no_match";
            let result: import("./PolicyEngine.js").ProcessingResult;
            let policyName;
            try {
                const forcedPolicyId = opts.forcedPolicyId?.trim();
                const activePolicies = forcedPolicyId
                    ? userPolicies.filter((policy) => policy.metadata.id === forcedPolicyId)
                    : userPolicies;

                if (forcedPolicyId && activePolicies.length === 0) {
                    throw new Error(`Policy "${forcedPolicyId}" was not found or is disabled.`);
                }

                if (activePolicies.length > 0) {
                    result = await PolicyEngine.processWithPolicies(
                        enrichedDoc,
                        activePolicies,
                        llmSettings,
                        baselineEntities,
                        {
                            ...(forcedPolicyId ? { forcedPolicyId } : {}),
                            allowLearnedFallback: !forcedPolicyId,
                        }
                    );
                } else {
                    result = await PolicyEngine.process(enrichedDoc, llmSettings, baselineEntities);
                }

                policyName = result.matchedPolicy ? activePolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name : undefined;
                finalStatus = result.status === "fallback" ? "no_match" : result.status;
                const mergedExtracted = { ...baselineEntities, ...result.extractedData };

                // Preserve any human-added tags; merge with freshly generated auto-tags.
                const existingTags: string[] = Array.isArray(ingestion.tags) ? ingestion.tags : [];
                const mergedTags = [...new Set([...autoTags, ...existingTags])];
                let rerunTrace = [
                    ...(ingestion.trace || []),
                    { timestamp: new Date().toISOString(), step: "--- Re-run Initiated ---" },
                    ...baselineTrace,
                    ...(result.trace || [])
                ];

                await supabase
                    .from("ingestions")
                    .update({
                        status: finalStatus,
                        policy_id: result.matchedPolicy,
                        policy_name: policyName,
                        extracted: mergedExtracted,
                        actions_taken: result.actionsExecuted,
                        trace: rerunTrace,
                        tags: mergedTags,
                        baseline_config_id: baselineConfig?.id ?? null,
                    })
                    .eq("id", ingestionId);

                if (isMultimodalFastPath && multimodalModality) {
                    const embeddingMeta = this.queueVlmSemanticEmbedding({
                        ingestionId,
                        userId,
                        filename,
                        finalStatus,
                        policyName,
                        extracted: mergedExtracted,
                        tags: mergedTags,
                        modality: multimodalModality,
                        supabase,
                        embedSettings,
                    });
                    rerunTrace = [
                        ...rerunTrace,
                        {
                            timestamp: new Date().toISOString(),
                            step: "Queued synthetic VLM embedding",
                            details: embeddingMeta,
                        }
                    ];
                    await supabase
                        .from("ingestions")
                        .update({ trace: rerunTrace })
                        .eq("id", ingestionId);
                }

                if (isMultimodalFastPath && multimodalModality) {
                    await ModelCapabilityService.learnVisionSuccess({
                        supabase,
                        userId,
                        provider: llmSettings.llm_provider ?? llmProvider,
                        model: llmSettings.llm_model ?? llmModel,
                        modality: multimodalModality,
                    });
                }

                return finalStatus === "matched";
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (isMultimodalFastPath && multimodalModality) {
                    const learnedState = await ModelCapabilityService.learnVisionFailure({
                        supabase,
                        userId,
                        provider: llmProvider,
                        model: llmModel,
                        error: err,
                        modality: multimodalModality,
                    });
                    logger.warn(`VLM extraction failed during rerun for ${filename}. Falling back to Heavy Path. Error: ${msg}`);
                    Actuator.logEvent(ingestionId, userId, "error", "Processing", {
                        action: "VLM Failed, Fallback to Heavy",
                        error: msg,
                        learned_state: learnedState,
                    }, supabase);
                    isFastPath = false; // Trigger heavy path fallthrough
                } else {
                    throw err; // Re-throw to caller
                }
            }
        }

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

    /**
     * Manually assign an ingestion to a policy and optionally persist it as
     * learning feedback for future automatic matching.
     */
    static async matchToPolicy(
        ingestionId: string,
        policyId: string,
        supabase: SupabaseClient,
        userId: string,
        opts: { learn?: boolean; rerun?: boolean; allowSideEffects?: boolean } = {}
    ): Promise<Ingestion> {
        const learn = opts.learn !== false;
        const rerun = opts.rerun !== false;
        const allowSideEffects = opts.allowSideEffects === true;
        const normalizedPolicyId = policyId.trim();
        if (!normalizedPolicyId) {
            throw new Error("policy_id is required");
        }

        const { data: ingestion, error: ingestionError } = await supabase
            .from("ingestions")
            .select("*")
            .eq("id", ingestionId)
            .eq("user_id", userId)
            .single();
        if (ingestionError || !ingestion) {
            throw new Error("Ingestion not found");
        }

        if (ingestion.status === "processing" || ingestion.status === "pending") {
            throw new Error("Cannot manually match while ingestion is still processing");
        }

        const policies = await PolicyLoader.load(false, supabase);
        const policy = policies.find((item) => item.metadata.id === normalizedPolicyId);
        if (!policy) {
            throw new Error(`Policy "${normalizedPolicyId}" was not found or is disabled.`);
        }

        const riskyActions = this.listNonIdempotentPolicyActions(policy);
        if (rerun && riskyActions.length > 0 && !allowSideEffects) {
            throw new Error(
                `Re-running this policy may trigger side-effect actions (${riskyActions.join(", ")}). ` +
                "Confirm allow_side_effects=true to continue."
            );
        }

        let effectiveIngestion: Ingestion;
        if (rerun) {
            Actuator.logEvent(ingestionId, userId, "info", "Policy Matching", {
                action: "Manual match requested with rerun",
                policyId: policy.metadata.id,
                policyName: policy.metadata.name,
                learn,
                risky_actions: riskyActions,
            }, supabase);

            await this.rerun(ingestionId, supabase, userId, { forcedPolicyId: policy.metadata.id });
            const refreshed = await this.get(ingestionId, supabase, userId);
            if (!refreshed) {
                throw new Error("Ingestion not found after rerun.");
            }
            effectiveIngestion = refreshed;
        } else {
            const nextTrace = [
                ...(Array.isArray(ingestion.trace) ? ingestion.trace : []),
                {
                    timestamp: new Date().toISOString(),
                    step: "Manual policy match override",
                    details: {
                        policyId: policy.metadata.id,
                        policyName: policy.metadata.name,
                        learn,
                        rerun,
                    }
                }
            ];

            const { data: updatedIngestion, error: updateError } = await supabase
                .from("ingestions")
                .update({
                    status: "matched",
                    policy_id: policy.metadata.id,
                    policy_name: policy.metadata.name,
                    error_message: null,
                    trace: nextTrace,
                })
                .eq("id", ingestionId)
                .eq("user_id", userId)
                .select("*")
                .single();

            if (updateError || !updatedIngestion) {
                throw new Error(`Failed to update ingestion policy match: ${updateError?.message ?? "unknown error"}`);
            }
            effectiveIngestion = updatedIngestion as Ingestion;
        }

        Actuator.logEvent(ingestionId, userId, "info", "Policy Matching", {
            action: rerun ? "Manual policy match override + rerun" : "Manual policy match override",
            policyId: policy.metadata.id,
            policyName: policy.metadata.name,
            learn,
            rerun,
        }, supabase);

        if (learn) {
            await PolicyLearningService.recordManualMatch({
                supabase,
                userId,
                ingestion: effectiveIngestion,
                policyId: policy.metadata.id,
                policyName: policy.metadata.name,
            });
        }

        return effectiveIngestion;
    }

    /**
     * Generate a user-reviewable refinement draft for an existing policy
     * using evidence from a specific ingestion.
     */
    static async suggestPolicyRefinement(
        ingestionId: string,
        policyId: string,
        supabase: SupabaseClient,
        userId: string,
        opts: { provider?: string; model?: string } = {}
    ): Promise<{ policy: FolioPolicy; rationale: string[] }> {
        const normalizedPolicyId = policyId.trim();
        if (!normalizedPolicyId) {
            throw new Error("policy_id is required");
        }

        const { data: ingestion, error: ingestionError } = await supabase
            .from("ingestions")
            .select("id,filename,mime_type,status,tags,summary,extracted,trace")
            .eq("id", ingestionId)
            .eq("user_id", userId)
            .single();

        if (ingestionError || !ingestion) {
            throw new Error("Ingestion not found");
        }

        const policies = await PolicyLoader.load(false, supabase);
        const targetPolicy = policies.find((policy) => policy.metadata.id === normalizedPolicyId);
        if (!targetPolicy) {
            throw new Error(`Policy "${normalizedPolicyId}" was not found or is disabled.`);
        }

        const suggestion = await PolicyEngine.suggestPolicyRefinement(
            targetPolicy,
            {
                ingestionId,
                filename: ingestion.filename as string,
                mimeType: (ingestion.mime_type as string | null | undefined) ?? null,
                status: String(ingestion.status ?? ""),
                summary: (ingestion.summary as string | null | undefined) ?? null,
                tags: Array.isArray(ingestion.tags) ? ingestion.tags.map((tag) => String(tag)) : [],
                extracted: (ingestion.extracted as Record<string, unknown> | null | undefined) ?? {},
                trace: Array.isArray(ingestion.trace) ? ingestion.trace as Array<{ timestamp: string; step: string; details?: unknown }> : [],
            },
            {
                provider: opts.provider,
                model: opts.model,
                userId,
                supabase,
            }
        );

        if (!suggestion.policy) {
            throw new Error(suggestion.error || "Unable to generate policy refinement suggestion.");
        }

        return {
            policy: suggestion.policy,
            rationale: suggestion.rationale,
        };
    }

    /**
     * List ingestions for a user, newest first.
     * Supports server-side pagination and ILIKE search across native text columns
     * (filename, policy_name, summary). Tags are handled client-side via the
     * filter bar; extracted JSONB search requires a tsvector migration (deferred).
     */
    static async list(
        supabase: SupabaseClient,
        userId: string,
        opts: { page?: number; pageSize?: number; query?: string } = {}
    ): Promise<{ ingestions: Ingestion[]; total: number }> {
        const { page = 1, pageSize = 20, query } = opts;
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let q = supabase
            .from("ingestions")
            .select("*", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (query?.trim()) {
            const term = `%${query.trim()}%`;
            // PostgREST .or() only supports native column types — no ::cast expressions.
            // Searching filename, policy_name, and summary covers the most practical cases.
            q = q.or(
                `filename.ilike.${term},` +
                `policy_name.ilike.${term},` +
                `summary.ilike.${term}`
            );
        }

        q = q.range(from, to);

        const { data, error, count } = await q;
        if (error) throw new Error(`Failed to list ingestions: ${error.message}`);
        return { ingestions: data as Ingestion[], total: count ?? 0 };
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
            Actuator.logEvent(id, userId, "analysis", "Summary Generation", {
                action: "LLM request (summary generation)",
                provider,
                model,
                extracted_fields_count: entityLines.length,
                filename: ing.filename,
            }, supabase);
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

            const summary: string = extractLlmResponse(result);
            Actuator.logEvent(id, userId, "analysis", "Summary Generation", {
                action: "LLM response (summary generation)",
                provider,
                model,
                raw_length: summary.length,
                raw_preview: previewLlmText(summary),
            }, supabase);

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
            const msg = err instanceof Error ? err.message : String(err);
            Actuator.logEvent(id, userId, "error", "Summary Generation", {
                action: "LLM summary generation failed",
                provider,
                model,
                error: msg,
            }, supabase);
            return null;
        }
    }
}
