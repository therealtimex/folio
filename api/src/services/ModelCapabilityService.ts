import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";
import { SDKService } from "./SDKService.js";

const logger = createLogger("ModelCapabilityService");

export type VisionCapabilityState = "supported" | "unsupported" | "unknown";

interface StoredVisionCapability {
    state: "supported" | "unsupported";
    learned_at: string;
    expires_at?: string;
    reason?: string;
}

type VisionCapabilityMap = Record<string, StoredVisionCapability>;

interface SettingsLike {
    llm_provider?: string | null;
    llm_model?: string | null;
    vision_model_capabilities?: unknown;
}

export interface VisionResolution {
    provider: string;
    model: string;
    state: VisionCapabilityState;
    shouldAttempt: boolean;
}

export class ModelCapabilityService {
    private static readonly SUPPORTED_TTL_DAYS = 180;
    private static readonly UNSUPPORTED_TTL_DAYS = 30;

    static resolveVisionSupport(settingsRow: SettingsLike | null | undefined): VisionResolution {
        const provider = (settingsRow?.llm_provider || SDKService.DEFAULT_LLM_PROVIDER).trim();
        const model = (settingsRow?.llm_model || SDKService.DEFAULT_LLM_MODEL).trim();
        const state = this.getVisionState(settingsRow?.vision_model_capabilities, provider, model);
        return {
            provider,
            model,
            state,
            shouldAttempt: state !== "unsupported",
        };
    }

    static getVisionState(rawMap: unknown, provider: string, model: string): VisionCapabilityState {
        const map = this.normalizeCapabilityMap(rawMap);
        const entry = map[this.capabilityKey(provider, model)];
        if (!entry) return "unknown";

        if (entry.expires_at) {
            const expiryTs = Date.parse(entry.expires_at);
            if (Number.isFinite(expiryTs) && expiryTs <= Date.now()) {
                return "unknown";
            }
        }

        return entry.state;
    }

    static async learnVisionSuccess(opts: {
        supabase: SupabaseClient;
        userId: string;
        provider: string;
        model: string;
    }): Promise<void> {
        await this.writeCapability({
            ...opts,
            state: "supported",
            reason: "vision_request_succeeded",
            ttlDays: this.SUPPORTED_TTL_DAYS,
        });
    }

    static async learnVisionFailure(opts: {
        supabase: SupabaseClient;
        userId: string;
        provider: string;
        model: string;
        error: unknown;
    }): Promise<VisionCapabilityState> {
        const classification = this.classifyVisionFailure(opts.error);
        if (!classification.isCapabilityError) {
            logger.info(`Vision failure for ${opts.provider}/${opts.model} treated as transient; leaving capability unknown`, {
                reason: classification.reason,
            });
            return "unknown";
        }

        await this.writeCapability({
            supabase: opts.supabase,
            userId: opts.userId,
            provider: opts.provider,
            model: opts.model,
            state: "unsupported",
            reason: classification.reason,
            ttlDays: this.UNSUPPORTED_TTL_DAYS,
        });
        return "unsupported";
    }

    private static async writeCapability(opts: {
        supabase: SupabaseClient;
        userId: string;
        provider: string;
        model: string;
        state: "supported" | "unsupported";
        reason: string;
        ttlDays: number;
    }): Promise<void> {
        const { supabase, userId, provider, model, state, reason, ttlDays } = opts;
        const { data, error: readErr } = await supabase
            .from("user_settings")
            .select("vision_model_capabilities")
            .eq("user_id", userId)
            .maybeSingle();

        if (readErr) {
            logger.warn("Failed to read user_settings for model capability write", { userId, readErr });
            return;
        }

        const map = this.normalizeCapabilityMap(data?.vision_model_capabilities);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
        map[this.capabilityKey(provider, model)] = {
            state,
            learned_at: now.toISOString(),
            expires_at: expiresAt,
            reason,
        };

        const { error: writeErr } = await supabase
            .from("user_settings")
            .upsert(
                {
                    user_id: userId,
                    vision_model_capabilities: map,
                },
                { onConflict: "user_id" }
            );

        if (writeErr) {
            logger.warn("Failed to persist model capability state", { userId, provider, model, state, writeErr });
            return;
        }

        logger.info(`Updated model capability for ${provider}/${model}: ${state}`, { reason, ttlDays });
    }

    private static normalizeCapabilityMap(rawMap: unknown): VisionCapabilityMap {
        if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
            return {};
        }

        const parsed = rawMap as Record<string, unknown>;
        const normalized: VisionCapabilityMap = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                continue;
            }
            const state = String((value as Record<string, unknown>).state || "");
            if (state !== "supported" && state !== "unsupported") {
                continue;
            }

            const learnedAt = (value as Record<string, unknown>).learned_at;
            const expiresAt = (value as Record<string, unknown>).expires_at;
            const reason = (value as Record<string, unknown>).reason;

            normalized[key] = {
                state,
                learned_at: typeof learnedAt === "string" ? learnedAt : new Date(0).toISOString(),
                expires_at: typeof expiresAt === "string" ? expiresAt : undefined,
                reason: typeof reason === "string" ? reason : undefined,
            };
        }

        return normalized;
    }

    private static capabilityKey(provider: string, model: string): string {
        return `${provider.toLowerCase().trim()}:${model.toLowerCase().trim()}`;
    }

    private static classifyVisionFailure(error: unknown): { isCapabilityError: boolean; reason: string } {
        const message = this.errorToMessage(error).toLowerCase();
        if (!message) return { isCapabilityError: false, reason: "empty_error" };

        const hardCapabilityHints = [
            "does not support images",
            "model does not support image",
            "invalid model", // e.g. text-only models fed image payloads in realtimexai provider
        ];

        if (hardCapabilityHints.some((hint) => message.includes(hint))) {
            return { isCapabilityError: true, reason: "capability_mismatch" };
        }

        const documentSpecificHints = [
            "image_url",
            "vision",
            "multimodal",
            "multi-modal",
            "unsupported content type",
            "unsupported message content",
            "invalid content type",
            "invalid image",
            "unrecognized content type",
            "image too large",
            "base64",
        ];

        if (documentSpecificHints.some((hint) => message.includes(hint))) {
            return { isCapabilityError: false, reason: "document_specific_failure" };
        }

        const transientHints = [
            "timeout",
            "timed out",
            "rate limit",
            "too many requests",
            "429",
            "503",
            "502",
            "504",
            "service unavailable",
            "temporar",
            "network",
            "connection",
            "unauthorized",
            "forbidden",
            "invalid api key",
        ];

        if (transientHints.some((hint) => message.includes(hint))) {
            return { isCapabilityError: false, reason: "transient_or_auth" };
        }

        return { isCapabilityError: false, reason: "unknown_error_class" };
    }

    private static errorToMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === "string") return error;
        if (error && typeof error === "object") {
            const candidate = error as Record<string, unknown>;
            if (typeof candidate.message === "string") return candidate.message;
            try {
                return JSON.stringify(error);
            } catch {
                return String(error);
            }
        }
        return String(error ?? "");
    }
}
