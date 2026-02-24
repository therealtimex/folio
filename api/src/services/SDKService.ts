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

  static readonly DEFAULT_LLM_PROVIDER = "realtimexai";
  static readonly DEFAULT_LLM_MODEL = "gpt-4o-mini";

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
            "llm.chat",
            "llm.embed",
            "llm.providers",
            "api.workspaces",
            "api.threads",
            "webhook.trigger"
          ]
        });

        logger.info("RealTimeX SDK initialized");

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
    const sdk = this.getSDK();
    if (!sdk) {
      return false;
    }

    try {
      // @ts-ignore ping available in desktop bridge
      if (sdk.ping) {
        // @ts-ignore ping available in desktop bridge
        await sdk.ping();
        return true;
      }
      await sdk.llm.chatProviders();
      return true;
    } catch {
      return false;
    }
  }

  static async getDefaultChatProvider(): Promise<ProviderResult> {
    const sdk = this.getSDK();
    if (!sdk) {
      return {
        provider: this.DEFAULT_LLM_PROVIDER,
        model: this.DEFAULT_LLM_MODEL,
        isDefaultFallback: true
      };
    }

    try {
      const { providers } = (await sdk.llm.chatProviders()) as ProvidersResponse;
      if (!providers || providers.length === 0) {
        throw new Error("No providers");
      }

      const preferred = providers.find((item) => item.provider === this.DEFAULT_LLM_PROVIDER);
      const chosen = preferred || providers[0];
      const model = chosen.models?.[0]?.id || this.DEFAULT_LLM_MODEL;

      return {
        provider: chosen.provider,
        model,
        isDefaultFallback: !preferred
      };
    } catch {
      return {
        provider: this.DEFAULT_LLM_PROVIDER,
        model: this.DEFAULT_LLM_MODEL,
        isDefaultFallback: true
      };
    }
  }
}
