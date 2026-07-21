-- Replace the raw event-oriented admin audit view with request-user moderation.
-- Temporary timeouts are enforced at the request table boundary so no public
-- client or alternate request creator can bypass them.

create table if not exists public.marshy_control_timeouts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text,
  timed_out_at timestamp with time zone not null default pg_catalog.now(),
  timed_out_until timestamp with time zone not null,
  timed_out_by uuid references auth.users (id) on delete set null,
  constraint marshy_control_timeout_reason_length check (
    reason is null or pg_catalog.char_length(reason) <= 200
  ),
  constraint marshy_control_timeout_order check (
    timed_out_until > timed_out_at
  )
);

alter table public.marshy_control_timeouts enable row level security;
revoke all privileges on table public.marshy_control_timeouts
from public, anon, authenticated;

create or replace function public.control_clear_marshy_timeout_on_block()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  delete from public.marshy_control_timeouts
  where user_id = new.user_id;

  return new;
end;
$function$;

revoke all on function public.control_clear_marshy_timeout_on_block()
from public, anon, authenticated;

drop trigger if exists marshy_control_clear_timeout_on_block
on public.marshy_control_blocks;

create trigger marshy_control_clear_timeout_on_block
after insert or update on public.marshy_control_blocks
for each row
execute function public.control_clear_marshy_timeout_on_block();

create or replace function public.control_reject_timed_out_marshy_request()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
begin
  if exists (
    select 1
    from public.marshy_control_timeouts as timeout
    where timeout.user_id = new.user_id
      and timeout.timed_out_until > checked_at
  ) then
    raise exception using errcode = '42501', message = 'control_access_timed_out';
  end if;

  return new;
end;
$function$;

revoke all on function public.control_reject_timed_out_marshy_request()
from public, anon, authenticated;

drop trigger if exists marshy_control_reject_timed_out_request
on public.marshy_control_requests;

create trigger marshy_control_reject_timed_out_request
before insert on public.marshy_control_requests
for each row
execute function public.control_reject_timed_out_marshy_request();

create or replace function public.admin_get_marshy_control_request_users(
  requested_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.statement_timestamp();
  safe_limit integer := least(250, greatest(1, coalesce(requested_limit, 100)));
  result jsonb;
begin
  perform public.control_require_site_admin();

  select coalesce(
    pg_catalog.jsonb_agg(entry.payload order by entry.last_request_at desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      latest.last_request_at,
      pg_catalog.jsonb_build_object(
        'user_id', latest.user_id,
        'discord_username', coalesce(
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'preferred_username'), ''),
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'user_name'), ''),
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'name'), ''),
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'full_name'), ''),
          'Discord user'
        ),
        'last_request_id', latest.id,
        'last_action', latest.resolved_action,
        'last_status', latest.status,
        'last_request_at', latest.last_request_at,
        'request_count', latest.request_count,
        'is_blocked', blocked.user_id is not null,
        'block_reason', blocked.reason,
        'timeout_until', case
          when timeout.timed_out_until > checked_at then timeout.timed_out_until
          else null
        end,
        'timeout_reason', case
          when timeout.timed_out_until > checked_at then timeout.reason
          else null
        end
      ) as payload
    from (
      select ranked.*
      from (
        select
          request.id,
          request.user_id,
          request.resolved_action,
          request.status,
          request.requested_at as last_request_at,
          pg_catalog.count(*) over (
            partition by request.user_id
          )::integer as request_count,
          pg_catalog.row_number() over (
            partition by request.user_id
            order by request.requested_at desc, request.id desc
          ) as request_rank
        from public.marshy_control_requests as request
      ) as ranked
      where ranked.request_rank = 1
      order by ranked.last_request_at desc
      limit safe_limit
    ) as latest
    left join auth.users as account on account.id = latest.user_id
    left join public.marshy_control_blocks as blocked
      on blocked.user_id = latest.user_id
    left join public.marshy_control_timeouts as timeout
      on timeout.user_id = latest.user_id
  ) as entry;

  return result;
end;
$function$;

revoke all on function public.admin_get_marshy_control_request_users(integer)
from public, anon, authenticated;
grant execute on function public.admin_get_marshy_control_request_users(integer)
to authenticated;

create or replace function public.admin_set_marshy_control_timeout(
  target_user_id uuid,
  timeout_minutes integer,
  timeout_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := public.control_require_site_admin();
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  timeout_until timestamp with time zone;
  clean_reason text := nullif(
    pg_catalog.left(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(coalesce(timeout_reason, '')),
        '[[:space:]]+',
        ' ',
        'g'
      ),
      200
    ),
    ''
  );
  request_row record;
begin
  if target_user_id is null
    or timeout_minutes is null
    or timeout_minutes < 0
    or timeout_minutes > 10080
  then
    raise exception using errcode = '22023', message = 'invalid_timeout_request';
  end if;

  if timeout_minutes = 0 then
    delete from public.marshy_control_timeouts
    where user_id = target_user_id;
  else
    timeout_until := checked_at + pg_catalog.make_interval(mins => timeout_minutes);

    insert into public.marshy_control_timeouts (
      user_id,
      reason,
      timed_out_at,
      timed_out_until,
      timed_out_by
    )
    values (
      target_user_id,
      clean_reason,
      checked_at,
      timeout_until,
      caller_id
    )
    on conflict (user_id) do update
    set
      reason = excluded.reason,
      timed_out_at = excluded.timed_out_at,
      timed_out_until = excluded.timed_out_until,
      timed_out_by = excluded.timed_out_by;

    for request_row in
      select request.id
      from public.marshy_control_requests as request
      where request.user_id = target_user_id
        and request.status = 'queued'
      for update
    loop
      perform public.control_refund_request(
        request_row.id,
        'cancelled',
        'user_timed_out_by_admin',
        'admin',
        caller_id,
        checked_at
      );
    end loop;
  end if;

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    details,
    created_at
  )
  values (
    case when timeout_minutes = 0 then 'user_timeout_removed' else 'user_timed_out' end,
    'admin',
    caller_id,
    pg_catalog.jsonb_build_object(
      'target_user_id', target_user_id,
      'timeout_minutes', timeout_minutes,
      'timeout_until', timeout_until,
      'reason', clean_reason
    ),
    checked_at
  );

  return pg_catalog.jsonb_build_object(
    'user_id', target_user_id,
    'timeout_until', timeout_until
  );
end;
$function$;

revoke all on function public.admin_set_marshy_control_timeout(uuid, integer, text)
from public, anon, authenticated;
grant execute on function public.admin_set_marshy_control_timeout(uuid, integer, text)
to authenticated;

comment on table public.marshy_control_timeouts is
  'Owner-managed request timeouts. Expired rows do not block new requests and contain no credentials.';
