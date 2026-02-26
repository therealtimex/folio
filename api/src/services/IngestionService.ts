import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import { createLogger } from "../utils/logger.js";
import { PolicyLoader } from "./PolicyLoader.js";
import { PolicyEngine } from "./PolicyEngine.js";

const logger = createLogger("IngestionService");

export type IngestionStatus = "pending" | "processing" | "matched" | "no_match" | "error";
export type IngestionSource = "upload" | "dropzone" | "email" | "url";

export interface Ingestion {
    id: string;
    user_id: string;
    source: IngestionSource;
    filename: string;
    mime_type?: string;
    file_size?: number;
    status: IngestionStatus;
    policy_id?: string;
    policy_name?: string;
    extracted?: Record<string, unknown>;
    actions_taken?: string[];
    error_message?: string;
    storage_path?: string;
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
    }): Promise<Ingestion> {
        const { supabase, userId, filename, mimeType, fileSize, source = "upload", filePath, content } = opts;

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
                status: "processing"
            })
            .select()
            .single();

        if (insertErr || !ingestion) throw new Error(`Failed to create ingestion record: ${insertErr?.message}`);

        logger.info(`Processing ingestion ${ingestion.id}: ${filename}`);

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
                if (pdfData.text && pdfData.text.trim().length > 50) {
                    isFastPath = true;
                    extractionContent = pdfData.text;
                    logger.info(`Smart Triage: PDF ${filename} has extractable text. Routing to Fast Path.`);
                } else {
                    logger.info(`Smart Triage: PDF ${filename} has minimal/no text. Routing to Heavy Path.`);
                }
            } catch (err) {
                logger.warn(`Failed to parse PDF ${filename}. Routing to Heavy Path.`, { err });
            }
        }

        if (isFastPath) {
            try {
                // 3. Fast Path (Local Policy Engine)
                const userPolicies = await PolicyLoader.load(false, supabase);
                const doc = { filePath: filename, text: extractionContent };

                let result;
                if (userPolicies.length > 0) {
                    result = await PolicyEngine.processWithPolicies(doc, userPolicies);
                } else {
                    result = await PolicyEngine.process(doc);
                }

                const policyName = userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name;
                const finalStatus = result.status === "fallback" ? "no_match" : result.status;

                const { data: updatedIngestion } = await supabase
                    .from("ingestions")
                    .update({
                        status: finalStatus,
                        policy_id: result.matchedPolicy,
                        policy_name: policyName,
                        extracted: result.extractedData,
                        actions_taken: result.actionsExecuted
                    })
                    .eq("id", ingestion.id)
                    .select()
                    .single();

                return updatedIngestion as Ingestion;

            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
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
            .update({ status: "processing", error_message: null, policy_id: null, policy_name: null, extracted: {}, actions_taken: [] })
            .eq("id", ingestionId);

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
                if (pdfData.text && pdfData.text.trim().length > 50) {
                    isFastPath = true;
                    extractionContent = pdfData.text;
                }
            } catch (err) {
                // ignore
            }
        }

        if (isFastPath) {
            const userPolicies = await PolicyLoader.load(false, supabase);
            const doc = { filePath, text: extractionContent };

            let result;
            if (userPolicies.length > 0) {
                result = await PolicyEngine.processWithPolicies(doc, userPolicies);
            } else {
                result = await PolicyEngine.process(doc);
            }

            const policyName = userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name;
            const finalStatus = result.status === "fallback" ? "no_match" : result.status;

            await supabase
                .from("ingestions")
                .update({
                    status: finalStatus,
                    policy_id: result.matchedPolicy,
                    policy_name: policyName,
                    extracted: result.extractedData,
                    actions_taken: result.actionsExecuted
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
}
