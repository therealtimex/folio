-- Port user creation parity from email-automator (foundation only).
-- This keeps Folio profile bootstrap synced with auth.users lifecycle.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  should_be_admin boolean;
begin
  -- Serialize first-user admin assignment to avoid races.
  perform pg_advisory_xact_lock(602240003);

  select not exists (
    select 1
    from public.profiles p
    where p.is_admin = true
  )
  into should_be_admin;

  insert into public.profiles (id, first_name, last_name, email, is_admin)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.email,
    should_be_admin
  )
  on conflict (id) do update
  set
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    email = excluded.email,
    updated_at = now();

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_update_auth_user()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
begin
  update public.profiles
  set
    first_name = coalesce(new.raw_user_meta_data ->> 'first_name', first_name),
    last_name = coalesce(new.raw_user_meta_data ->> 'last_name', last_name),
    email = new.email,
    updated_at = now()
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update on auth.users
for each row
when (
  old.email is distinct from new.email
  or old.raw_user_meta_data is distinct from new.raw_user_meta_data
)
execute function public.handle_update_auth_user();

-- Backfill profiles for existing auth.users rows where trigger might not have run.
insert into public.profiles (id, first_name, last_name, email, is_admin, created_at, updated_at)
select
  u.id,
  u.raw_user_meta_data ->> 'first_name',
  u.raw_user_meta_data ->> 'last_name',
  u.email,
  false,
  coalesce(u.created_at, now()),
  now()
from auth.users u
where not exists (
  select 1
  from public.profiles p
  where p.id = u.id
);

-- Ensure exactly one bootstrap admin exists for legacy projects.
with admin_candidate as (
  select p.id
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by coalesce(u.created_at, p.created_at), p.id
  limit 1
)
update public.profiles p
set
  is_admin = true,
  updated_at = now()
where p.id in (select id from admin_candidate)
  and not exists (
    select 1
    from public.profiles existing_admin
    where existing_admin.is_admin = true
  );

-- Keep profile identity fields synchronized for existing users.
update public.profiles p
set
  first_name = coalesce(u.raw_user_meta_data ->> 'first_name', p.first_name),
  last_name = coalesce(u.raw_user_meta_data ->> 'last_name', p.last_name),
  email = u.email,
  updated_at = now()
from auth.users u
where u.id = p.id
  and (
    p.email is distinct from u.email
    or p.first_name is distinct from (u.raw_user_meta_data ->> 'first_name')
    or p.last_name is distinct from (u.raw_user_meta_data ->> 'last_name')
  );

-- Backfill user_settings for existing users if missing.
insert into public.user_settings (user_id)
select u.id
from auth.users u
where not exists (
  select 1
  from public.user_settings s
  where s.user_id = u.id
);
