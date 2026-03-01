import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";
import { SDKService } from "./SDKService.js";

const logger = createLogger("ModelCapabilityService");

export type VisionCapabilityState = "supported" | "unsupported" | "unknown";
type StoredVisionCapabilityState = "supported" | "unsupported" | "pending_unsupported";

interface StoredVisionCapability {
    state: StoredVisionCapabilityState;
    learned_at: string;
    expires_at?: string;
    reason?: string;
    failure_count?: number;
    last_failure_at?: string;
    evidence?: string[];
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

interface VisionFailureSignal {
    message: string;
    statusCodes: Set<number>;
    codes: Set<string>;
}

interface VisionFailureClassification {
    isCapabilityError: boolean;
    reason: string;
    score: number;
    evidence: string[];
}

export class ModelCapabilityService {
    private static readonly SUPPORTED_TTL_MS = 180 * 24 * 60 * 60 * 1000;
    private static readonly UNSUPPORTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    private static readonly PENDING_UNSUPPORTED_TTL_MS = 24 * 60 * 60 * 1000;
    private static readonly UNSUPPORTED_CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
    private static readonly UNSUPPORTED_CONFIRMATION_FAILURES = 2;
    private static readonly UNSUPPORTED_SCORE_THRESHOLD = 3;

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
        if (!entry || this.isExpired(entry)) return "unknown";
        if (entry.state === "pending_unsupported") return "unknown";
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
            ttlMs: this.SUPPORTED_TTL_MS,
        });
    }

    static async learnVisionFailure(opts: {
        supabase: SupabaseClient;
        userId: string;
        provider: string;
        model: string;
        error: unknown;
    }): Promise<VisionCapabilityState> {
        const classification = this.classifyVisionFailure({
            error: opts.error,
            provider: opts.provider,
        });

        if (!classification.isCapabilityError) {
            logger.info(`Vision failure for ${opts.provider}/${opts.model} treated as non-capability; leaving capability unknown`, {
                reason: classification.reason,
                score: classification.score,
                evidence: classification.evidence,
            });
            return "unknown";
        }

        const map = await this.readCapabilityMap(opts.supabase, opts.userId);
        if (!map) {
            return "unknown";
        }

        const key = this.capabilityKey(opts.provider, opts.model);
        const now = new Date();
        const failureCount = this.nextFailureCount(map[key], now.getTime());

        if (failureCount < this.UNSUPPORTED_CONFIRMATION_FAILURES) {
            await this.writeCapability({
                supabase: opts.supabase,
                userId: opts.userId,
                provider: opts.provider,
                model: opts.model,
                state: "pending_unsupported",
                reason: "capability_signal_pending_confirmation",
                ttlMs: this.PENDING_UNSUPPORTED_TTL_MS,
                preloadedMap: map,
                failureCount,
                lastFailureAt: now.toISOString(),
                evidence: classification.evidence,
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
            ttlMs: this.UNSUPPORTED_TTL_MS,
            preloadedMap: map,
            failureCount,
            lastFailureAt: now.toISOString(),
            evidence: classification.evidence,
        });

        return "unsupported";
    }

    private static async readCapabilityMap(supabase: SupabaseClient, userId: string): Promise<VisionCapabilityMap | null> {
        const { data, error } = await supabase
            .from("user_settings")
            .select("vision_model_capabilities")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            logger.warn("Failed to read user_settings for model capability", { userId, error });
            return null;
        }

        return this.normalizeCapabilityMap(data?.vision_model_capabilities);
    }

    private static async persistCapabilityMap(supabase: SupabaseClient, userId: string, map: VisionCapabilityMap): Promise<boolean> {
        const { error } = await supabase
            .from("user_settings")
            .upsert(
                {
                    user_id: userId,
                    vision_model_capabilities: map,
                },
                { onConflict: "user_id" }
            );

        if (error) {
            logger.warn("Failed to persist model capability state", { userId, error });
            return false;
        }

        return true;
    }

    private static async writeCapability(opts: {
        supabase: SupabaseClient;
        userId: string;
        provider: string;
        model: string;
        state: StoredVisionCapabilityState;
        reason: string;
        ttlMs: number;
        preloadedMap?: VisionCapabilityMap;
        failureCount?: number;
        lastFailureAt?: string;
        evidence?: string[];
    }): Promise<void> {
        const {
            supabase,
            userId,
            provider,
            model,
            state,
            reason,
            ttlMs,
            preloadedMap,
            failureCount,
            lastFailureAt,
            evidence,
        } = opts;

        const map = preloadedMap ?? (await this.readCapabilityMap(supabase, userId));
        if (!map) {
            return;
        }

        const now = new Date();
        const key = this.capabilityKey(provider, model);

        const nextEntry: StoredVisionCapability = {
            state,
            learned_at: now.toISOString(),
            expires_at: new Date(now.getTime() + ttlMs).toISOString(),
            reason,
        };

        if (typeof failureCount === "number" && Number.isFinite(failureCount) && failureCount > 0) {
            nextEntry.failure_count = Math.floor(failureCount);
        }

        if (typeof lastFailureAt === "string") {
            nextEntry.last_failure_at = lastFailureAt;
        }

        if (Array.isArray(evidence) && evidence.length > 0) {
            nextEntry.evidence = evidence.slice(0, 5);
        }

        map[key] = nextEntry;

        const persisted = await this.persistCapabilityMap(supabase, userId, map);
        if (!persisted) {
            return;
        }

        logger.info(`Updated model capability for ${provider}/${model}: ${state}`, {
            reason,
            ttlMs,
            failureCount,
            evidence: nextEntry.evidence,
        });
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

            const record = value as Record<string, unknown>;
            const state = String(record.state || "");
            if (state !== "supported" && state !== "unsupported" && state !== "pending_unsupported") {
                continue;
            }

            const learnedAt = record.learned_at;
            const expiresAt = record.expires_at;
            const reason = record.reason;
            const failureCount = record.failure_count;
            const lastFailureAt = record.last_failure_at;
            const evidence = record.evidence;

            const normalizedEntry: StoredVisionCapability = {
                state,
                learned_at: typeof learnedAt === "string" ? learnedAt : new Date(0).toISOString(),
                expires_at: typeof expiresAt === "string" ? expiresAt : undefined,
                reason: typeof reason === "string" ? reason : undefined,
            };

            if (typeof failureCount === "number" && Number.isFinite(failureCount) && failureCount > 0) {
                normalizedEntry.failure_count = Math.floor(failureCount);
            }

            if (typeof lastFailureAt === "string") {
                normalizedEntry.last_failure_at = lastFailureAt;
            }

            if (Array.isArray(evidence)) {
                normalizedEntry.evidence = evidence
                    .filter((item): item is string => typeof item === "string")
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0)
                    .slice(0, 5);
            }

            normalized[key] = normalizedEntry;
        }

        return normalized;
    }

    private static capabilityKey(provider: string, model: string): string {
        return `${provider.toLowerCase().trim()}:${model.toLowerCase().trim()}`;
    }

    private static isExpired(entry: StoredVisionCapability): boolean {
        if (!entry.expires_at) return false;
        const expiryTs = Date.parse(entry.expires_at);
        return Number.isFinite(expiryTs) && expiryTs <= Date.now();
    }

    private static nextFailureCount(entry: StoredVisionCapability | undefined, nowTs: number): number {
        if (!entry || entry.state !== "pending_unsupported" || this.isExpired(entry)) {
            return 1;
        }

        const lastFailureTs = entry.last_failure_at ? Date.parse(entry.last_failure_at) : Number.NaN;
        if (!Number.isFinite(lastFailureTs)) {
            return 1;
        }

        if (nowTs - lastFailureTs > this.UNSUPPORTED_CONFIRMATION_WINDOW_MS) {
            return 1;
        }

        const currentCount = typeof entry.failure_count === "number" && Number.isFinite(entry.failure_count)
            ? Math.max(1, Math.floor(entry.failure_count))
            : 1;

        return currentCount + 1;
    }

    private static classifyVisionFailure(opts: { error: unknown; provider: string }): VisionFailureClassification {
        const signal = this.extractVisionFailureSignal(opts.error);
        if (!signal.message && signal.codes.size === 0 && signal.statusCodes.size === 0) {
            return { isCapabilityError: false, reason: "empty_error", score: 0, evidence: [] };
        }

        const transientEvidence = this.matchTransientOrAuth(signal);
        if (transientEvidence.length > 0) {
            return {
                isCapabilityError: false,
                reason: "transient_or_auth",
                score: 0,
                evidence: transientEvidence,
            };
        }

        const documentEvidence = this.matchDocumentSpecific(signal);
        if (documentEvidence.length > 0) {
            return {
                isCapabilityError: false,
                reason: "document_specific_failure",
                score: 0,
                evidence: documentEvidence,
            };
        }

        const capability = this.scoreCapabilitySignal(signal, opts.provider);
        if (capability.score >= this.UNSUPPORTED_SCORE_THRESHOLD) {
            return {
                isCapabilityError: true,
                reason: "capability_mismatch",
                score: capability.score,
                evidence: capability.evidence,
            };
        }

        if (capability.score > 0) {
            return {
                isCapabilityError: false,
                reason: "insufficient_capability_evidence",
                score: capability.score,
                evidence: capability.evidence,
            };
        }

        return {
            isCapabilityError: false,
            reason: "unknown_error_class",
            score: 0,
            evidence: [],
        };
    }

    private static extractVisionFailureSignal(error: unknown): VisionFailureSignal {
        const messages = new Set<string>();
        const statusCodes = new Set<number>();
        const codes = new Set<string>();

        const pushMessage = (value: unknown): void => {
            if (typeof value !== "string") return;
            const normalized = value.trim().toLowerCase();
            if (normalized) messages.add(normalized);
        };

        const pushStatus = (value: unknown): void => {
            const parsed = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) return;
            statusCodes.add(Math.floor(parsed));
        };

        const pushCode = (value: unknown): void => {
            if (typeof value !== "string") return;
            const normalized = value.trim().toLowerCase();
            if (!normalized) return;
            codes.add(normalized);
            codes.add(normalized.replace(/[\s.-]+/g, "_"));
        };

        pushMessage(this.errorToMessage(error));

        const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
        const visited = new Set<object>();

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || current.depth > 2) {
                continue;
            }

            const { value, depth } = current;
            if (!value || typeof value !== "object") {
                continue;
            }

            if (visited.has(value)) {
                continue;
            }
            visited.add(value);

            const candidate = value as Record<string, unknown>;
            pushMessage(candidate.message);
            pushMessage(candidate.details);
            pushMessage(candidate.error_description);
            pushMessage(candidate.detail);
            if (typeof candidate.error === "string") {
                pushMessage(candidate.error);
            }

            pushStatus(candidate.status);
            pushStatus(candidate.statusCode);
            pushCode(candidate.code);
            pushCode(candidate.type);
            if (typeof candidate.error === "object") {
                const nested = candidate.error as Record<string, unknown>;
                pushCode(nested.code);
                pushCode(nested.type);
                pushStatus(nested.status);
                pushMessage(nested.message);
            }

            for (const key of ["response", "data", "error", "cause"]) {
                if (candidate[key] !== undefined) {
                    queue.push({ value: candidate[key], depth: depth + 1 });
                }
            }
        }

        return {
            message: Array.from(messages).join(" | "),
            statusCodes,
            codes,
        };
    }

    private static matchTransientOrAuth(signal: VisionFailureSignal): string[] {
        const statusMatches = Array.from(signal.statusCodes).filter((status) =>
            [401, 403, 408, 429, 500, 502, 503, 504].includes(status)
        );

        const codeMatches = this.matchCodes(signal.codes, [
            "timeout",
            "timed_out",
            "rate_limit",
            "too_many_requests",
            "temporarily_unavailable",
            "service_unavailable",
            "network_error",
            "connection_error",
            "unauthorized",
            "forbidden",
            "invalid_api_key",
            "insufficient_quota",
        ]);

        const messageMatches = this.matchMessage(signal.message, [
            "timeout",
            "timed out",
            "rate limit",
            "too many requests",
            "service unavailable",
            "temporar",
            "network",
            "connection",
            "unauthorized",
            "forbidden",
            "invalid api key",
            "insufficient quota",
            "overloaded",
        ]);

        return [
            ...statusMatches.map((status) => `status:${status}`),
            ...codeMatches.map((match) => `code:${match}`),
            ...messageMatches.map((match) => `msg:${match}`),
        ];
    }

    private static matchDocumentSpecific(signal: VisionFailureSignal): string[] {
        const codeMatches = this.matchCodes(signal.codes, [
            "image_too_large",
            "invalid_base64",
            "invalid_image",
            "invalid_image_data",
            "malformed_image",
            "invalid_image_url",
            "image_decode_failed",
        ]);

        const messageMatches = this.matchMessage(signal.message, [
            "image too large",
            "invalid base64",
            "malformed image",
            "invalid image data",
            "unable to decode image",
            "failed to decode image",
            "invalid image url",
        ]);

        const statusMatches = Array.from(signal.statusCodes).filter((status) => {
            if (status === 413) return true;
            if (status === 415 || status === 422) {
                return codeMatches.length > 0 || messageMatches.length > 0;
            }
            return false;
        });

        return [
            ...statusMatches.map((status) => `status:${status}`),
            ...codeMatches.map((match) => `code:${match}`),
            ...messageMatches.map((match) => `msg:${match}`),
        ];
    }

    private static scoreCapabilitySignal(signal: VisionFailureSignal, provider: string): { score: number; evidence: string[] } {
        const evidence: string[] = [];
        let score = 0;

        const explicitCapabilityCodes = this.matchCodes(signal.codes, [
            "vision_not_supported",
            "unsupported_vision",
            "model_not_vision_capable",
            "image_not_supported",
            "unsupported_message_content",
            "unsupported_content_type_for_model",
            "unsupported_image_input",
            "invalid_model_for_vision",
        ]);

        if (explicitCapabilityCodes.length > 0) {
            score += 3;
            evidence.push(...explicitCapabilityCodes.map((match) => `code:${match}`));
        }

        const highPrecisionMessageMatches = this.matchMessage(signal.message, [
            "does not support images",
            "does not support image inputs",
            "model does not support image",
            "this model cannot process images",
            "text-only model",
            "images are not supported for this model",
            "vision is not supported for this model",
            "vision is not supported",
            "vision not supported",
            "image_url is only supported by certain models",
        ]);

        if (highPrecisionMessageMatches.length > 0) {
            score += 3;
            evidence.push(...highPrecisionMessageMatches.map((match) => `msg:${match}`));
        }

        const providerSpecificMatches = this.matchMessage(signal.message, this.providerCapabilityHints(provider));
        if (providerSpecificMatches.length > 0) {
            score += 2;
            evidence.push(...providerSpecificMatches.map((match) => `provider:${match}`));
        }

        const weakCapabilityHints = this.matchMessage(signal.message, [
            "vision",
            "unsupported content type",
            "unsupported message content",
            "invalid content type",
            "unrecognized content type",
            "image_url",
            "multimodal",
            "multi-modal",
        ]);

        const hasClientValidationStatus = Array.from(signal.statusCodes).some((status) => [400, 415, 422].includes(status));
        if (weakCapabilityHints.length > 0 && hasClientValidationStatus) {
            score += 1;
            evidence.push(...weakCapabilityHints.map((match) => `weak:${match}`));
        }

        if (Array.from(signal.statusCodes).some((status) => status === 400 || status === 422)) {
            score += 1;
            evidence.push("status:client_validation");
        }

        return {
            score,
            evidence: Array.from(new Set(evidence)).slice(0, 8),
        };
    }

    private static providerCapabilityHints(provider: string): string[] {
        const normalized = provider.toLowerCase().trim();

        if (normalized.includes("openai")) {
            return [
                "image_url is only supported by certain models",
                "this model does not support image inputs",
            ];
        }

        if (normalized.includes("anthropic")) {
            return [
                "only some claude models support vision",
                "images are not supported for this model",
            ];
        }

        if (normalized.includes("google") || normalized.includes("gemini")) {
            return [
                "model does not support multimodal input",
                "unsupported input modality",
            ];
        }

        if (normalized.includes("realtimex")) {
            return [
                "invalid model",
                "text-only model",
            ];
        }

        return [];
    }

    private static matchMessage(message: string, hints: string[]): string[] {
        if (!message) return [];
        return hints.filter((hint) => message.includes(hint));
    }

    private static matchCodes(codes: Set<string>, hints: string[]): string[] {
        const matches: string[] = [];

        for (const code of codes) {
            const normalizedCode = code.replace(/[\s.-]+/g, "_");
            for (const hint of hints) {
                if (normalizedCode === hint || normalizedCode.includes(hint)) {
                    matches.push(code);
                    break;
                }
            }
        }

        return matches;
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
