-- Allow the owner to configure a serialized cooldown as low as 10 seconds and
-- permit Extreme requests to follow other Extreme requests. Existing custom
-- cooldowns are preserved; the previous untouched default moves from 30 to 10.

alter table public.marshy_control_settings
  alter column cooldown_seconds set default 10;

alter table public.marshy_control_settings
  drop constraint if exists marshy_control_cooldown_floor;

alter table public.marshy_control_settings
  add constraint marshy_control_cooldown_floor
  check (cooldown_seconds between 10 and 600);

update public.marshy_control_settings as settings
set
  cooldown_seconds = 10,
  settings_version = settings.settings_version + 1,
  updated_at = pg_catalog.clock_timestamp()
where settings.id = 'marshy'
  and settings.cooldown_seconds = 30;

create or replace function public.enqueue_marshy_control_request(
  control_session_id uuid,
  requested_control text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  caller_id uuid;
  settings_row public.marshy_control_settings%rowtype;
  runtime_row public.marshy_control_runtime%rowtype;
  wallet_row public.marshy_control_wallets%rowtype;
  request_id uuid;
  normalized_control text := pg_catalog.lower(pg_catalog.btrim(coalesce(requested_control, '')));
  resolved_control text;
  resolved_cost integer;
  resolved_percent integer;
  resolved_duration integer;
  credited_seconds integer := 0;
  active_request_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );
  perform public.cleanup_marshy_control_queue(checked_at);

  if normalized_control not in ('vibrate', 'low', 'high', 'extreme')
    or control_session_id is null
  then
    raise exception using errcode = '22023', message = 'invalid_control_request';
  end if;

  select settings.*
  into settings_row
  from public.marshy_control_settings as settings
  where settings.id = 'marshy'
  for update;

  caller_id := public.control_require_discord_user(
    settings_row.minimum_discord_account_age_days
  );

  if exists (
    select 1
    from public.marshy_control_blocks as blocked
    where blocked.user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'control_access_blocked';
  end if;

  select runtime.*
  into runtime_row
  from public.marshy_control_runtime as runtime
  where runtime.id = 'marshy'
  for update;

  if not settings_row.controls_enabled
    or settings_row.emergency_stopped
    or runtime_row.companion_last_seen is null
    or runtime_row.companion_last_seen < checked_at - interval '20 seconds'
    or not runtime_row.pishock_connected
    or runtime_row.pishock_paused
    or not runtime_row.locally_armed
    or not runtime_row.local_cap_configured
  then
    raise exception using errcode = 'P0001', message = 'controller_not_ready';
  end if;

  select wallet.*
  into wallet_row
  from public.marshy_control_wallets as wallet
  where wallet.user_id = caller_id
  for update;

  if wallet_row.user_id is null
    or wallet_row.active_session_id is distinct from control_session_id
    or wallet_row.active_session_expires_at <= checked_at
  then
    raise exception using errcode = 'P0001', message = 'earning_session_required';
  end if;

  if wallet_row.last_accrual_at is not null then
    credited_seconds := least(
      10,
      greatest(
        0,
        pg_catalog.floor(
          extract(epoch from (checked_at - wallet_row.last_accrual_at))
        )::integer
      )
    );
  end if;

  update public.marshy_control_wallets
  set
    balance = least(300, balance + credited_seconds),
    active_session_expires_at = checked_at + interval '15 seconds',
    last_accrual_at = checked_at,
    updated_at = checked_at
  where user_id = caller_id
  returning * into wallet_row;

  if exists (
    select 1
    from public.marshy_control_requests as pending
    where pending.user_id = caller_id
      and pending.status in ('queued', 'executing')
  ) then
    raise exception using errcode = 'P0001', message = 'request_already_pending';
  end if;

  select pg_catalog.count(*)::integer
  into active_request_count
  from public.marshy_control_requests as pending
  where pending.status in ('queued', 'executing');

  if active_request_count >= settings_row.queue_limit then
    raise exception using errcode = 'P0001', message = 'control_queue_full';
  end if;

  resolved_control := normalized_control;


  select
    case resolved_control
      when 'vibrate' then 0
      when 'low' then settings_row.low_cost
      when 'high' then settings_row.high_cost
      when 'extreme' then settings_row.extreme_cost
    end,
    case resolved_control
      when 'vibrate' then settings_row.vibration_percent
      when 'low' then settings_row.low_percent
      when 'high' then settings_row.high_percent
      when 'extreme' then settings_row.extreme_percent
    end,
    case resolved_control
      when 'vibrate' then settings_row.vibration_duration_ms
      when 'low' then settings_row.low_duration_ms
      when 'high' then settings_row.high_duration_ms
      when 'extreme' then settings_row.extreme_duration_ms
    end
  into resolved_cost, resolved_percent, resolved_duration;

  if wallet_row.balance < resolved_cost then
    raise exception using errcode = 'P0001', message = 'not_enough_marshy_tokens';
  end if;

  insert into public.marshy_control_requests (
    user_id,
    requested_action,
    resolved_action,
    token_cost,
    tier_percent,
    duration_ms,
    status,
    settings_version,
    requested_at,
    expires_at
  )
  values (
    caller_id,
    normalized_control,
    resolved_control,
    resolved_cost,
    resolved_percent,
    resolved_duration,
    'queued',
    settings_row.settings_version,
    checked_at,
    checked_at + pg_catalog.make_interval(secs => settings_row.request_ttl_seconds)
  )
  returning id into request_id;

  update public.marshy_control_wallets
  set
    balance = balance - resolved_cost,
    updated_at = checked_at
  where user_id = caller_id;

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    request_id,
    details,
    created_at
  )
  values (
    'request_queued',
    'visitor',
    caller_id,
    request_id,
    pg_catalog.jsonb_build_object(
      'requested_action', normalized_control,
      'resolved_action', resolved_control,
      'token_cost', resolved_cost,
      'tier_percent_of_local_cap', resolved_percent,
      'duration_ms', resolved_duration,
      'settings_version', settings_row.settings_version
    ),
    checked_at
  );

  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'request_id', request_id,
    'requested_action', normalized_control,
    'resolved_action', resolved_control,
    'converted', false,
    'token_cost', resolved_cost,
    'state', public.get_marshy_control_state(control_session_id)
  );
end;
$function$;

revoke all on function public.enqueue_marshy_control_request(uuid, text)
from public, anon, authenticated;
grant execute on function public.enqueue_marshy_control_request(uuid, text)
to authenticated;
