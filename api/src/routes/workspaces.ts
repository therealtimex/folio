import { Router } from "express";

import { config } from "../config/index.js";
import { optionalAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getSupabaseConfigFromHeaders } from "../services/supabase.js";

type WorkspaceRole = "owner" | "admin" | "member";
type WorkspaceStatus = "active" | "invited" | "disabled";

type WorkspaceMembershipRow = {
    workspace_id: string;
    role: WorkspaceRole;
    status: WorkspaceStatus;
    created_at: string;
    updated_at: string;
};

type WorkspaceRow = {
    id: string;
    name: string;
    owner_user_id: string;
    created_at: string;
    updated_at: string;
};

type WorkspaceMemberRow = {
    user_id: string;
    role: WorkspaceRole;
    status: WorkspaceStatus;
    joined_at: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    avatar_url: string | null;
    is_current_user: boolean;
};

function mapRpcStatus(errorCode?: string): number {
    if (errorCode === "42501") return 403;
    if (errorCode === "22023") return 400;
    return 500;
}

const router = Router();
router.use(optionalAuth);

router.get("/", asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
    }

    const { data: membershipsData, error: membershipsError } = await req.supabase
        .from("workspace_members")
        .select("workspace_id,role,status,created_at,updated_at")
        .eq("user_id", req.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true });

    if (membershipsError) {
        const code = (membershipsError as { code?: string }).code;
        // Backward compatibility for projects before workspace migration.
        if (code === "42P01") {
            res.json({
                success: true,
                workspaces: [],
                activeWorkspaceId: null,
                activeWorkspaceRole: null,
            });
            return;
        }
        res.status(500).json({ success: false, error: membershipsError.message });
        return;
    }

    const memberships = (membershipsData ?? []) as WorkspaceMembershipRow[];
    if (memberships.length === 0) {
        res.json({
            success: true,
            workspaces: [],
            activeWorkspaceId: null,
            activeWorkspaceRole: null,
        });
        return;
    }

    const workspaceIds = memberships.map((membership) => membership.workspace_id);
    const { data: workspaceData, error: workspaceError } = await req.supabase
        .from("workspaces")
        .select("id,name,owner_user_id,created_at,updated_at")
        .in("id", workspaceIds);

    if (workspaceError) {
        res.status(500).json({ success: false, error: workspaceError.message });
        return;
    }

    const workspaceMap = new Map<string, WorkspaceRow>();
    for (const workspace of (workspaceData ?? []) as WorkspaceRow[]) {
        workspaceMap.set(workspace.id, workspace);
    }

    const workspaces = memberships
        .map((membership) => {
            const workspace = workspaceMap.get(membership.workspace_id);
            if (!workspace) return null;
            return {
                id: workspace.id,
                name: workspace.name,
                owner_user_id: workspace.owner_user_id,
                created_at: workspace.created_at,
                updated_at: workspace.updated_at,
                role: membership.role,
                membership_status: membership.status,
                membership_created_at: membership.created_at,
            };
        })
        .filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace));

    const activeWorkspaceId = req.workspaceId ?? workspaces[0]?.id ?? null;
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

    res.json({
        success: true,
        workspaces,
        activeWorkspaceId,
        activeWorkspaceRole: activeWorkspace?.role ?? null,
    });
}));

router.get("/:workspaceId/members", asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
    }

    const workspaceId = req.params["workspaceId"] as string;
    if (!workspaceId) {
        res.status(400).json({ success: false, error: "workspaceId is required" });
        return;
    }

    const { data, error } = await req.supabase.rpc("workspace_list_members", {
        p_workspace_id: workspaceId,
    });

    if (error) {
        const status = mapRpcStatus((error as { code?: string }).code);
        res.status(status).json({ success: false, error: error.message });
        return;
    }

    res.json({
        success: true,
        members: (data ?? []) as WorkspaceMemberRow[],
    });
}));

router.post("/:workspaceId/members/invite", asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
    }

    const workspaceId = req.params["workspaceId"] as string;
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const role = req.body?.role === "admin" ? "admin" : "member";

    if (!workspaceId) {
        res.status(400).json({ success: false, error: "workspaceId is required" });
        return;
    }

    if (!email) {
        res.status(400).json({ success: false, error: "email is required" });
        return;
    }

    const headerConfig = getSupabaseConfigFromHeaders(req.headers as Record<string, unknown>);
    const envUrl = config.supabase.url;
    const envKey = config.supabase.anonKey;
    const envIsValid = envUrl.startsWith("http://") || envUrl.startsWith("https://");
    const supabaseUrl = envIsValid && envKey ? envUrl : headerConfig?.url;
    const anonKey = envIsValid && envKey ? envKey : headerConfig?.anonKey;

    if (!supabaseUrl || !anonKey) {
        res.status(500).json({ success: false, error: "Supabase config unavailable for invite workflow." });
        return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/workspace-invite`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            apikey: anonKey,
        },
        body: JSON.stringify({
            workspace_id: workspaceId,
            email,
            role,
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        res.status(response.status).json({
            success: false,
            error: payload?.error?.message || payload?.error || `Invite workflow failed (${response.status})`,
        });
        return;
    }

    res.json(payload);
}));

router.patch("/:workspaceId/members/:userId", asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
    }

    const workspaceId = req.params["workspaceId"] as string;
    const userId = req.params["userId"] as string;
    const role = req.body?.role === "admin" ? "admin" : req.body?.role === "member" ? "member" : "";

    if (!workspaceId || !userId) {
        res.status(400).json({ success: false, error: "workspaceId and userId are required" });
        return;
    }

    if (!role) {
        res.status(400).json({ success: false, error: "role must be admin or member" });
        return;
    }

    const { data, error } = await req.supabase.rpc("workspace_update_member_role", {
        p_workspace_id: workspaceId,
        p_target_user_id: userId,
        p_role: role,
    });

    if (error) {
        const status = mapRpcStatus((error as { code?: string }).code);
        res.status(status).json({ success: false, error: error.message });
        return;
    }

    res.json({
        success: true,
        member: Array.isArray(data) ? data[0] ?? null : null,
    });
}));

router.delete("/:workspaceId/members/:userId", asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
    }

    const workspaceId = req.params["workspaceId"] as string;
    const userId = req.params["userId"] as string;

    if (!workspaceId || !userId) {
        res.status(400).json({ success: false, error: "workspaceId and userId are required" });
        return;
    }

    const { data, error } = await req.supabase.rpc("workspace_remove_member", {
        p_workspace_id: workspaceId,
        p_target_user_id: userId,
    });

    if (error) {
        const status = mapRpcStatus((error as { code?: string }).code);
        res.status(status).json({ success: false, error: error.message });
        return;
    }

    res.json({ success: true, removed: data === true });
}));

export default router;
