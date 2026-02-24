import { RealtimeXSDK, ProvidersResponse } from "@realtimex/sdk";

import { createLogger } from "../utils/logger.js";

const logger = createLogger("SDKService");

export interface ProviderResult {
  provider: string;
  model: string;
  isDefaultFallback?: boolean;
}

export class SDKService {
  private static instance: RealtimeXSDK | null = null;
  private static initAttempted = false;

  // Default provider/model configuration
  // realtimexai routes through RealTimeX Desktop to user's configured providers
  static readonly DEFAULT_LLM_PROVIDER = "realtimexai";
  static readonly DEFAULT_LLM_MODEL = "gpt-4o-mini";
  static readonly DEFAULT_EMBED_PROVIDER = "realtimexai";
  static readonly DEFAULT_EMBED_MODEL = "text-embedding-3-small";

  static initialize(): RealtimeXSDK {
    if (!this.instance && !this.initAttempted) {
      this.initAttempted = true;

      try {
        this.instance = new RealtimeXSDK({
          realtimex: {
            // @ts-ignore Desktop dev bridge key
            apiKey: "SXKX93J-QSWMB04-K9E0GRE-J5DA8J0"
          },
          permissions: [
            "api.agents",       // List agents
            "api.workspaces",   // List workspaces
            "api.threads",      // List threads
            "webhook.trigger",  // Trigger agents
            "activities.read",  // Read activities
            "activities.write", // Write activities
            "llm.chat",         // Chat completion
            "llm.embed",        // Generate embeddings
            "llm.providers",    // List LLM providers (chat, embed)
            "vectors.read",     // Query vectors
            "vectors.write",    // Store vectors
          ]
        });

        logger.info("RealTimeX SDK initialized successfully");

        // @ts-ignore ping available in desktop bridge
        this.instance.ping?.().catch(() => {
          logger.warn("Desktop ping failed during startup");
        });
      } catch (error) {
        logger.error("Failed to initialize SDK", {
          error: error instanceof Error ? error.message : String(error)
        });
        this.instance = null;
      }
    }

    return this.instance!;
  }

  static getSDK(): RealtimeXSDK | null {
    if (!this.instance && !this.initAttempted) {
      this.initialize();
    }
    return this.instance;
  }

  static async isAvailable(): Promise<boolean> {
    try {
      const sdk = this.getSDK();
      if (!sdk) return false;

      // Try to ping first (faster)
      try {
        // @ts-ignore ping available in desktop bridge
        await sdk.ping();
        return true;
      } catch (e) {
        // Fallback to providers check if ping not available/fails
        await sdk.llm.chatProviders();
        return true;
      }
    } catch (error: any) {
      logger.warn("SDK not available", { error: error.message });
      return false;
    }
  }

  /**
   * Helper to wrap a promise with a timeout
   */
  static async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timeoutHandle: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result as T;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // Cache for default providers (avoid repeated SDK calls)
  private static defaultChatProvider: ProviderResult | null = null;
  private static defaultEmbedProvider: ProviderResult | null = null;

  /**
   * Get default chat provider/model from SDK dynamically
   */
  static async getDefaultChatProvider(): Promise<ProviderResult> {
    // Return cached if available
    if (this.defaultChatProvider) {
      return this.defaultChatProvider;
    }

    const sdk = this.getSDK();
    if (!sdk) {
      return {
        provider: this.DEFAULT_LLM_PROVIDER,
        model: this.DEFAULT_LLM_MODEL,
        isDefaultFallback: true
      };
    }

    try {
      const { providers } = await this.withTimeout<ProvidersResponse>(
        sdk.llm.chatProviders(),
        30000,
        "Chat providers fetch timed out"
      );

      if (!providers || providers.length === 0) {
        throw new Error("No LLM providers available");
      }

      const preferred = providers.find((item) => item.provider === this.DEFAULT_LLM_PROVIDER);
      const chosen = preferred || providers[0];
      const model = chosen.models?.[0]?.id || this.DEFAULT_LLM_MODEL;

      this.defaultChatProvider = {
        provider: chosen.provider,
        model,
        isDefaultFallback: !preferred
      };
      return this.defaultChatProvider;
    } catch (error: any) {
      logger.warn("Failed to get default chat provider from SDK", error);
      return {
        provider: this.DEFAULT_LLM_PROVIDER,
        model: this.DEFAULT_LLM_MODEL,
        isDefaultFallback: true
      };
    }
  }

  /**
   * Get default embedding provider/model from SDK dynamically
   */
  static async getDefaultEmbedProvider(): Promise<ProviderResult> {
    if (this.defaultEmbedProvider) {
      return this.defaultEmbedProvider;
    }

    const sdk = this.getSDK();
    if (!sdk) {
      return {
        provider: this.DEFAULT_EMBED_PROVIDER,
        model: this.DEFAULT_EMBED_MODEL,
        isDefaultFallback: true
      };
    }

    try {
      const { providers } = await this.withTimeout<ProvidersResponse>(
        sdk.llm.embedProviders(),
        30000,
        "Embed providers fetch timed out"
      );

      if (!providers || providers.length === 0) {
        throw new Error("No embedding providers available");
      }

      const preferred = providers.find((p) => p.provider === this.DEFAULT_EMBED_PROVIDER);
      const chosen = preferred || providers[0];
      const model = chosen.models?.[0]?.id || this.DEFAULT_EMBED_MODEL;

      this.defaultEmbedProvider = {
        provider: chosen.provider,
        model,
        isDefaultFallback: !preferred
      };
      return this.defaultEmbedProvider;
    } catch (error: any) {
      logger.warn("Failed to get default embed provider from SDK", error);
      return {
        provider: this.DEFAULT_EMBED_PROVIDER,
        model: this.DEFAULT_EMBED_MODEL,
        isDefaultFallback: true
      };
    }
  }

  /**
   * Resolve LLM provider/model - use settings if available, otherwise use defaults
   */
  static async resolveChatProvider(settings: { llm_provider?: string; llm_model?: string }): Promise<ProviderResult> {
    if (settings.llm_provider && settings.llm_model) {
      return {
        provider: settings.llm_provider,
        model: settings.llm_model,
        isDefaultFallback: false
      };
    }
    return await this.getDefaultChatProvider();
  }

  /**
   * Resolve embedding provider/model - use settings if available, otherwise use defaults
   */
  static async resolveEmbedProvider(settings: { embedding_provider?: string; embedding_model?: string }): Promise<ProviderResult> {
    if (settings.embedding_provider && settings.embedding_model) {
      return {
        provider: settings.embedding_provider,
        model: settings.embedding_model,
        isDefaultFallback: false
      };
    }
    return await this.getDefaultEmbedProvider();
  }

  static clearProviderCache(): void {
    this.defaultChatProvider = null;
    this.defaultEmbedProvider = null;
  }
}
