create or replace function public.get_latest_migration_timestamp()
returns text
language sql
security definer
set search_path = ''
as $$
  select max(version) from supabase_migrations.schema_migrations;
$$;

grant execute on function public.get_latest_migration_timestamp() to anon, authenticated;
