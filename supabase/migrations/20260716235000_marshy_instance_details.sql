-- Run this in Supabase > SQL Editor whenever this file changes.
-- The public website reads a privacy-filtered function. Only site admins can
-- read the underlying row or change the manual privacy override.

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.site_admins enable row level security;

create table if not exists public.marshy_status (
  id text primary key default 'marshy',
  state text not null default 'unknown'
    check (state in ('unknown', 'offline', 'online', 'traveling', 'private', 'public')),
  world_name text,
  instance_type text,
  player_count integer,
  player_names jsonb,
  message text,
  source text not null default 'setup',
  force_hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint marshy_status_single_row check (id = 'marshy'),
  constraint marshy_status_world_length check (
    world_name is null or char_length(world_name) between 1 and 160
  ),
  constraint marshy_status_message_length check (
    message is null or char_length(message) <= 200
  )
);

alter table public.marshy_status
  add column if not exists instance_type text,
  add column if not exists player_count integer,
  add column if not exists player_names jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'marshy_status_instance_type'
  ) then
    alter table public.marshy_status
      add constraint marshy_status_instance_type check (
        instance_type is null or instance_type in (
          'Public', 'Friends+', 'Friends', 'Group+', 'Group Public', 'Group', 'Invite+', 'Invite'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'marshy_status_player_count'
  ) then
    alter table public.marshy_status
      add constraint marshy_status_player_count check (
        player_count is null or player_count between 0 and 200
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'marshy_status_player_names'
  ) then
    alter table public.marshy_status
      add constraint marshy_status_player_names check (
        player_names is null or jsonb_typeof(player_names) = 'array'
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'marshy_status_roster_privacy'
  ) then
    alter table public.marshy_status
      add constraint marshy_status_roster_privacy check (
        state = 'public' or (player_count is null and player_names is null)
      );
  end if;
end
$$;

insert into public.marshy_status (
  id,
  state,
  source,
  force_hidden,
  updated_at
)
values (
  'marshy',
  'unknown',
  'setup',
  false,
  now()
)
on conflict (id) do nothing;

alter table public.marshy_status enable row level security;
alter table public.marshy_status replica identity full;

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to authenticated;

do $policy_cleanup$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'marshy_status'
  loop
    execute pg_catalog.format(
      'drop policy %I on public.marshy_status',
      existing_policy.policyname
    );
  end loop;
end;
$policy_cleanup$;

create policy "Site admins can read Marshy status"
on public.marshy_status
for select
to authenticated
using (public.is_site_admin());

create policy "Site admins can update Marshy status"
on public.marshy_status
for update
to authenticated
using (public.is_site_admin())
with check (id = 'marshy' and public.is_site_admin());

revoke all privileges on table public.marshy_status
from anon, authenticated;
grant select, update on table public.marshy_status to authenticated;

create or replace function public.get_public_marshy_status()
returns table (
  state text,
  world_name text,
  instance_type text,
  player_count integer,
  player_names jsonb,
  updated_at timestamptz,
  force_hidden boolean,
  message text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when status.force_hidden then 'private' else status.state end,
    case when status.force_hidden then null else status.world_name end,
    case when status.force_hidden then null else status.instance_type end,
    case when status.force_hidden then null else status.player_count end,
    case when status.force_hidden then null else status.player_names end,
    status.updated_at,
    status.force_hidden,
    case when status.force_hidden then null else status.message end
  from public.marshy_status as status
  where status.id = 'marshy';
$$;

revoke all on function public.get_public_marshy_status() from public;
grant execute on function public.get_public_marshy_status() to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.marshy_status;
exception
  when duplicate_object then null;
end
$$;
