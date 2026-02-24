import type { SupabaseClient } from "@supabase/supabase-js";
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

// ─── Service ─────────────────────────────────────────────────────────────────

export class IngestionService {

    /**
     * Ingest a document: create a record, run it through FPE, update with results.
     */
    static async ingest(opts: {
        supabase: SupabaseClient;
        userId: string;
        filename: string;
        mimeType?: string;
        fileSize?: number;
        source?: IngestionSource;
        content: string;          // extracted text content of the document
        storagePath?: string;
    }): Promise<Ingestion> {
        const { supabase, userId, filename, mimeType, fileSize, source = "upload", content, storagePath } = opts;

        // 1. Insert processing record
        const { data: row, error: insertErr } = await supabase
            .from("ingestions")
            .insert({
                user_id: userId,
                source,
                filename,
                mime_type: mimeType,
                file_size: fileSize,
                status: "processing",
                storage_path: storagePath,
            })
            .select()
            .single();

        if (insertErr || !row) {
            throw new Error(`Failed to create ingestion record: ${insertErr?.message}`);
        }

        logger.info(`Processing ingestion ${row.id}: ${filename}`);

        try {
            // 2. Run through FPE — PolicyEngine.process() handles policy loading internally,
            //    but we override it by passing the user's supabase client via PolicyLoader.load()
            //    to ensure user-scoped policies are evaluated.
            const userPolicies = await PolicyLoader.load(false, supabase);

            // Build a virtual DocumentObject
            const doc = { filePath: filename, text: content };

            let result;
            if (userPolicies.length > 0) {
                // Run against user's own policies
                result = await PolicyEngine.processWithPolicies(doc, userPolicies);
            } else {
                result = await PolicyEngine.process(doc);
            }

            const isFallback = result.status === "fallback";
            const status: IngestionStatus = result.status === "matched" ? "matched"
                : isFallback ? "no_match"
                    : "error";

            const { data: updated } = await supabase
                .from("ingestions")
                .update({
                    status,
                    policy_id: result.matchedPolicy ?? null,
                    policy_name: userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name ?? null,
                    extracted: result.extractedData ?? {},
                    actions_taken: result.actionsExecuted ?? [],
                    error_message: result.error ?? null,
                })
                .eq("id", row.id)
                .select()
                .single();

            logger.info(`Ingestion ${row.id} → status: ${status}`);
            return updated ?? { ...row, status };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await supabase
                .from("ingestions")
                .update({ status: "error", error_message: msg })
                .eq("id", row.id);
            logger.error(`Ingestion ${row.id} failed`, { err });
            return { ...row, status: "error", error_message: msg } as Ingestion;
        }
    }

    /**
     * Re-run an existing ingestion using the stored filename as content context.
     */
    static async rerun(ingestionId: string, supabase: SupabaseClient, userId: string): Promise<boolean> {
        const { data: row, error } = await supabase
            .from("ingestions")
            .select("*")
            .eq("id", ingestionId)
            .eq("user_id", userId)
            .single();

        if (error || !row) throw new Error("Ingestion not found");

        await supabase
            .from("ingestions")
            .update({ status: "processing", error_message: null, policy_id: null, policy_name: null, extracted: {}, actions_taken: [] })
            .eq("id", ingestionId);

        const content = `Document: ${row.filename}`;
        const userPolicies = await PolicyLoader.load(false, supabase);
        const doc = { filePath: row.filename, text: content };

        let result;
        if (userPolicies.length > 0) {
            result = await PolicyEngine.processWithPolicies(doc, userPolicies);
        } else {
            result = await PolicyEngine.process(doc);
        }

        const status: IngestionStatus = result.status === "matched" ? "matched"
            : result.status === "fallback" ? "no_match" : "error";

        await supabase
            .from("ingestions")
            .update({
                status,
                policy_id: result.matchedPolicy ?? null,
                policy_name: userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name ?? null,
                extracted: result.extractedData ?? {},
                actions_taken: result.actionsExecuted ?? [],
                error_message: result.error ?? null,
            })
            .eq("id", ingestionId);

        return status === "matched";
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
        return data ?? [];
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
        return data ?? null;
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
