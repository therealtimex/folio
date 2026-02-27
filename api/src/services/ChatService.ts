import { SupabaseClient } from "@supabase/supabase-js";
import { SDKService } from "./SDKService.js";
import { RAGService, RetrievedChunk } from "./RAGService.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ChatService");

export interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    context_sources?: RetrievedChunk[];
    created_at: string;
}

interface CompletionShape {
    response?: { content?: string };
    content?: string;
    message?: { content?: string };
    choices?: Array<{ message?: { content?: string } }>;
}

export class ChatService {
    /**
     * Send a message to an existing session, augment with RAG context if needed,
     * and stream the AI response back into the database.
     */
    static async handleMessage(
        sessionId: string,
        userId: string,
        content: string,
        supabase: SupabaseClient
    ): Promise<Message> {
        // 1. Get User/Session Settings (Models to use)
        const { data: settings } = await supabase
            .from("user_settings")
            .select("llm_provider, llm_model, embedding_provider, embedding_model")
            .eq("user_id", userId)
            .maybeSingle();

        const llmSettings = {
            llm_provider: settings?.llm_provider ?? undefined,
            llm_model: settings?.llm_model ?? undefined,
        };

        const embedSettings = {
            embedding_provider: settings?.embedding_provider ?? undefined,
            embedding_model: settings?.embedding_model ?? undefined,
        };

        // 2. Resolve Providers
        const chatProvider = await SDKService.resolveChatProvider(llmSettings);

        // 3. Save User Message
        const { error: userMsgErr } = await supabase.from("chat_messages").insert({
            session_id: sessionId,
            user_id: userId,
            role: "user",
            content
        });

        if (userMsgErr) {
            logger.error(`Failed to save user message for session ${sessionId}`, { error: userMsgErr });
            throw new Error("Failed to save message");
        }

        // 4. Retrieve semantic context (Dynamic RAG)
        let contextSources: RetrievedChunk[] = [];
        try {
            contextSources = await RAGService.searchDocuments(
                content,
                userId,
                supabase,
                { topK: 5, similarityThreshold: 0.65, settings: embedSettings }
            );
        } catch (err) {
            logger.warn(`Semantic search failed during chat. Proceeding without context.`, { error: err });
        }

        // 5. Fetch Chat History
        const { data: history, error: historyError } = await supabase
            .from("chat_messages")
            .select("role, content")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: false })
            .limit(20);

        if (historyError) {
            logger.error(`Failed to fetch chat history for session ${sessionId}`, { error: historyError });
            throw new Error("Failed to load chat history");
        }

        const chatHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = (history || [])
            .reverse()
            .map((m) => ({
                role: m.role as "user" | "assistant" | "system",
                content: String(m.content ?? "")
            }));

        // 6. Build the Augmented Prompt
        let systemPrompt = `You are the Folio AI Agent, a brilliant and precise autonomous filing assistant.\n`;
        systemPrompt += `You have been asked a question. `;

        if (contextSources.length > 0) {
            systemPrompt += `Below is exact extracted text from the user's documents retrieved via Semantic Search to answer the question. Cite the context when responding.\n\n`;
            systemPrompt += `--- CONTEXT SOURCES ---\n`;
            contextSources.forEach((c, idx) => {
                systemPrompt += `[Source ${idx + 1}]:\n${c.content}\n\n`;
            });
            systemPrompt += `--- END CONTEXT ---\n`;
        } else {
            systemPrompt += `No specific documents were retrieved for this query. Answer conversationally, but let the user know you couldn't find exact files matching their question.`;
        }

        const messagesForLLM: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
            { role: "system", content: systemPrompt },
            ...chatHistory
        ];

        // 7. Get AI Response via SDK
        const sdk = SDKService.getSDK();
        if (!sdk) {
            throw new Error("RealTimeX SDK not available");
        }

        const completion = await sdk.llm.chat(messagesForLLM, {
            provider: chatProvider.provider,
            model: chatProvider.model,
            temperature: 0.3
        }) as CompletionShape;

        const replyContent: string =
            completion.response?.content ??
            completion.content ??
            completion.message?.content ??
            completion.choices?.[0]?.message?.content ??
            "I am unable to process that request.";

        // 8. Save Assistant Reply
        const { data: aiMsg, error: aiMsgErr } = await supabase.from("chat_messages")
            .insert({
                session_id: sessionId,
                user_id: userId,
                role: "assistant",
                content: replyContent,
                context_sources: contextSources
            })
            .select("*")
            .single();

        if (aiMsgErr) {
            logger.error(`Failed to save AI message for session ${sessionId}`, { error: aiMsgErr });
            throw new Error("Failed to save AI response");
        }

        return aiMsg as Message;
    }
}
