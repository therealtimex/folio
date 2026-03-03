import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { authenticate } from "../_shared/auth.ts";
import { corsHeaders, createErrorResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";

function mapRpcStatus(errorCode?: string): number {
  if (errorCode === "42501") return 403;
  if (errorCode === "22023") return 400;
  return 500;
}

function isMissingUserError(message?: string): boolean {
  return /no user found with that email/i.test(message ?? "");
}

type InvitePayload = {
  workspace_id?: string;
  email?: string;
  role?: string;
};

type WorkspaceInviteRpcRow = {
  user_id: string;
  role: "admin" | "member";
  status: "active" | "invited" | "disabled";
};

async function invokeInviteRpc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  workspaceId: string,
  email: string,
  role: "admin" | "member"
) {
  return client.rpc("workspace_invite_member", {
    p_workspace_id: workspaceId,
    p_email: email,
    p_role: role,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return createErrorResponse(405, "Method Not Allowed");
    }

    const { client } = await authenticate(req);
    const body = (await req.json()) as InvitePayload;

    const workspaceId = String(body.workspace_id ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : "";

    if (!workspaceId) {
      return createErrorResponse(400, "workspace_id is required");
    }

    if (!email) {
      return createErrorResponse(400, "email is required");
    }

    if (!role) {
      return createErrorResponse(400, "role must be admin or member");
    }

    let { data, error } = await invokeInviteRpc(client, workspaceId, email, role);
    let invitationEmailSent = false;

    if (error && isMissingUserError(error.message)) {
      const supabaseAdmin = getAdminClient();
      const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
      const inviteFailed = Boolean(inviteError);
      const alreadyRegistered = /already registered/i.test(inviteError?.message ?? "");

      if (inviteFailed && !alreadyRegistered) {
        return createErrorResponse(500, inviteError?.message ?? "Failed to send invitation email.");
      }

      invitationEmailSent = !alreadyRegistered;
      ({ data, error } = await invokeInviteRpc(client, workspaceId, email, role));
    }

    if (error) {
      return createErrorResponse(mapRpcStatus((error as { code?: string }).code), error.message);
    }

    const rows = (data ?? []) as WorkspaceInviteRpcRow[];
    return new Response(
      JSON.stringify({
        success: true,
        member: rows[0] ?? null,
        invitation_email_sent: invitationEmailSent,
      }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error) {
    return createErrorResponse(
      401,
      error instanceof Error ? error.message : "Unauthorized"
    );
  }
});
