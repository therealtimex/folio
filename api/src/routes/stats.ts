import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();

// Dashboard stats require authentication
router.use(optionalAuth);

export interface DashboardStats {
    totalDocuments: number;
    activePolicies: number;
    ragChunks: number;
    automationRuns: number;
}

router.get("/", async (req, res) => {
    if (!req.user || !req.supabase) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
    }

    try {
        const userId = req.user.id;
        const s = req.supabase; // the scoped service client

        // 1. Total Documents Ingested
        const { count: totalDocumentsCount, error: err1 } = await s
            .from("ingestions")
            .select("*", { count: 'exact', head: true })
            .eq("user_id", userId);

        // 2. Active Policies
        const { count: activePoliciesCount, error: err2 } = await s
            .from("policies")
            .select("*", { count: 'exact', head: true })
            .eq("user_id", userId)
            .eq("enabled", true);

        // 3. RAG Knowledge Base (Chunks)
        const { count: ragChunksCount, error: err3 } = await s
            .from("document_chunks")
            .select("*", { count: 'exact', head: true })
            .eq("user_id", userId);

        // 4. Automation Runs (Sum of actions taken across ingestions)
        const { data: ingestionsWithActions, error: err4 } = await s
            .from("ingestions")
            .select("actions_taken")
            .eq("user_id", userId)
            .not("actions_taken", "is", null);

        let automationRunsCount = 0;
        if (ingestionsWithActions) {
            for (const ing of ingestionsWithActions) {
                if (Array.isArray(ing.actions_taken)) {
                    automationRunsCount += ing.actions_taken.length;
                }
            }
        }

        if (err1 || err2 || err3 || err4) {
            console.error("Stats fetching errors:", { err1, err2, err3, err4 });
            // Don't fail completely if one fails, just return 0s or what we have
        }

        const stats: DashboardStats = {
            totalDocuments: totalDocumentsCount ?? 0,
            activePolicies: activePoliciesCount ?? 0,
            ragChunks: ragChunksCount ?? 0,
            automationRuns: automationRunsCount
        };

        res.json({ success: true, stats });
    } catch (error: any) {
        console.error("Dashboard Stats Route Error:", error);
        res.status(500).json({ success: false, error: error.message || "Failed to fetch dashboard stats" });
    }
});

export default router;
