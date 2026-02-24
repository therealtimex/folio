import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, createErrorResponse } from "../_shared/cors.ts";

async function createFirstUser(req: Request) {
    try {
        const { email, password, first_name, last_name } = await req.json();
        console.log(`[Setup] Starting setup for ${email}`);

        const supabaseAdmin = getAdminClient();

        // Check if any users exist
        const { count, error: countError } = await supabaseAdmin
            .from("profiles")
            .select("*", { count: "exact", head: true });

        if (countError) {
            console.error("[Setup] Error checking profiles table:", countError);
            return createErrorResponse(500, `Database error checking profiles: ${countError.message} (code: ${countError.code})`);
        }

        console.log(`[Setup] Existing profiles count: ${count}`);
        if (count && count > 0) {
            return createErrorResponse(403, "First user already exists");
        }

        // Create user with admin API
        console.log("[Setup] Creating admin user...");
        const { data, error: userError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { first_name, last_name },
        });

        if (userError || !data?.user) {
            console.error("[Setup] Error creating auth user:", userError);
            return createErrorResponse(500, `Failed to create auth user: ${userError?.message || 'Unknown error'}`);
        }

        console.log(`[Setup] User created successfully: ${data.user.id}. Creating profile...`);

        // Explicitly create profile as admin
        const { error: profileError } = await supabaseAdmin
            .from("profiles")
            .upsert({
                id: data.user.id,
                email: data.user.email,
                first_name: first_name || null,
                last_name: last_name || null,
                is_admin: true,
            }, { onConflict: 'id' });

        if (profileError) {
            console.error("[Setup] Error creating profile row:", profileError);
            return createErrorResponse(500, `User created but profile record failed: ${profileError.message} (code: ${profileError.code})`);
        }

        console.log("[Setup] Setup completed successfully");

        return new Response(
            JSON.stringify({
                data: {
                    id: data.user.id,
                    email: data.user.email,
                },
            }),
            {
                headers: { "Content-Type": "application/json", ...corsHeaders },
            },
        );
    } catch (error) {
        console.error("Unexpected error in createFirstUser:", error);
        return createErrorResponse(500, `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (req.method === "POST") {
        return createFirstUser(req);
    }

    return createErrorResponse(405, "Method Not Allowed");
});
