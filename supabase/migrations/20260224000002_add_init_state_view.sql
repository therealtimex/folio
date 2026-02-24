-- Init-state parity with email-automator, adapted for Folio.
-- In Folio, user presence is represented by public.profiles.

create or replace view public.init_state
  with (security_invoker=off)
  as
select
  count(id) as is_initialized
from
  (
    select
      profiles.id
    from
      public.profiles
    limit
      1
  ) sub;

grant usage on schema public to anon, authenticated;
grant select on public.init_state to anon, authenticated;
