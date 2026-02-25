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

// Helper to map rtx_activities row to standard Ingestion interface for the UI
function mapRowToIngestion(row: any): Ingestion {
    let mappedStatus: IngestionStatus = "pending";
    if (row.status === "completed") {
        mappedStatus = row.result?.status === "matched" ? "matched"
            : row.result?.status === "fallback" ? "no_match"
                : "error";
    } else if (row.status === "failed") {
        mappedStatus = "error";
    } else if (row.status === "claimed" || row.status === "processing") {
        mappedStatus = "processing";
    }

    return {
        id: row.id,
        user_id: row.user_id,
        source: row.raw_data?.source ?? "upload",
        filename: row.raw_data?.filename ?? "Unknown",
        mime_type: row.raw_data?.mime_type,
        file_size: row.raw_data?.file_size,
        status: mappedStatus,
        policy_id: row.result?.matchedPolicy ?? null,
        policy_name: row.result?.policy_name ?? null,
        extracted: row.result?.extractedData ?? {},
        actions_taken: row.result?.actionsExecuted ?? [],
        error_message: row.error_message || row.result?.error || null,
        storage_path: row.raw_data?.storage_path,
        created_at: row.created_at,
        updated_at: row.completed_at || row.created_at,
    };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class IngestionService {

    /**
     * Ingest a document using RealTimeX compatible mode (rtx_activities).
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

        // 1. Insert into rtx_activities
        const { data: row, error: insertErr } = await supabase
            .from("rtx_activities")
            .insert({
                user_id: userId,
                status: "processing", // Folio processes immediately for now
                raw_data: { source, filename, mime_type: mimeType, file_size: fileSize, file_path: filePath, content }
            })
            .select()
            .single();

        if (insertErr || !row) throw new Error(`Failed to create ingestion record: ${insertErr?.message}`);

        logger.info(`Processing ingestion (rtx_activities) ${row.id}: ${filename}`);

        try {
            // 2. Run through FPE
            const userPolicies = await PolicyLoader.load(false, supabase);
            const doc = { filePath: filename, text: content };

            let result;
            if (userPolicies.length > 0) {
                result = await PolicyEngine.processWithPolicies(doc, userPolicies);
            } else {
                result = await PolicyEngine.process(doc);
            }

            const policyName = userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name;
            const fullResult = { ...result, policy_name: policyName };

            // 3. Mark completed
            const { error: completeErr } = await supabase.rpc("rtx_fn_complete_task", {
                target_task_id: row.id,
                result_data: fullResult
            });
            if (completeErr) throw new Error(`Failed to log completion: ${completeErr.message}`);

            // Fetch final row state
            const finalRow = (await supabase.from("rtx_activities").select("*").eq("id", row.id).single()).data;
            return mapRowToIngestion(finalRow ?? { ...row, status: "completed", result: fullResult });

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // 4. Mark failed
            await supabase.rpc("rtx_fn_fail_task", {
                target_task_id: row.id,
                machine_id: "folio-local",
                error_msg: msg
            });
            logger.error(`Ingestion ${row.id} failed`, { err });

            const finalRow = (await supabase.from("rtx_activities").select("*").eq("id", row.id).single()).data;
            return mapRowToIngestion(finalRow ?? { ...row, status: "failed", error_message: msg });
        }
    }

    /**
     * Re-run an existing ingestion
     */
    static async rerun(ingestionId: string, supabase: SupabaseClient, userId: string): Promise<boolean> {
        const { data: row, error } = await supabase
            .from("rtx_activities")
            .select("*")
            .eq("id", ingestionId)
            .eq("user_id", userId)
            .single();

        if (error || !row) throw new Error("Ingestion not found");

        await supabase
            .from("rtx_activities")
            .update({ status: "processing", error_message: null, result: null, locked_by: "folio-local" })
            .eq("id", ingestionId);

        const filename = row.raw_data?.filename ?? "Unknown";
        const filePath = row.raw_data?.file_path ?? filename;
        const content = row.raw_data?.content ?? `Document: ${filename}`;

        const userPolicies = await PolicyLoader.load(false, supabase);
        const doc = { filePath, text: content };

        let result;
        if (userPolicies.length > 0) {
            result = await PolicyEngine.processWithPolicies(doc, userPolicies);
        } else {
            result = await PolicyEngine.process(doc);
        }

        const policyName = userPolicies.find((p) => p.metadata.id === result.matchedPolicy)?.metadata.name;
        const fullResult = { ...result, policy_name: policyName };

        const { error: completeErr } = await supabase.rpc("rtx_fn_complete_task", {
            target_task_id: ingestionId,
            result_data: fullResult
        });

        return result.status === "matched" && !completeErr;
    }

    /**
     * List ingestions for a user, newest first.
     */
    static async list(supabase: SupabaseClient, userId: string, limit = 50): Promise<Ingestion[]> {
        const { data, error } = await supabase
            .from("rtx_activities")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) throw new Error(`Failed to list ingestions: ${error.message}`);
        return (data ?? []).map(mapRowToIngestion);
    }

    /**
     * Get a single ingestion by ID.
     */
    static async get(id: string, supabase: SupabaseClient, userId: string): Promise<Ingestion | null> {
        const { data } = await supabase
            .from("rtx_activities")
            .select("*")
            .eq("id", id)
            .eq("user_id", userId)
            .single();
        return data ? mapRowToIngestion(data) : null;
    }

    /**
     * Delete an ingestion record.
     */
    static async delete(id: string, supabase: SupabaseClient, userId: string): Promise<boolean> {
        const { count, error } = await supabase
            .from("rtx_activities")
            .delete({ count: "exact" })
            .eq("id", id)
            .eq("user_id", userId);

        if (error) throw new Error(`Failed to delete ingestion: ${error.message}`);
        return (count ?? 0) > 0;
    }
}
