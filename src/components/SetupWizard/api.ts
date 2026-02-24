import { Organization, ProvisioningResult, SSEEvent } from "./types";
import { readStream } from "./streamParser";

export class SetupApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "SetupApiError";
  }
}

export async function fetchOrganizations(accessToken: string): Promise<Organization[]> {
  const response = await fetch("/api/setup/organizations", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const rawBody = await response.text();
  let data: Record<string, unknown> = {};
  if (rawBody.trim()) {
    try {
      data = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      data = { message: rawBody.trim() };
    }
  }
  if (!response.ok) {
    const message =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      `${response.status} ${response.statusText} while fetching organizations`;

    const hint =
      response.status === 500 || response.status === 502
        ? " If local API is not running, start `npm run dev:api` and retry."
        : "";

    throw new SetupApiError(`${message}${hint}`, "FETCH_ORGS_FAILED", response.status);
  }

  return data as unknown as Organization[];
}

export async function autoProvisionProject(
  params: {
    accessToken: string;
    orgId: string;
    projectName: string;
    region: string;
  },
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  const response = await fetch("/api/setup/auto-provision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.accessToken}`
    },
    body: JSON.stringify({
      orgId: params.orgId,
      projectName: params.projectName,
      region: params.region
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new SetupApiError(data?.error || "Failed to auto-provision", "PROVISION_FAILED", response.status);
  }

  await readStream(response, onEvent, {
    timeout: 360_000,
    onError: (error) => {
      throw new SetupApiError(`Provisioning stream error: ${error.message}`, "STREAM_ERROR");
    }
  });
}

export async function recoverProvisionedProject(params: {
  accessToken: string;
  projectRef: string;
}): Promise<ProvisioningResult> {
  const response = await fetch(`/api/setup/projects/${encodeURIComponent(params.projectRef)}/credentials`, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new SetupApiError(
      data?.error || "Failed to recover project credentials",
      "RECOVERY_FAILED",
      response.status
    );
  }

  return {
    projectId: String(data.projectId || params.projectRef),
    url: String(data.url || `https://${params.projectRef}.supabase.co`),
    anonKey: String(data.anonKey || ""),
    dbPass: ""
  };
}

export async function runMigration(
  params: {
    projectRef: string;
    accessToken: string;
    anonKey?: string;
  },
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  const response = await fetch("/api/migrate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      projectRef: params.projectRef,
      accessToken: params.accessToken,
      anonKey: params.anonKey
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new SetupApiError(data?.error || "Failed to run migration", "MIGRATION_FAILED", response.status);
  }

  await readStream(response, onEvent, {
    timeout: 600_000,
    onError: (error) => {
      throw new SetupApiError(`Migration stream error: ${error.message}`, "STREAM_ERROR");
    }
  });
}
