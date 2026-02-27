import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("BaselineConfigService");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BaselineField {
    key: string;
    type: "string" | "number" | "date" | "currency" | "string[]";
    description: string;
    enabled: boolean;
    is_default: boolean; // default fields can be disabled but not deleted
}

export interface BaselineConfig {
    id: string;
    user_id: string;
    version: number;
    context: string | null;
    fields: BaselineField[];
    is_active: boolean;
    created_at: string;
}

// ─── Default schema ───────────────────────────────────────────────────────────

export const DEFAULT_BASELINE_FIELDS: BaselineField[] = [
    {
        key: "document_type",
        type: "string",
        description: 'Type of document (e.g. "invoice", "contract", "receipt", "report", "statement")',
        enabled: true,
        is_default: true,
    },
    {
        key: "issuer",
        type: "string",
        description: "Person or organisation that sent or issued the document",
        enabled: true,
        is_default: true,
    },
    {
        key: "recipient",
        type: "string",
        description: "Person or organisation the document is addressed to",
        enabled: true,
        is_default: true,
    },
    {
        key: "date",
        type: "date",
        description: "Primary date on the document in ISO 8601 format (YYYY-MM-DD)",
        enabled: true,
        is_default: true,
    },
    {
        key: "amount",
        type: "currency",
        description: "Primary monetary value if present (numeric, no currency symbol)",
        enabled: true,
        is_default: true,
    },
    {
        key: "currency",
        type: "string",
        description: 'Three-letter currency code if present (e.g. "USD", "EUR", "GBP")',
        enabled: true,
        is_default: true,
    },
    {
        key: "subject",
        type: "string",
        description: "One-sentence description of what this document is about",
        enabled: true,
        is_default: true,
    },
    {
        key: "tags",
        type: "string[]",
        description: 'Semantic labels that describe this document (e.g. ["subscription", "renewal", "tax", "refund"])',
        enabled: true,
        is_default: true,
    },
    {
        key: "suggested_filename",
        type: "string",
        description: 'A highly descriptive, concise filename for this document using the format: YYYY-MM-DD_Issuer_DocType. Do not include file extensions. If date is missing, omit it.',
        enabled: true,
        is_default: true,
    }
];

// ─── Service ──────────────────────────────────────────────────────────────────

export class BaselineConfigService {
    /**
     * Return the active config for a user.
     * Returns null if none has been saved yet — callers should fall back to DEFAULT_BASELINE_FIELDS.
     */
    static async getActive(supabase: SupabaseClient, userId: string): Promise<BaselineConfig | null> {
        const { data, error } = await supabase
            .from("baseline_configs")
            .select("*")
            .eq("user_id", userId)
            .eq("is_active", true)
            .maybeSingle();

        if (error) {
            logger.warn("Failed to fetch active baseline config", { error });
            return null;
        }
        return data as BaselineConfig | null;
    }

    /**
     * Return all saved versions for a user, newest first.
     */
    static async list(supabase: SupabaseClient, userId: string): Promise<BaselineConfig[]> {
        const { data, error } = await supabase
            .from("baseline_configs")
            .select("*")
            .eq("user_id", userId)
            .order("version", { ascending: false });

        if (error) throw new Error(`Failed to list baseline configs: ${error.message}`);
        return (data ?? []) as BaselineConfig[];
    }

    /**
     * Save a new config version.
     * Always creates a new immutable row — never mutates existing versions.
     * If activate=true, the new version is immediately set as active and the
     * previous active version is deactivated.
     */
    static async save(
        supabase: SupabaseClient,
        userId: string,
        payload: { context?: string | null; fields: BaselineField[] },
        activate: boolean
    ): Promise<BaselineConfig> {
        // Determine next version number for this user
        const { data: latest } = await supabase
            .from("baseline_configs")
            .select("version")
            .eq("user_id", userId)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextVersion = (latest?.version ?? 0) + 1;

        if (activate) {
            // Deactivate all existing versions first
            await supabase
                .from("baseline_configs")
                .update({ is_active: false })
                .eq("user_id", userId);
        }

        const { data, error } = await supabase
            .from("baseline_configs")
            .insert({
                user_id: userId,
                version: nextVersion,
                context: payload.context ?? null,
                fields: payload.fields,
                is_active: activate,
            })
            .select()
            .single();

        if (error || !data) throw new Error(`Failed to save baseline config: ${error?.message}`);
        logger.info(`Saved baseline config v${nextVersion} for user ${userId} (active: ${activate})`);
        return data as BaselineConfig;
    }

    /**
     * Activate a specific saved version.
     * Deactivates all other versions for this user atomically.
     */
    static async activate(supabase: SupabaseClient, userId: string, id: string): Promise<boolean> {
        // Verify the config belongs to this user
        const { data: target } = await supabase
            .from("baseline_configs")
            .select("id, version")
            .eq("id", id)
            .eq("user_id", userId)
            .maybeSingle();

        if (!target) return false;

        // Deactivate all, then activate the target
        await supabase
            .from("baseline_configs")
            .update({ is_active: false })
            .eq("user_id", userId);

        const { error } = await supabase
            .from("baseline_configs")
            .update({ is_active: true })
            .eq("id", id);

        if (error) throw new Error(`Failed to activate baseline config: ${error.message}`);
        logger.info(`Activated baseline config v${target.version} for user ${userId}`);
        return true;
    }
}
