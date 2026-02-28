import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("PolicyLearningService");

type PolicyLearningFeatures = {
    tokens: string[];
    extension?: string;
    mime_type?: string;
    document_type?: string;
    issuer?: string;
};

type PolicyLearningRow = {
    policy_id: string;
    policy_name?: string | null;
    features?: unknown;
};

type IngestionLike = {
    id: string;
    filename?: string | null;
    mime_type?: string | null;
    tags?: unknown;
    extracted?: unknown;
};

type CandidatePolicy = {
    policyId: string;
    score: number;
    support: number;
};

function normalizeText(value: unknown): string {
    if (value == null) return "";
    return String(value).toLowerCase().trim();
}

function tokenize(value: unknown): string[] {
    const normalized = normalizeText(value)
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    if (!normalized) return [];
    return normalized
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function dedupeTokens(tokens: string[], limit = 100): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of tokens) {
        if (seen.has(token)) continue;
        seen.add(token);
        out.push(token);
        if (out.length >= limit) break;
    }
    return out;
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function extractExtension(filename: string | null | undefined): string | undefined {
    const name = normalizeText(filename);
    if (!name) return undefined;
    const dot = name.lastIndexOf(".");
    if (dot < 0 || dot === name.length - 1) return undefined;
    const ext = name.slice(dot + 1).replace(/[^a-z0-9]/g, "");
    return ext || undefined;
}

function flattenValues(value: unknown, depth = 0): string[] {
    if (value == null || depth > 2) return [];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return [String(value)];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => flattenValues(item, depth + 1));
    }
    const record = toRecord(value);
    if (!record) return [];
    return Object.values(record).flatMap((item) => flattenValues(item, depth + 1));
}

function normalizeFeatures(value: unknown): PolicyLearningFeatures | null {
    const record = toRecord(value);
    if (!record) return null;

    const rawTokens = Array.isArray(record.tokens) ? record.tokens.map((t) => normalizeText(t)).filter(Boolean) : [];
    const tokens = dedupeTokens(rawTokens, 120);
    if (tokens.length === 0) return null;

    const extension = normalizeText(record.extension) || undefined;
    const mime_type = normalizeText(record.mime_type) || undefined;
    const document_type = normalizeText(record.document_type) || undefined;
    const issuer = normalizeText(record.issuer) || undefined;

    return { tokens, extension, mime_type, document_type, issuer };
}

function jaccard(tokensA: string[], tokensB: string[]): number {
    if (tokensA.length === 0 || tokensB.length === 0) return 0;
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    if (union === 0) return 0;
    return intersection / union;
}

function softTextMatch(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.includes(b) || b.includes(a);
}

function clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function scorePair(doc: PolicyLearningFeatures, sample: PolicyLearningFeatures): number {
    let score = jaccard(doc.tokens, sample.tokens) * 0.72;

    if (doc.extension && sample.extension) {
        score += doc.extension === sample.extension ? 0.16 : -0.04;
    }

    if (doc.mime_type && sample.mime_type) {
        score += doc.mime_type === sample.mime_type ? 0.08 : -0.02;
    }

    if (doc.document_type && sample.document_type) {
        score += softTextMatch(doc.document_type, sample.document_type) ? 0.17 : -0.03;
    }

    if (doc.issuer && sample.issuer) {
        score += softTextMatch(doc.issuer, sample.issuer) ? 0.14 : -0.02;
    }

    return clamp01(score);
}

function buildFromDocInput(opts: {
    filePath: string;
    baselineEntities: Record<string, unknown>;
    documentText?: string;
}): PolicyLearningFeatures {
    const extension = extractExtension(opts.filePath);
    const baseline = opts.baselineEntities ?? {};

    const docType = normalizeText(
        baseline.document_type ??
        baseline.doc_type ??
        baseline.type ??
        baseline.category
    ) || undefined;

    const issuer = normalizeText(
        baseline.issuer ??
        baseline.vendor ??
        baseline.merchant ??
        baseline.store_name ??
        baseline.sender
    ) || undefined;

    const extractedTokens = flattenValues(baseline).flatMap((value) => tokenize(value));
    const fileTokens = tokenize(opts.filePath.split("/").pop() ?? opts.filePath);
    const textTokens = tokenize((opts.documentText ?? "").slice(0, 1200));

    const tokens = dedupeTokens(
        [
            ...fileTokens,
            ...extractedTokens,
            ...textTokens,
            ...(docType ? tokenize(docType) : []),
            ...(issuer ? tokenize(issuer) : []),
        ],
        120
    );

    return {
        tokens,
        extension,
        document_type: docType,
        issuer,
    };
}

function buildFromIngestionRow(ingestion: IngestionLike): PolicyLearningFeatures {
    const extracted = toRecord(ingestion.extracted) ?? {};
    const tags = Array.isArray(ingestion.tags) ? ingestion.tags.map((t) => String(t)) : [];
    const extension = extractExtension(ingestion.filename);
    const mime_type = normalizeText(ingestion.mime_type) || undefined;

    const docType = normalizeText(
        extracted.document_type ??
        extracted.doc_type ??
        extracted.type ??
        extracted.category
    ) || undefined;

    const issuer = normalizeText(
        extracted.issuer ??
        extracted.vendor ??
        extracted.merchant ??
        extracted.store_name ??
        extracted.sender
    ) || undefined;

    const extractedWithoutEnrichment = { ...extracted };
    delete extractedWithoutEnrichment["_enrichment"];

    const tokens = dedupeTokens(
        [
            ...tokenize(ingestion.filename),
            ...tags.flatMap((tag) => tokenize(tag)),
            ...flattenValues(extractedWithoutEnrichment).flatMap((value) => tokenize(value)),
            ...(docType ? tokenize(docType) : []),
            ...(issuer ? tokenize(issuer) : []),
        ],
        120
    );

    return {
        tokens,
        extension,
        mime_type,
        document_type: docType,
        issuer,
    };
}

export class PolicyLearningService {
    static async recordManualMatch(opts: {
        supabase: SupabaseClient;
        userId: string;
        ingestion: IngestionLike;
        policyId: string;
        policyName?: string;
    }): Promise<void> {
        const { supabase, userId, ingestion, policyId, policyName } = opts;
        const features = buildFromIngestionRow(ingestion);

        if (features.tokens.length === 0) {
            logger.warn("Skipping policy learning feedback: no usable tokens", {
                ingestionId: ingestion.id,
                policyId,
            });
            return;
        }

        const row = {
            user_id: userId,
            ingestion_id: ingestion.id,
            policy_id: policyId,
            policy_name: policyName ?? null,
            feedback_type: "manual_match",
            features,
        };

        const { error } = await supabase
            .from("policy_match_feedback")
            .upsert(row, { onConflict: "user_id,ingestion_id,policy_id" });

        if (error) {
            logger.error("Failed to save policy match feedback", {
                ingestionId: ingestion.id,
                policyId,
                error,
            });
            return;
        }

        logger.info("Saved policy learning feedback", {
            ingestionId: ingestion.id,
            policyId,
            tokens: features.tokens.length,
        });
    }

    static async resolveLearnedCandidate(opts: {
        supabase: SupabaseClient;
        userId: string;
        policyIds: string[];
        filePath: string;
        baselineEntities: Record<string, unknown>;
        documentText?: string;
    }): Promise<CandidatePolicy | null> {
        const { supabase, userId, policyIds, filePath, baselineEntities, documentText } = opts;
        if (policyIds.length === 0) return null;

        const docFeatures = buildFromDocInput({ filePath, baselineEntities, documentText });
        if (docFeatures.tokens.length === 0) return null;

        const { data, error } = await supabase
            .from("policy_match_feedback")
            .select("policy_id,policy_name,features")
            .eq("user_id", userId)
            .in("policy_id", policyIds)
            .order("created_at", { ascending: false })
            .limit(400);

        if (error) {
            logger.warn("Failed to read policy learning feedback", { userId, error });
            return null;
        }

        const rows = (data ?? []) as PolicyLearningRow[];
        if (rows.length === 0) return null;

        const byPolicy = new Map<string, number[]>();
        for (const row of rows) {
            const sample = normalizeFeatures(row.features);
            if (!sample) continue;
            const score = scorePair(docFeatures, sample);
            const existing = byPolicy.get(row.policy_id) ?? [];
            existing.push(score);
            byPolicy.set(row.policy_id, existing);
        }

        let best: CandidatePolicy | null = null;
        for (const [policyId, scores] of byPolicy.entries()) {
            if (scores.length === 0) continue;
            scores.sort((a, b) => b - a);
            const topScores = scores.slice(0, 3);
            const averageTop = topScores.reduce((sum, value) => sum + value, 0) / topScores.length;
            const supportBoost = Math.min(0.08, (scores.length - 1) * 0.02);
            const score = clamp01(averageTop + supportBoost);

            const candidate: CandidatePolicy = {
                policyId,
                score,
                support: scores.length,
            };

            if (!best || candidate.score > best.score) {
                best = candidate;
            }
        }

        if (!best) return null;

        const strictEnough = best.support >= 2 ? best.score >= 0.72 : best.score >= 0.82;
        if (!strictEnough) return null;

        logger.info("Resolved learned policy candidate", {
            policyId: best.policyId,
            score: best.score,
            support: best.support,
        });
        return best;
    }
}
