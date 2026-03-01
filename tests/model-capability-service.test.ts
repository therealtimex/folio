import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { ModelCapabilityService } from "../api/src/services/ModelCapabilityService";

type VisionCapabilityEntry = {
  state: string;
  learned_at: string;
  expires_at?: string;
  reason?: string;
  failure_count?: number;
  last_failure_at?: string;
  evidence?: string[];
};

type VisionCapabilityMap = Record<string, VisionCapabilityEntry>;

function cloneMap(map: VisionCapabilityMap): VisionCapabilityMap {
  return JSON.parse(JSON.stringify(map)) as VisionCapabilityMap;
}

function createSupabaseMock(initialMap: VisionCapabilityMap = {}): {
  client: SupabaseClient;
  getMap: () => VisionCapabilityMap;
  getWriteCount: () => number;
} {
  let map = cloneMap(initialMap);
  let writeCount = 0;

  const client = {
    from(table: string) {
      if (table !== "user_settings") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select(_columns: string) {
          return {
            eq(_column: string, _value: string) {
              return {
                async maybeSingle() {
                  return {
                    data: { vision_model_capabilities: cloneMap(map) },
                    error: null,
                  };
                },
              };
            },
          };
        },
        async upsert(
          payload: { user_id: string; vision_model_capabilities: VisionCapabilityMap },
          _options: { onConflict: string }
        ) {
          map = cloneMap(payload.vision_model_capabilities);
          writeCount += 1;
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    client,
    getMap: () => cloneMap(map),
    getWriteCount: () => writeCount,
  };
}

describe("ModelCapabilityService.learnVisionFailure", () => {
  it("prioritizes transient/auth classification before capability hints", async () => {
    const supabase = createSupabaseMock();

    const state = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-1",
      provider: "openai",
      model: "gpt-4.1-mini",
      error: {
        message: "Vision request timed out while awaiting provider response",
        status: 504,
      },
    });

    expect(state).toBe("unknown");
    expect(supabase.getWriteCount()).toBe(0);
  });

  it("treats document-specific payload issues as unknown", async () => {
    const supabase = createSupabaseMock();

    const state = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-2",
      provider: "openai",
      model: "gpt-4.1-mini",
      error: {
        message: "Invalid base64 image payload",
        status: 422,
      },
    });

    expect(state).toBe("unknown");
    expect(supabase.getWriteCount()).toBe(0);
  });

  it("requires repeated capability failures before persisting unsupported", async () => {
    const supabase = createSupabaseMock();

    const first = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-3",
      provider: "openai",
      model: "gpt-4.1-mini",
      error: {
        message: "This model does not support image inputs",
        status: 400,
      },
    });

    expect(first).toBe("unknown");

    const afterFirst = supabase.getMap();
    const pending = afterFirst["openai:gpt-4.1-mini"];
    expect(pending?.state).toBe("pending_unsupported");
    expect(pending?.failure_count).toBe(1);

    const second = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-3",
      provider: "openai",
      model: "gpt-4.1-mini",
      error: {
        message: "This model does not support image inputs",
        status: 400,
      },
    });

    expect(second).toBe("unsupported");

    const afterSecond = supabase.getMap();
    const unsupported = afterSecond["openai:gpt-4.1-mini"];
    expect(unsupported?.state).toBe("unsupported");
    expect(unsupported?.failure_count).toBe(2);

    const resolution = ModelCapabilityService.resolveVisionSupport({
      llm_provider: "openai",
      llm_model: "gpt-4.1-mini",
      vision_model_capabilities: afterSecond,
    });

    expect(resolution.state).toBe("unsupported");
    expect(resolution.shouldAttempt).toBe(false);
  });

  it("uses structured error codes even when message text is weak", async () => {
    const supabase = createSupabaseMock();
    const error = {
      message: "Bad request",
      response: {
        status: 400,
        data: {
          error: {
            code: "vision_not_supported",
            type: "invalid_request_error",
          },
        },
      },
    };

    const first = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-4",
      provider: "openai",
      model: "gpt-4.1-mini",
      error,
    });

    const second = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-4",
      provider: "openai",
      model: "gpt-4.1-mini",
      error,
    });

    expect(first).toBe("unknown");
    expect(second).toBe("unsupported");
  });

  it("resets pending failure metadata on success", async () => {
    const supabase = createSupabaseMock();

    await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-5",
      provider: "openai",
      model: "gpt-4.1-mini",
      error: {
        message: "Model does not support image inputs",
        status: 400,
      },
    });

    await ModelCapabilityService.learnVisionSuccess({
      supabase: supabase.client,
      userId: "user-5",
      provider: "openai",
      model: "gpt-4.1-mini",
    });

    const map = supabase.getMap();
    const entry = map["openai:gpt-4.1-mini"];

    expect(entry?.state).toBe("supported");
    expect(entry?.reason).toBe("vision_request_succeeded");
    expect(entry?.failure_count).toBeUndefined();
    expect(entry?.last_failure_at).toBeUndefined();
  });

  it("does not short-circuit 422 capability errors as document-specific", async () => {
    const supabase = createSupabaseMock();
    const error = {
      message: "This model does not support images",
      status: 422,
    };

    const first = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-6",
      provider: "openai",
      model: "gpt-4.1-mini",
      error,
    });

    const second = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-6",
      provider: "openai",
      model: "gpt-4.1-mini",
      error,
    });

    expect(first).toBe("unknown");
    expect(second).toBe("unsupported");

    const entry = supabase.getMap()["openai:gpt-4.1-mini"];
    expect(entry?.reason).toBe("capability_mismatch");
    expect(entry?.evidence).toContain("msg:does not support images");
  });

  it("avoids duplicate invalid-model weighting for realtimexai", async () => {
    const supabase = createSupabaseMock();
    const error = {
      message: "Invalid model",
      status: 400,
    };

    const first = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-7",
      provider: "realtimexai",
      model: "text-model",
      error,
    });

    expect(first).toBe("unknown");

    const pending = supabase.getMap()["realtimexai:text-model"];
    expect(pending?.state).toBe("pending_unsupported");
    expect(pending?.evidence).toContain("provider:invalid model");
    expect(pending?.evidence).not.toContain("weak:invalid model");
    expect(pending?.evidence).not.toContain("provider:realtimexai_invalid_model");

    const second = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-7",
      provider: "realtimexai",
      model: "text-model",
      error,
    });

    expect(second).toBe("unsupported");
  });

  it("learns capability mismatch for generic vision-not-supported phrasing", async () => {
    const supabase = createSupabaseMock();
    const error = {
      message: "Vision is not supported on this model",
      status: 400,
    };

    const first = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-8",
      provider: "openai",
      model: "gpt-4.1-mini",
      error,
    });

    const second = await ModelCapabilityService.learnVisionFailure({
      supabase: supabase.client,
      userId: "user-8",
      provider: "openai",
      model: "gpt-4.1-mini",
      error,
    });

    expect(first).toBe("unknown");
    expect(second).toBe("unsupported");
  });
});
