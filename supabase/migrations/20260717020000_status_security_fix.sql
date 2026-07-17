-- Enforce public status freshness at the database boundary and restore the
-- least-privilege administrator grant for databases that already applied the
-- earlier status migrations.
create or replace function public.get_public_marshy_status()
returns table (
  state text,
  world_name text,
  instance_type text,
  player_count integer,
  player_names jsonb,
  updated_at timestamp with time zone,
  force_hidden boolean,
  message text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with status_with_freshness as (
    select
      status.*,
      status.updated_at >= now() - interval '12 minutes' as is_current
    from public.marshy_status as status
    where status.id = 'marshy'
  )
  select
    case
      when status.force_hidden then 'private'
      when not status.is_current then 'unknown'
      else status.state
    end,
    case when status.force_hidden or not status.is_current then null else status.world_name end,
    case when status.force_hidden or not status.is_current then null else status.instance_type end,
    case when status.force_hidden or not status.is_current then null else status.player_count end,
    case when status.force_hidden or not status.is_current then null else status.player_names end,
    status.updated_at,
    status.force_hidden,
    case when status.force_hidden or not status.is_current then null else status.message end
  from status_with_freshness as status;
$function$;

revoke all on function public.get_public_marshy_status()
from public, anon, authenticated;
grant execute on function public.get_public_marshy_status()
to anon, authenticated;

revoke all privileges on table public.marshy_status
from public, anon, authenticated;
grant select on table public.marshy_status
to authenticated;
grant update (force_hidden) on table public.marshy_status
to authenticated;
