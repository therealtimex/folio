-- Workspace member management RPC helpers.
-- These SECURITY DEFINER functions provide controlled cross-member management
-- while keeping table-level RLS strict.

create or replace function public.workspace_list_members(
    p_workspace_id uuid
)
returns table (
    user_id uuid,
    role text,
    status text,
    joined_at timestamptz,
    first_name text,
    last_name text,
    email text,
    avatar_url text,
    is_current_user boolean
)
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_catalog'
as $$
declare
    requester_id uuid := auth.uid();
    requester_role text;
begin
    if requester_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    select wm.role
    into requester_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = requester_id
      and wm.status = 'active'
    limit 1;

    if requester_role is null then
        raise exception 'Workspace membership required' using errcode = '42501';
    end if;

    return query
    select
        wm.user_id,
        wm.role,
        wm.status,
        wm.created_at as joined_at,
        p.first_name,
        p.last_name,
        coalesce(p.email, u.email) as email,
        p.avatar_url,
        (wm.user_id = requester_id) as is_current_user
    from public.workspace_members wm
    left join public.profiles p
      on p.id = wm.user_id
    left join auth.users u
      on u.id = wm.user_id
    where wm.workspace_id = p_workspace_id
    order by
        case wm.role
            when 'owner' then 0
            when 'admin' then 1
            else 2
        end,
        wm.created_at,
        wm.user_id;
end;
$$;

grant execute on function public.workspace_list_members(uuid) to authenticated;

create or replace function public.workspace_invite_member(
    p_workspace_id uuid,
    p_email text,
    p_role text default 'member'
)
returns table (
    user_id uuid,
    role text,
    status text
)
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_catalog'
as $$
declare
    requester_id uuid := auth.uid();
    requester_role text;
    target_email text := lower(trim(coalesce(p_email, '')));
    target_user_id uuid;
    existing_role text;
begin
    if requester_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    if p_role not in ('admin', 'member') then
        raise exception 'Invalid role. Expected admin or member.' using errcode = '22023';
    end if;

    if target_email = '' then
        raise exception 'Email is required' using errcode = '22023';
    end if;

    select wm.role
    into requester_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = requester_id
      and wm.status = 'active'
    limit 1;

    if requester_role not in ('owner', 'admin') then
        raise exception 'Only workspace admins can invite members' using errcode = '42501';
    end if;

    if p_role = 'admin' and requester_role <> 'owner' then
        raise exception 'Only workspace owners can invite admins' using errcode = '42501';
    end if;

    select u.id
    into target_user_id
    from auth.users u
    where lower(coalesce(u.email, '')) = target_email
    limit 1;

    if target_user_id is null then
        raise exception 'No user found with that email. They must sign up first.' using errcode = '22023';
    end if;

    select wm.role
    into existing_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = target_user_id
    limit 1;

    if existing_role = 'owner' then
        raise exception 'Owner membership cannot be modified' using errcode = '42501';
    end if;

    if requester_role <> 'owner' and existing_role = 'admin' then
        raise exception 'Only workspace owners can modify admin memberships' using errcode = '42501';
    end if;

    if existing_role is null then
        insert into public.workspace_members (workspace_id, user_id, role, status)
        values (p_workspace_id, target_user_id, p_role, 'active');
    else
        update public.workspace_members
        set
            role = p_role,
            status = 'active',
            updated_at = now()
        where workspace_id = p_workspace_id
          and user_id = target_user_id;
    end if;

    return query
    select wm.user_id, wm.role, wm.status
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = target_user_id
    limit 1;
end;
$$;

grant execute on function public.workspace_invite_member(uuid, text, text) to authenticated;

create or replace function public.workspace_update_member_role(
    p_workspace_id uuid,
    p_target_user_id uuid,
    p_role text
)
returns table (
    user_id uuid,
    role text,
    status text
)
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_catalog'
as $$
declare
    requester_id uuid := auth.uid();
    requester_role text;
    target_role text;
begin
    if requester_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    if p_role not in ('admin', 'member') then
        raise exception 'Invalid role. Expected admin or member.' using errcode = '22023';
    end if;

    select wm.role
    into requester_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = requester_id
      and wm.status = 'active'
    limit 1;

    if requester_role not in ('owner', 'admin') then
        raise exception 'Only workspace admins can manage roles' using errcode = '42501';
    end if;

    if p_role = 'admin' and requester_role <> 'owner' then
        raise exception 'Only workspace owners can promote admins' using errcode = '42501';
    end if;

    select wm.role
    into target_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_target_user_id
      and wm.status = 'active'
    limit 1;

    if target_role is null then
        raise exception 'Workspace member not found' using errcode = '22023';
    end if;

    if target_role = 'owner' then
        raise exception 'Owner membership cannot be modified' using errcode = '42501';
    end if;

    if requester_role <> 'owner' and target_role = 'admin' then
        raise exception 'Only workspace owners can modify admin roles' using errcode = '42501';
    end if;

    update public.workspace_members
    set
        role = p_role,
        updated_at = now()
    where workspace_id = p_workspace_id
      and user_id = p_target_user_id;

    return query
    select wm.user_id, wm.role, wm.status
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_target_user_id
    limit 1;
end;
$$;

grant execute on function public.workspace_update_member_role(uuid, uuid, text) to authenticated;

create or replace function public.workspace_remove_member(
    p_workspace_id uuid,
    p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_catalog'
as $$
declare
    requester_id uuid := auth.uid();
    requester_role text;
    target_role text;
begin
    if requester_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    select wm.role
    into requester_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = requester_id
      and wm.status = 'active'
    limit 1;

    if requester_role not in ('owner', 'admin') then
        raise exception 'Only workspace admins can remove members' using errcode = '42501';
    end if;

    select wm.role
    into target_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_target_user_id
      and wm.status = 'active'
    limit 1;

    if target_role is null then
        return false;
    end if;

    if target_role = 'owner' then
        raise exception 'Owner membership cannot be removed' using errcode = '42501';
    end if;

    if requester_role <> 'owner' and target_role = 'admin' then
        raise exception 'Only workspace owners can remove admins' using errcode = '42501';
    end if;

    delete from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_target_user_id;

    return found;
end;
$$;

grant execute on function public.workspace_remove_member(uuid, uuid) to authenticated;
