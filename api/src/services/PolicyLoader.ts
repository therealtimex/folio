import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("PolicyLoader");

// ─── Types ─────────────────────────────────────────────────────────────────

export type MatchStrategy = "ALL" | "ANY";
export type ConditionType = "keyword" | "llm_verify" | "semantic";

export interface MatchCondition {
    type: ConditionType;
    value?: string | string[];
    prompt?: string;
    confidence_threshold?: number;
    case_sensitive?: boolean;
}

export interface ExtractField {
    key: string;
    type: "string" | "currency" | "date" | "number";
    description: string;
    required?: boolean;
    format?: string;
    transformers?: { name: string; as: string }[];
}

export type ActionType = "rename" | "move" | "log_csv" | "notify";

export interface PolicyAction {
    type: ActionType;
    pattern?: string;
    destination?: string;
    path?: string;
    columns?: string[];
    message?: string;
}

export interface FolioPolicy {
    apiVersion: "folio/v1";
    kind: "Policy" | "Splitter";
    metadata: {
        id: string;
        name: string;
        version: string;
        description: string;
        priority: number;
        tags?: string[];
        enabled?: boolean;
    };
    spec: {
        match: {
            strategy: MatchStrategy;
            conditions: MatchCondition[];
        };
        extract?: ExtractField[];
        actions?: PolicyAction[];
    };
}

// ─── Cache ───────────────────────────────────────────────────────────────────

let _cache: FolioPolicy[] | null = null;
let _lastLoad = 0;
const CACHE_TTL_MS = 30_000;

// ─── Row → Policy ────────────────────────────────────────────────────────────

function rowToPolicy(row: any): FolioPolicy {
    return {
        apiVersion: row.api_version ?? "folio/v1",
        kind: row.kind ?? "Policy",
        metadata: {
            ...row.metadata,
            id: row.policy_id,
            priority: row.priority,
            enabled: row.enabled,
        },
        spec: row.spec,
    };
}

// ─── PolicyLoader ────────────────────────────────────────────────────────────

export class PolicyLoader {

    /**
     * Load all policies for the authenticated user from Supabase.
     * Returns [] if no Supabase client is provided (unauthenticated state).
     */
    static async load(forceRefresh = false, supabase?: SupabaseClient | null): Promise<FolioPolicy[]> {
        if (!supabase) {
            logger.info("No Supabase client — policies require authentication");
            return [];
        }

        const now = Date.now();
        if (!forceRefresh && _cache && now - _lastLoad < CACHE_TTL_MS) {
            return _cache;
        }

        try {
            const { data, error } = await supabase
                .from("policies")
                .select("*")
                .eq("enabled", true)
                .order("priority", { ascending: false });

            if (error) throw error;

            const policies = (data ?? []).map(rowToPolicy);
            _cache = policies;
            _lastLoad = Date.now();
            logger.info(`Loaded ${policies.length} policies from DB`);
            return policies;
        } catch (err) {
            logger.error("Failed to load policies from DB", { err });
            return [];
        }
    }

    static invalidateCache() {
        _cache = null;
        _lastLoad = 0;
    }

    static validate(policy: unknown): policy is FolioPolicy {
        if (!policy || typeof policy !== "object") return false;
        const p = policy as Partial<FolioPolicy>;
        return (
            p.apiVersion === "folio/v1" &&
            typeof p.metadata?.id === "string" &&
            typeof p.metadata?.priority === "number" &&
            typeof p.spec?.match?.strategy === "string" &&
            Array.isArray(p.spec?.match?.conditions)
        );
    }

    /**
     * Save (upsert) a policy to Supabase.
     * Throws if no Supabase client is available.
     */
    static async save(policy: FolioPolicy, supabase?: SupabaseClient | null, userId?: string): Promise<string> {
        if (!supabase || !userId) {
            throw new Error("Authentication required to save policies");
        }

        const row = {
            user_id: userId,
            policy_id: policy.metadata.id,
            api_version: policy.apiVersion,
            kind: policy.kind,
            metadata: policy.metadata,
            spec: policy.spec,
            enabled: policy.metadata.enabled ?? true,
            priority: policy.metadata.priority,
        };

        const { error } = await supabase
            .from("policies")
            .upsert(row, { onConflict: "user_id,policy_id" });

        if (error) throw new Error(`Failed to save policy: ${error.message}`);

        this.invalidateCache();
        logger.info(`Saved policy to DB: ${policy.metadata.id}`);
        return `db:policies/${policy.metadata.id}`;
    }

    /**
     * Partially update a policy (enabled toggle, name, description, tags, priority).
     */
    static async patch(
        policyId: string,
        patch: { enabled?: boolean; name?: string; description?: string; tags?: string[]; priority?: number },
        supabase?: SupabaseClient | null,
        userId?: string
    ): Promise<boolean> {
        if (!supabase || !userId) {
            throw new Error("Authentication required to update policies");
        }

        const { data: existing, error: fetchErr } = await supabase
            .from("policies")
            .select("metadata, priority, enabled")
            .eq("policy_id", policyId)
            .eq("user_id", userId)
            .single();

        if (fetchErr || !existing) throw new Error("Policy not found");

        const updatedMetadata = {
            ...existing.metadata,
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.tags !== undefined && { tags: patch.tags }),
            ...(patch.priority !== undefined && { priority: patch.priority }),
        };

        const { error } = await supabase
            .from("policies")
            .update({
                metadata: updatedMetadata,
                enabled: patch.enabled ?? existing.enabled,
                priority: patch.priority ?? existing.priority,
            })
            .eq("policy_id", policyId)
            .eq("user_id", userId);

        if (error) throw new Error(`Failed to patch policy: ${error.message}`);

        this.invalidateCache();
        logger.info(`Patched policy: ${policyId}`);
        return true;
    }

    /**
     * Delete a policy by ID from Supabase.
     * Throws if no Supabase client is available.
     */
    static async delete(policyId: string, supabase?: SupabaseClient | null, userId?: string): Promise<boolean> {
        if (!supabase || !userId) {
            throw new Error("Authentication required to delete policies");
        }

        const { error, count } = await supabase
            .from("policies")
            .delete({ count: "exact" })
            .eq("policy_id", policyId)
            .eq("user_id", userId);

        if (error) throw new Error(`Failed to delete policy: ${error.message}`);

        this.invalidateCache();
        return (count ?? 0) > 0;
    }
}
