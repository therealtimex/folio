import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { SDKService } from "./SDKService.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("RAGService");

export interface RetrievedChunk {
    id: string;
    ingestion_id: string;
    content: string;
    similarity: number;
}

interface ModelScope {
    provider: string;
    model: string;
    vector_dim?: number;
}

type EmbeddingSettings = { embedding_provider?: string; embedding_model?: string };

interface ResolvedEmbeddingModel {
    provider: string;
    model: string;
}

export class RAGService {
    private static readonly MAX_CONCURRENT_EMBED_JOBS = (() => {
        const parsed = Number.parseInt(process.env.RAG_MAX_CONCURRENT_EMBED_JOBS ?? "2", 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
    })();
    private static activeEmbedJobs = 0;
    private static embedJobWaiters: Array<() => void> = [];

    private static async acquireEmbedJobSlot(): Promise<void> {
        while (this.activeEmbedJobs >= this.MAX_CONCURRENT_EMBED_JOBS) {
            await new Promise<void>((resolve) => this.embedJobWaiters.push(resolve));
        }
        this.activeEmbedJobs += 1;
    }

    private static releaseEmbedJobSlot(): void {
        this.activeEmbedJobs = Math.max(0, this.activeEmbedJobs - 1);
        const waiter = this.embedJobWaiters.shift();
        if (waiter) waiter();
    }

    private static async resolveEmbeddingModel(settings: EmbeddingSettings = {}): Promise<ResolvedEmbeddingModel> {
        const { provider, model } = await SDKService.resolveEmbedProvider(settings);
        return { provider, model };
    }

    private static async embedTextWithResolvedModel(text: string, resolvedModel: ResolvedEmbeddingModel): Promise<number[]> {
        const sdk = SDKService.getSDK();
        if (!sdk) {
            throw new Error("RealTimeX SDK not available for embedding");
        }

        const response = await sdk.llm.embed(text, {
            provider: resolvedModel.provider,
            model: resolvedModel.model
        });
        const embedding = response.embeddings?.[0];
        if (!embedding) {
            throw new Error("No embedding returned from SDK");
        }
        return embedding;
    }

    /**
     * Splits a large text into smaller semantic chunks (roughly by paragraphs).
     */
    static chunkText(text: string, maxChunkLength: number = 1000): string[] {
        if (!text || text.trim().length === 0) return [];

        const paragraphs = text.split(/\n\s*\n/);
        const chunks: string[] = [];
        let currentChunk = "";

        for (const paragraph of paragraphs) {
            const p = paragraph.trim();
            if (!p) continue;

            if (p.length > maxChunkLength) {
                // Flush pending chunk before splitting an oversized paragraph
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk.trim());
                    currentChunk = "";
                }

                // Hard split oversized paragraphs to prevent SDK payload rejection
                let i = 0;
                while (i < p.length) {
                    chunks.push(p.slice(i, i + maxChunkLength));
                    i += maxChunkLength;
                }
                continue;
            }

            if (currentChunk.length + p.length > maxChunkLength && currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }

            currentChunk += (currentChunk.length > 0 ? "\n\n" : "") + p;
        }

        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /**
     * Generate an embedding for a text string using RealTimeX SDK
     */
    static async embedText(
        text: string,
        settings?: EmbeddingSettings
    ): Promise<number[]> {
        const resolvedModel = await this.resolveEmbeddingModel(settings || {});
        logger.debug(`Generating embedding using ${resolvedModel.provider}/${resolvedModel.model}`);
        return this.embedTextWithResolvedModel(text, resolvedModel);
    }

    /**
     * Process an ingested document's raw text: chunk it, embed it, and store in DB.
     */
    static async chunkAndEmbed(
        ingestionId: string,
        userId: string,
        rawText: string,
        supabase: SupabaseClient,
        settings?: EmbeddingSettings
    ): Promise<void> {
        if (rawText.startsWith("[VLM_IMAGE_DATA:")) {
            logger.info(`Skipping chunking and embedding for VLM base64 image data (Ingestion: ${ingestionId})`);
            return;
        }

        const chunks = this.chunkText(rawText);
        if (chunks.length === 0) {
            logger.info(`No text to chunk for ingestion ${ingestionId}`);
            return;
        }

        const resolvedModel = await this.resolveEmbeddingModel(settings || {});
        logger.info(
            `Extracted ${chunks.length} chunks for ingestion ${ingestionId}. Embedding with ${resolvedModel.provider}/${resolvedModel.model}...`
        );

        // Global gate: background fire-and-forget jobs are bounded process-wide.
        await this.acquireEmbedJobSlot();
        try {
            // To avoid provider throttling, process chunks sequentially inside each job.
            for (const [index, content] of chunks.entries()) {
                try {
                    // Content hash is model-agnostic. Model identity is tracked in dedicated columns.
                    const hash = crypto.createHash("sha256").update(content).digest("hex");

                    // Check if this chunk already exists for this ingestion and this model.
                    const { data: existing } = await supabase
                        .from("document_chunks")
                        .select("id")
                        .eq("ingestion_id", ingestionId)
                        .eq("content_hash", hash)
                        .eq("embedding_provider", resolvedModel.provider)
                        .eq("embedding_model", resolvedModel.model)
                        .maybeSingle();

                    if (existing) {
                        continue; // Skip duplicate chunk
                    }

                    // Spread requests slightly to reduce burstiness against embedding APIs.
                    await new Promise((r) => setTimeout(r, 100));

                    const embedding = await this.embedTextWithResolvedModel(content, resolvedModel);
                    const vector_dim = embedding.length;

                    const { error } = await supabase.from("document_chunks").insert({
                        user_id: userId,
                        ingestion_id: ingestionId,
                        content,
                        content_hash: hash,
                        embedding_provider: resolvedModel.provider,
                        embedding_model: resolvedModel.model,
                        embedding,
                        vector_dim
                    });

                    if (error) {
                        logger.error(`Failed to insert chunk ${index + 1}/${chunks.length} for ${ingestionId}`, { error });
                    }
                } catch (err) {
                    logger.error(`Failed to process chunk ${index + 1}/${chunks.length} for ${ingestionId}`, {
                        error: err instanceof Error ? err.message : String(err)
                    });
                }
            }
        } finally {
            this.releaseEmbedJobSlot();
        }

        logger.info(`Successfully stored semantic chunks for ingestion ${ingestionId}`);
    }

    /**
     * Semantically search the document chunks using dynamic pgvector partial indexing.
     */
    private static async runSearchForModel(args: {
        userId: string;
        supabase: SupabaseClient;
        modelScope: ModelScope;
        queryEmbedding: number[];
        queryDim: number;
        similarityThreshold: number;
        topK: number;
    }): Promise<RetrievedChunk[]> {
        const { userId, supabase, modelScope, queryEmbedding, queryDim, similarityThreshold, topK } = args;

        const { data, error } = await supabase.rpc("search_documents", {
            p_user_id: userId,
            p_embedding_provider: modelScope.provider,
            p_embedding_model: modelScope.model,
            query_embedding: queryEmbedding,
            match_threshold: similarityThreshold,
            match_count: topK,
            query_dim: queryDim
        });

        if (error) {
            throw new Error(`Knowledge base search failed for ${modelScope.provider}/${modelScope.model}: ${error.message}`);
        }

        return (data || []) as RetrievedChunk[];
    }

    private static async listUserModelScopes(
        userId: string,
        supabase: SupabaseClient
    ): Promise<ModelScope[]> {
        const { data, error } = await supabase
            .from("document_chunks")
            .select("embedding_provider, embedding_model, vector_dim, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(2000);

        if (error) {
            logger.warn("Failed to list user embedding scopes for RAG fallback", { error });
            return [];
        }

        const scopes = new Map<string, ModelScope>();
        for (const row of data || []) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const provider = String((row as any).embedding_provider || "").trim();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const model = String((row as any).embedding_model || "").trim();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const vector_dim = Number((row as any).vector_dim);
            if (!provider || !model) continue;
            const key = `${provider}::${model}`;
            if (!scopes.has(key)) {
                scopes.set(key, {
                    provider,
                    model,
                    vector_dim: Number.isFinite(vector_dim) && vector_dim > 0 ? vector_dim : undefined
                });
            }
        }

        return Array.from(scopes.values());
    }

    static async searchDocuments(
        query: string,
        userId: string,
        supabase: SupabaseClient,
        options: {
            topK?: number;
            similarityThreshold?: number;
            settings?: EmbeddingSettings;
        } = {}
    ): Promise<RetrievedChunk[]> {
        const {
            topK = 5,
            similarityThreshold = 0.7,
            settings
        } = options;

        const minThreshold = Math.max(0.1, Math.min(similarityThreshold, 0.4));
        const thresholdLevels = Array.from(new Set([similarityThreshold, minThreshold]));
        const preferred = await this.resolveEmbeddingModel(settings || {});
        const preferredScope: ModelScope = { provider: preferred.provider, model: preferred.model };
        const embeddingCache = new Map<string, { queryEmbedding: number[]; queryDim: number }>();

        const collected = new Map<string, RetrievedChunk>();
        const trySearch = async (scope: ModelScope, threshold: number): Promise<number> => {
            const cacheKey = `${scope.provider}::${scope.model}`;
            let cached = embeddingCache.get(cacheKey);
            if (!cached) {
                const queryEmbedding = await this.embedTextWithResolvedModel(query, {
                    provider: scope.provider,
                    model: scope.model,
                });
                cached = { queryEmbedding, queryDim: queryEmbedding.length };
                embeddingCache.set(cacheKey, cached);
            }
            const { queryEmbedding, queryDim } = cached;
            if (scope.vector_dim && scope.vector_dim !== queryDim) {
                logger.warn("Skipping model scope due to vector dimension mismatch", {
                    scope,
                    queryDim
                });
                return 0;
            }

            logger.info(
                `Searching knowledge base (${scope.provider}/${scope.model}, dim=${queryDim}, topK=${topK}, threshold=${threshold})`
            );

            const hits = await this.runSearchForModel({
                userId,
                supabase,
                modelScope: scope,
                queryEmbedding,
                queryDim,
                similarityThreshold: threshold,
                topK
            });

            for (const hit of hits) {
                if (!collected.has(hit.id)) {
                    collected.set(hit.id, hit);
                } else {
                    const existing = collected.get(hit.id)!;
                    if (hit.similarity > existing.similarity) {
                        collected.set(hit.id, hit);
                    }
                }
            }

            return hits.length;
        };

        try {
            for (const threshold of thresholdLevels) {
                const hits = await trySearch(preferredScope, threshold);
                if (hits > 0) {
                    break;
                }
            }
        } catch (error) {
            logger.error("Semantic search failed for preferred embedding scope", {
                provider: preferredScope.provider,
                model: preferredScope.model,
                error
            });
        }

        if (collected.size === 0) {
            const scopes = await this.listUserModelScopes(userId, supabase);
            const fallbackScopes = scopes.filter(
                (scope) => !(scope.provider === preferredScope.provider && scope.model === preferredScope.model)
            );

            for (const scope of fallbackScopes) {
                try {
                    for (const threshold of thresholdLevels) {
                        await trySearch(scope, threshold);
                        if (collected.size >= topK) break;
                    }
                } catch (error) {
                    logger.warn("Semantic search failed for fallback embedding scope", {
                        scope,
                        error
                    });
                }
                if (collected.size >= topK) break;
            }
        }

        return Array.from(collected.values())
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }
}
