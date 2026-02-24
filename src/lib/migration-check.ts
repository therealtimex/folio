import type { SupabaseClient } from "@supabase/supabase-js";

export const APP_VERSION = import.meta.env.VITE_APP_VERSION;
export const LATEST_MIGRATION_TIMESTAMP = import.meta.env.VITE_LATEST_MIGRATION_TIMESTAMP;

export interface DatabaseMigrationInfo {
  latestMigrationTimestamp: string | null;
}

async function withTimeout<T>(input: PromiseLike<T> | T, timeoutMs: number): Promise<T> {
  const promise = Promise.resolve(input);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export interface MigrationStatus {
  needsMigration: boolean;
  appVersion: string;
  latestMigrationTimestamp: string | null;
  message: string;
}

export async function getDatabaseMigrationInfo(
  supabase: SupabaseClient
): Promise<DatabaseMigrationInfo> {
  try {
    const { data, error } = await withTimeout(supabase.rpc("get_latest_migration_timestamp"), 12_000);

    if (error) {
      if ((error as { code?: string }).code === "42883") {
        return { latestMigrationTimestamp: "0" };
      }
      return { latestMigrationTimestamp: null };
    }

    return { latestMigrationTimestamp: data ?? null };
  } catch {
    return { latestMigrationTimestamp: null };
  }
}

export async function checkMigrationStatus(
  supabase: SupabaseClient
): Promise<MigrationStatus> {
  const dbInfo = await getDatabaseMigrationInfo(supabase);

  if (LATEST_MIGRATION_TIMESTAMP === "unknown") {
    return {
      needsMigration: true,
      appVersion: APP_VERSION,
      latestMigrationTimestamp: dbInfo.latestMigrationTimestamp,
      message: "App migration metadata missing."
    };
  }

  if (!dbInfo.latestMigrationTimestamp || dbInfo.latestMigrationTimestamp.trim() === "") {
    return {
      needsMigration: true,
      appVersion: APP_VERSION,
      latestMigrationTimestamp: dbInfo.latestMigrationTimestamp,
      message: "Database migration state unknown."
    };
  }

  if (LATEST_MIGRATION_TIMESTAMP > dbInfo.latestMigrationTimestamp) {
    return {
      needsMigration: true,
      appVersion: APP_VERSION,
      latestMigrationTimestamp: dbInfo.latestMigrationTimestamp,
      message: `Database is behind (${dbInfo.latestMigrationTimestamp}).`
    };
  }

  return {
    needsMigration: false,
    appVersion: APP_VERSION,
    latestMigrationTimestamp: dbInfo.latestMigrationTimestamp,
    message: "Database schema is up-to-date."
  };
}
