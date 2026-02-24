-- Fix get_latest_migration_timestamp() to exclude sentinel/test migrations
-- Migrations with timestamps >= 29990000000000 are development-only sentinels
-- and should not influence the migration version comparison logic.
CREATE OR REPLACE FUNCTION get_latest_migration_timestamp()
RETURNS text AS $$
    SELECT max(version)::text
    FROM supabase_migrations.schema_migrations
    WHERE version < '29990000000000';
$$ LANGUAGE sql SECURITY DEFINER;
