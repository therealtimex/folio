-- Folio foundation schema

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  llm_provider text,
  llm_model text,
  sync_interval_minutes integer not null default 5 check (sync_interval_minutes >= 1 and sync_interval_minutes <= 60),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  credentials jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, provider)
);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  source_type text not null,
  payload jsonb not null default '{}'::jsonb,
  runtime_key text,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  level text not null,
  scope text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.integrations enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.system_logs enable row level security;

create policy "profiles own rows" on public.profiles
  for all using (auth.uid() = id);

create policy "user_settings own rows" on public.user_settings
  for all using (auth.uid() = user_id);

create policy "integrations own rows" on public.integrations
  for all using (auth.uid() = user_id);

create policy "processing_jobs own rows" on public.processing_jobs
  for all using (auth.uid() = user_id);

create policy "system_logs own rows" on public.system_logs
  for all using (auth.uid() = user_id);

create index if not exists idx_user_settings_user_id on public.user_settings(user_id);
create index if not exists idx_integrations_user_id on public.integrations(user_id);
create index if not exists idx_processing_jobs_user_id on public.processing_jobs(user_id);
create index if not exists idx_processing_jobs_status on public.processing_jobs(status);
create index if not exists idx_system_logs_user_id_created_at on public.system_logs(user_id, created_at desc);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

drop trigger if exists update_user_settings_updated_at on public.user_settings;
create trigger update_user_settings_updated_at
before update on public.user_settings
for each row execute function public.update_updated_at_column();

drop trigger if exists update_integrations_updated_at on public.integrations;
create trigger update_integrations_updated_at
before update on public.integrations
for each row execute function public.update_updated_at_column();

drop trigger if exists update_processing_jobs_updated_at on public.processing_jobs;
create trigger update_processing_jobs_updated_at
before update on public.processing_jobs
for each row execute function public.update_updated_at_column();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
