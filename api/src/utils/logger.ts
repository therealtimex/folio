import type { SupabaseClient } from "@supabase/supabase-js";

interface LogData {
  [key: string]: unknown;
}

class LoggerCore {
  private static persistence:
    | {
        supabase: SupabaseClient;
        userId: string;
      }
    | null = null;

  static setPersistence(supabase: SupabaseClient, userId: string) {
    this.persistence = { supabase, userId };
  }

  static clearPersistence() {
    this.persistence = null;
  }

  static async persist(level: string, scope: string, message: string, data?: LogData) {
    if (!this.persistence) {
      return;
    }

    try {
      await this.persistence.supabase.from("system_logs").insert({
        user_id: this.persistence.userId,
        level,
        scope,
        message,
        metadata: data || {}
      });
    } catch {
      // persistence is best-effort and should never crash request flow
    }
  }
}

export const Logger = LoggerCore;

export function createLogger(scope: string) {
  function write(level: "debug" | "info" | "warn" | "error", message: string, data?: LogData) {
    const line = `[${scope}] ${message}`;

    if (level === "error") {
      console.error(line, data || "");
    } else if (level === "warn") {
      console.warn(line, data || "");
    } else if (level === "info") {
      console.info(line, data || "");
    } else {
      console.debug(line, data || "");
    }

    void Logger.persist(level, scope, message, data);
  }

  return {
    debug: (message: string, data?: LogData) => write("debug", message, data),
    info: (message: string, data?: LogData) => write("info", message, data),
    warn: (message: string, data?: LogData) => write("warn", message, data),
    error: (message: string, data?: LogData) => write("error", message, data)
  };
}
