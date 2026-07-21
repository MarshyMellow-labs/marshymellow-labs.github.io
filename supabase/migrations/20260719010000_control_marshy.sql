-- Control Marshy: Discord-authenticated token earning, a serialized safety queue,
-- companion telemetry, Pulsoid heart-rate projection, and administrator audit tools.
-- Physical intensity is never stored as an absolute device output. Tier percentages
-- are fractions of the separate maximum configured locally in the companion app.

set search_path = '';

create table if not exists public.marshy_control_settings (
  id text primary key default 'marshy',
  controls_enabled boolean not null default false,
  emergency_stopped boolean not null default true,
  share_heart_rate boolean not null default false,
  low_percent smallint not null default 33,
  high_percent smallint not null default 66,
  extreme_percent smallint not null default 100,
  low_cost smallint not null default 100,
  high_cost smallint not null default 200,
  extreme_cost smallint not null default 300,
  low_duration_ms smallint not null default 1000,
  high_duration_ms smallint not null default 1000,
  extreme_duration_ms smallint not null default 1000,
  vibration_percent smallint not null default 50,
  vibration_duration_ms smallint not null default 1000,
  cooldown_seconds smallint not null default 1,
  queue_limit smallint not null default 12,
  request_ttl_seconds smallint not null default 300,
  minimum_discord_account_age_days smallint not null default 7,
  settings_version bigint not null default 1,
  updated_at timestamp with time zone not null default pg_catalog.now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint marshy_control_settings_singleton check (id = 'marshy'),
  constraint marshy_control_tiers_in_order check (
    low_percent between 1 and 100
    and high_percent between low_percent and 100
    and extreme_percent between high_percent and 100
  ),
  constraint marshy_control_costs_in_order check (
    low_cost between 1 and 300
    and high_cost between low_cost and 300
    and extreme_cost between high_cost and 300
  ),
  constraint marshy_control_durations_safe check (
    low_duration_ms between 100 and 1000
    and high_duration_ms between 100 and 1000
    and extreme_duration_ms between 100 and 1000
    and vibration_duration_ms between 100 and 1000
  ),
  constraint marshy_control_vibration_range check (vibration_percent between 1 and 100),
  constraint marshy_control_cooldown_floor check (cooldown_seconds between 1 and 600),
  constraint marshy_control_queue_limit check (queue_limit between 1 and 50),
  constraint marshy_control_request_ttl check (request_ttl_seconds between 60 and 900),
  constraint marshy_control_discord_age check (
    minimum_discord_account_age_days between 0 and 3650
  )
);

insert into public.marshy_control_settings (id)
values ('marshy')
on conflict (id) do nothing;

create table if not exists public.marshy_control_runtime (
  id text primary key default 'marshy',
  companion_session_id text,
  companion_last_seen timestamp with time zone,
  pishock_connected boolean not null default false,
  pishock_paused boolean not null default true,
  locally_armed boolean not null default false,
  local_cap_configured boolean not null default false,
  pulsoid_connected boolean not null default false,
  pulsoid_live boolean not null default false,
  heart_rate smallint,
  heart_rate_measured_at timestamp with time zone,
  heart_rate_received_at timestamp with time zone,
  last_operation_at timestamp with time zone,
  executing_request_id uuid,
  stop_generation bigint not null default 1,
  stop_ack_generation bigint not null default 0,
  last_error text,
  updated_at timestamp with time zone not null default pg_catalog.now(),
  constraint marshy_control_runtime_singleton check (id = 'marshy'),
  constraint marshy_control_heart_rate_range check (
    heart_rate is null or heart_rate between 20 and 260
  ),
  constraint marshy_control_stop_ack_order check (
    stop_ack_generation >= 0 and stop_ack_generation <= stop_generation
  )
);

insert into public.marshy_control_runtime (id)
values ('marshy')
on conflict (id) do nothing;

create table if not exists public.marshy_control_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance smallint not null default 0,
  active_session_id uuid,
  active_session_expires_at timestamp with time zone,
  last_accrual_at timestamp with time zone,
  created_at timestamp with time zone not null default pg_catalog.now(),
  updated_at timestamp with time zone not null default pg_catalog.now(),
  constraint marshy_control_token_cap check (balance between 0 and 300)
);

create table if not exists public.marshy_control_blocks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text,
  blocked_at timestamp with time zone not null default pg_catalog.now(),
  blocked_by uuid references auth.users (id) on delete set null,
  constraint marshy_control_block_reason_length check (
    reason is null or pg_catalog.char_length(reason) <= 200
  )
);

create table if not exists public.marshy_control_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  requested_action text not null,
  resolved_action text not null,
  token_cost smallint not null,
  tier_percent smallint not null,
  duration_ms smallint not null,
  status text not null default 'queued',
  settings_version bigint not null,
  requested_at timestamp with time zone not null default pg_catalog.now(),
  expires_at timestamp with time zone not null,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  refunded_at timestamp with time zone,
  failure_reason text,
  constraint marshy_control_requested_action check (
    requested_action in ('vibrate', 'low', 'high', 'extreme')
  ),
  constraint marshy_control_resolved_action check (
    resolved_action in ('vibrate', 'low', 'high', 'extreme')
  ),
  constraint marshy_control_request_status check (
    status in (
      'queued',
      'executing',
      'executed',
      'cancelled',
      'expired',
      'failed',
      'uncertain'
    )
  ),
  constraint marshy_control_request_cost check (token_cost between 0 and 300),
  constraint marshy_control_request_tier check (tier_percent between 1 and 100),
  constraint marshy_control_request_duration check (duration_ms between 100 and 1000),
  constraint marshy_control_request_failure_length check (
    failure_reason is null or pg_catalog.char_length(failure_reason) <= 200
  )
);

create unique index if not exists marshy_control_one_pending_request_per_user
on public.marshy_control_requests (user_id)
where status in ('queued', 'executing');

create index if not exists marshy_control_queue_order
on public.marshy_control_requests (requested_at, id)
where status = 'queued';

create index if not exists marshy_control_request_history
on public.marshy_control_requests (user_id, requested_at desc);

create table if not exists public.marshy_control_audit_log (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_kind text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  request_id uuid references public.marshy_control_requests (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default pg_catalog.now(),
  constraint marshy_control_audit_event_length check (
    pg_catalog.char_length(event_type) between 2 and 80
  ),
  constraint marshy_control_audit_actor check (
    actor_kind in ('visitor', 'admin', 'companion', 'system')
  ),
  constraint marshy_control_audit_object check (
    pg_catalog.jsonb_typeof(details) = 'object'
  )
);

create index if not exists marshy_control_audit_latest
on public.marshy_control_audit_log (created_at desc, id desc);

alter table public.marshy_control_settings enable row level security;
alter table public.marshy_control_runtime enable row level security;
alter table public.marshy_control_wallets enable row level security;
alter table public.marshy_control_blocks enable row level security;
alter table public.marshy_control_requests enable row level security;
alter table public.marshy_control_audit_log enable row level security;

revoke all privileges on table public.marshy_control_settings
from public, anon, authenticated;
revoke all privileges on table public.marshy_control_runtime
from public, anon, authenticated;
revoke all privileges on table public.marshy_control_wallets
from public, anon, authenticated;
revoke all privileges on table public.marshy_control_blocks
from public, anon, authenticated;
revoke all privileges on table public.marshy_control_requests
from public, anon, authenticated;
revoke all privileges on table public.marshy_control_audit_log
from public, anon, authenticated;

create or replace function public.control_require_discord_user(
  minimum_account_age_days integer default 0
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
  discord_provider_id text;
  discord_created_at timestamp with time zone;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'discord_login_required';
  end if;

  select identity.provider_id
  into discord_provider_id
  from auth.identities as identity
  where identity.user_id = caller_id
    and identity.provider = 'discord'
  order by identity.created_at
  limit 1;

  if discord_provider_id is null then
    raise exception using errcode = '42501', message = 'discord_login_required';
  end if;

  if minimum_account_age_days > 0 then
    if discord_provider_id !~ '^[0-9]{15,20}$' then
      raise exception using errcode = '42501', message = 'discord_identity_invalid';
    end if;

    begin
      discord_created_at := pg_catalog.to_timestamp(
        (
          pg_catalog.floor(discord_provider_id::numeric / 4194304::numeric)
          + 1420070400000::numeric
        ) / 1000::numeric
      );
    exception
      when others then
        raise exception using errcode = '42501', message = 'discord_identity_invalid';
    end;

    if discord_created_at > pg_catalog.now()
      - pg_catalog.make_interval(days => minimum_account_age_days)
    then
      raise exception using errcode = '42501', message = 'discord_account_too_new';
    end if;
  end if;

  return caller_id;
end;
$function$;

revoke all on function public.control_require_discord_user(integer)
from public, anon, authenticated;

create or replace function public.control_require_site_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.is_site_admin() then
    raise exception using errcode = '42501', message = 'site_admin_required';
  end if;

  return caller_id;
end;
$function$;

revoke all on function public.control_require_site_admin()
from public, anon, authenticated;

create or replace function public.control_refund_request(
  target_request_id uuid,
  final_status text,
  reason text,
  event_actor_kind text,
  event_actor_user_id uuid default null,
  event_time timestamp with time zone default pg_catalog.now()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  queued_request public.marshy_control_requests%rowtype;
  clean_reason text := pg_catalog.left(
    pg_catalog.btrim(coalesce(reason, 'request_cancelled')),
    200
  );
begin
  if final_status not in ('cancelled', 'expired', 'failed', 'uncertain')
    or event_actor_kind not in ('visitor', 'admin', 'companion', 'system')
  then
    raise exception using errcode = '22023', message = 'invalid_refund_configuration';
  end if;

  select request.*
  into queued_request
  from public.marshy_control_requests as request
  where request.id = target_request_id
  for update;

  if queued_request.id is null
    or queued_request.status not in ('queued', 'executing')
  then
    return false;
  end if;

  update public.marshy_control_requests
  set
    status = final_status,
    completed_at = event_time,
    refunded_at = case
      when queued_request.refunded_at is null then event_time
      else queued_request.refunded_at
    end,
    failure_reason = nullif(clean_reason, '')
  where id = queued_request.id;

  if queued_request.refunded_at is null and queued_request.token_cost > 0 then
    update public.marshy_control_wallets
    set
      balance = least(300, balance + queued_request.token_cost),
      updated_at = event_time
    where user_id = queued_request.user_id;
  end if;

  update public.marshy_control_runtime
  set
    executing_request_id = case
      when executing_request_id = queued_request.id then null
      else executing_request_id
    end,
    updated_at = event_time
  where id = 'marshy';

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    request_id,
    details,
    created_at
  )
  values (
    'request_' || final_status,
    event_actor_kind,
    event_actor_user_id,
    queued_request.id,
    pg_catalog.jsonb_build_object(
      'reason', clean_reason,
      'tokens_refunded', queued_request.refunded_at is null,
      'token_cost', queued_request.token_cost
    ),
    event_time
  );

  return true;
end;
$function$;

revoke all on function public.control_refund_request(
  uuid,
  text,
  text,
  text,
  uuid,
  timestamp with time zone
)
from public, anon, authenticated;

create or replace function public.cleanup_marshy_control_queue(
  checked_at timestamp with time zone default pg_catalog.now()
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  settings_row public.marshy_control_settings%rowtype;
  runtime_row public.marshy_control_runtime%rowtype;
  request_row record;
  controller_unavailable boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );

  select settings.*
  into settings_row
  from public.marshy_control_settings as settings
  where settings.id = 'marshy';

  select runtime.*
  into runtime_row
  from public.marshy_control_runtime as runtime
  where runtime.id = 'marshy'
  for update;

  for request_row in
    select request.id
    from public.marshy_control_requests as request
    left join public.marshy_control_wallets as wallet
      on wallet.user_id = request.user_id
    where request.status = 'queued'
      and (
        request.expires_at <= checked_at
        or wallet.active_session_expires_at is null
        or wallet.active_session_expires_at <= checked_at
      )
    order by request.requested_at, request.id
    for update of request
  loop
    perform public.control_refund_request(
      request_row.id,
      'expired',
      'visitor_session_or_request_expired',
      'system',
      null,
      checked_at
    );
  end loop;

  controller_unavailable :=
    not settings_row.controls_enabled
    or settings_row.emergency_stopped
    or runtime_row.companion_last_seen is null
    or runtime_row.companion_last_seen is null
    or runtime_row.companion_last_seen < checked_at - interval '20 seconds'
    or not runtime_row.pishock_connected
    or runtime_row.pishock_paused
    or not runtime_row.locally_armed
    or not runtime_row.local_cap_configured;

  if controller_unavailable then
    for request_row in
      select request.id
      from public.marshy_control_requests as request
      where request.status = 'queued'
      order by request.requested_at, request.id
      for update
    loop
      perform public.control_refund_request(
        request_row.id,
        'cancelled',
        'controller_unavailable',
        'system',
        null,
        checked_at
      );
    end loop;
  end if;

  for request_row in
    select request.id
    from public.marshy_control_requests as request
    where request.status = 'executing'
      and request.started_at < checked_at - interval '15 seconds'
    for update
  loop
    perform public.control_refund_request(
      request_row.id,
      'uncertain',
      'companion_ack_timeout_no_retry',
      'system',
      null,
      checked_at
    );

    update public.marshy_control_runtime
    set
      last_operation_at = checked_at,
      last_error = 'A command acknowledgement timed out; it was not retried.',
      updated_at = checked_at
    where id = 'marshy';
  end loop;
end;
$function$;

revoke all on function public.cleanup_marshy_control_queue(timestamp with time zone)
from public, anon, authenticated;

create or replace function public.get_marshy_control_state(
  control_session_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  caller_id uuid := (select auth.uid());
  settings_row public.marshy_control_settings%rowtype;
  runtime_row public.marshy_control_runtime%rowtype;
  wallet_row public.marshy_control_wallets%rowtype;
  own_request public.marshy_control_requests%rowtype;
  companion_is_current boolean;
  accepting_requests boolean;
  device_state text;
  cooldown_remaining integer := 0;
  queue_size integer := 0;
  own_queue_position integer;
  public_heart_rate integer;
begin
  perform public.cleanup_marshy_control_queue(checked_at);

  select settings.*
  into settings_row
  from public.marshy_control_settings as settings
  where settings.id = 'marshy';

  select runtime.*
  into runtime_row
  from public.marshy_control_runtime as runtime
  where runtime.id = 'marshy';

  companion_is_current := runtime_row.companion_last_seen is not null
    and runtime_row.companion_last_seen >= checked_at - interval '20 seconds';

  accepting_requests :=
    settings_row.controls_enabled
    and not settings_row.emergency_stopped
    and companion_is_current
    and runtime_row.pishock_connected
    and not runtime_row.pishock_paused
    and runtime_row.locally_armed
    and runtime_row.local_cap_configured;

  device_state := case
    when settings_row.emergency_stopped then 'stopped'
    when not companion_is_current then 'offline'
    when not runtime_row.pishock_connected then 'pishock_disconnected'
    when runtime_row.pishock_paused then 'paused'
    when not runtime_row.local_cap_configured then 'local_cap_required'
    when not runtime_row.locally_armed then 'disarmed'
    when not settings_row.controls_enabled then 'disabled'
    when runtime_row.last_operation_at is not null
      and runtime_row.last_operation_at
        + pg_catalog.make_interval(secs => settings_row.cooldown_seconds)
        > checked_at
      then 'cooldown'
    else 'ready'
  end;

  if runtime_row.last_operation_at is not null then
    cooldown_remaining := greatest(
      0,
      pg_catalog.ceil(
        extract(
          epoch from (
            runtime_row.last_operation_at
            + pg_catalog.make_interval(secs => settings_row.cooldown_seconds)
            - checked_at
          )
        )
      )::integer
    );
  end if;

  select pg_catalog.count(*)::integer
  into queue_size
  from public.marshy_control_requests as request
  where request.status in ('queued', 'executing');

  if caller_id is not null then
    select wallet.*
    into wallet_row
    from public.marshy_control_wallets as wallet
    where wallet.user_id = caller_id;

    select request.*
    into own_request
    from public.marshy_control_requests as request
    where request.user_id = caller_id
      and request.status in ('queued', 'executing')
    order by request.requested_at, request.id
    limit 1;

    if own_request.id is not null then
      if own_request.status = 'executing' then
        own_queue_position := 0;
      else
        select 1 + pg_catalog.count(*)::integer
        into own_queue_position
        from public.marshy_control_requests as earlier
        where earlier.status in ('queued', 'executing')
          and (
            earlier.status = 'executing'
            or earlier.requested_at < own_request.requested_at
            or (
              earlier.requested_at = own_request.requested_at
              and earlier.id::text < own_request.id::text
            )
          );
      end if;
    end if;
  end if;

  if settings_row.share_heart_rate
    and runtime_row.pulsoid_connected
    and runtime_row.pulsoid_live
    and runtime_row.heart_rate_received_at >= checked_at - interval '30 seconds'
  then
    public_heart_rate := runtime_row.heart_rate;
  end if;

  return pg_catalog.jsonb_build_object(
    'server_time', checked_at,
    'authenticated', caller_id is not null,
    'device_state', device_state,
    'accepting_requests', accepting_requests,
    'controls_enabled', settings_row.controls_enabled,
    'emergency_stopped', settings_row.emergency_stopped,
    'companion_connected', companion_is_current,
    'pishock_connected', runtime_row.pishock_connected,
    'locally_armed', runtime_row.locally_armed,
    'cooldown_remaining', cooldown_remaining,
    'next_operation_at', case
      when runtime_row.last_operation_at is null then null
      else runtime_row.last_operation_at
        + pg_catalog.make_interval(secs => settings_row.cooldown_seconds)
    end,
    'queue_length', queue_size,
    'queue_limit', settings_row.queue_limit,
    'token_cap', 300,
    'token_rate_per_second', 1,
    'token_balance', coalesce(wallet_row.balance, 0),
    'earning_here',
      caller_id is not null
      and wallet_row.active_session_id = control_session_id
      and wallet_row.active_session_expires_at > checked_at,
    'active_session_elsewhere',
      caller_id is not null
      and wallet_row.active_session_id is not null
      and wallet_row.active_session_id is distinct from control_session_id
      and wallet_row.active_session_expires_at > checked_at,
    'request', case
      when own_request.id is null then null
      else pg_catalog.jsonb_build_object(
        'id', own_request.id,
        'requested_action', own_request.requested_action,
        'resolved_action', own_request.resolved_action,
        'converted', own_request.requested_action <> own_request.resolved_action,
        'token_cost', own_request.token_cost,
        'status', own_request.status,
        'queue_position', own_queue_position,
        'requested_at', own_request.requested_at,
        'expires_at', own_request.expires_at
      )
    end,
    'heart_rate', public_heart_rate,
    'heart_rate_status', case
      when not settings_row.share_heart_rate then 'hidden'
      when not runtime_row.pulsoid_connected then 'pulsoid_offline'
      when not runtime_row.pulsoid_live
        or runtime_row.heart_rate_received_at is null
        or runtime_row.heart_rate_received_at < checked_at - interval '30 seconds'
        then 'watch_offline'
      else 'live'
    end,
    'heart_rate_measured_at', case
      when public_heart_rate is null then null
      else runtime_row.heart_rate_measured_at
    end,
    'tiers', pg_catalog.jsonb_build_object(
      'vibrate', pg_catalog.jsonb_build_object(
        'cost', 0,
        'percent', settings_row.vibration_percent,
        'duration_ms', settings_row.vibration_duration_ms
      ),
      'low', pg_catalog.jsonb_build_object(
        'cost', settings_row.low_cost,
        'percent', settings_row.low_percent,
        'duration_ms', settings_row.low_duration_ms
      ),
      'high', pg_catalog.jsonb_build_object(
        'cost', settings_row.high_cost,
        'percent', settings_row.high_percent,
        'duration_ms', settings_row.high_duration_ms
      ),
      'extreme', pg_catalog.jsonb_build_object(
        'cost', settings_row.extreme_cost,
        'percent', settings_row.extreme_percent,
        'duration_ms', settings_row.extreme_duration_ms
      )
    )
  );
end;
$function$;

revoke all on function public.get_marshy_control_state(uuid)
from public, anon, authenticated;
grant execute on function public.get_marshy_control_state(uuid)
to anon, authenticated;

create or replace function public.heartbeat_marshy_control_session(
  control_session_id uuid,
  page_visible boolean
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
  wallet_row public.marshy_control_wallets%rowtype;
  credited_seconds integer := 0;
begin
  if control_session_id is null or page_visible is null then
    raise exception using errcode = '22023', message = 'invalid_control_session';
  end if;

  select settings.*
  into settings_row
  from public.marshy_control_settings as settings
  where settings.id = 'marshy';

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

  insert into public.marshy_control_wallets (user_id)
  values (caller_id)
  on conflict (user_id) do nothing;

  select wallet.*
  into wallet_row
  from public.marshy_control_wallets as wallet
  where wallet.user_id = caller_id
  for update;

  if page_visible then
    if wallet_row.active_session_id is distinct from control_session_id
      and wallet_row.active_session_expires_at > checked_at
    then
      raise exception using
        errcode = 'P0001',
        message = 'earning_session_active_elsewhere';
    end if;

    if wallet_row.active_session_id = control_session_id
      and wallet_row.last_accrual_at is not null
      and wallet_row.active_session_expires_at > wallet_row.last_accrual_at
    then
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
      active_session_id = control_session_id,
      active_session_expires_at = checked_at + interval '15 seconds',
      last_accrual_at = checked_at,
      updated_at = checked_at
    where user_id = caller_id;
  elsif wallet_row.active_session_id = control_session_id then
    update public.marshy_control_wallets
    set
      active_session_expires_at = checked_at,
      last_accrual_at = checked_at,
      updated_at = checked_at
    where user_id = caller_id;
  end if;

  return public.get_marshy_control_state(control_session_id);
end;
$function$;

revoke all on function public.heartbeat_marshy_control_session(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.heartbeat_marshy_control_session(uuid, boolean)
to authenticated;

create or replace function public.release_marshy_control_session(
  control_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
begin
  if caller_id is null or control_session_id is null then
    raise exception using errcode = '42501', message = 'discord_login_required';
  end if;

  update public.marshy_control_wallets
  set
    active_session_expires_at = checked_at,
    last_accrual_at = checked_at,
    updated_at = checked_at
  where user_id = caller_id
    and active_session_id = control_session_id;

  return public.get_marshy_control_state(control_session_id);
end;
$function$;

revoke all on function public.release_marshy_control_session(uuid)
from public, anon, authenticated;
grant execute on function public.release_marshy_control_session(uuid)
to authenticated;

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

create or replace function public.cancel_my_marshy_control_request(
  control_session_id uuid,
  target_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
  request_owner uuid;
  request_status text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'discord_login_required';
  end if;

  select request.user_id, request.status
  into request_owner, request_status
  from public.marshy_control_requests as request
  where request.id = target_request_id
  for update;

  if request_owner is distinct from caller_id then
    raise exception using errcode = '42501', message = 'request_not_owned';
  end if;

  if request_status <> 'queued' then
    raise exception using errcode = 'P0001', message = 'request_cannot_be_cancelled';
  end if;

  perform public.control_refund_request(
    target_request_id,
    'cancelled',
    'cancelled_by_visitor',
    'visitor',
    caller_id,
    pg_catalog.clock_timestamp()
  );

  return public.get_marshy_control_state(control_session_id);
end;
$function$;

revoke all on function public.cancel_my_marshy_control_request(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.cancel_my_marshy_control_request(uuid, uuid)
to authenticated;

create or replace function public.admin_get_marshy_control_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  settings_json jsonb;
  runtime_json jsonb;
  queue_json jsonb;
  blocks_json jsonb;
begin
  perform public.control_require_site_admin();
  perform public.cleanup_marshy_control_queue(checked_at);

  select pg_catalog.to_jsonb(settings)
  into settings_json
  from public.marshy_control_settings as settings
  where settings.id = 'marshy';

  select pg_catalog.to_jsonb(runtime)
  into runtime_json
  from public.marshy_control_runtime as runtime
  where runtime.id = 'marshy';

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', request.id,
        'user_id', request.user_id,
        'display_name', coalesce(
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'full_name'), ''),
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'name'), ''),
          'Discord user'
        ),
        'requested_action', request.requested_action,
        'resolved_action', request.resolved_action,
        'token_cost', request.token_cost,
        'status', request.status,
        'requested_at', request.requested_at,
        'expires_at', request.expires_at
      )
      order by request.requested_at, request.id
    ),
    '[]'::jsonb
  )
  into queue_json
  from public.marshy_control_requests as request
  left join auth.users as account on account.id = request.user_id
  where request.status in ('queued', 'executing');

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'user_id', blocked.user_id,
        'display_name', coalesce(
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'full_name'), ''),
          nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'name'), ''),
          'Discord user'
        ),
        'reason', blocked.reason,
        'blocked_at', blocked.blocked_at
      )
      order by blocked.blocked_at desc
    ),
    '[]'::jsonb
  )
  into blocks_json
  from public.marshy_control_blocks as blocked
  left join auth.users as account on account.id = blocked.user_id;

  return pg_catalog.jsonb_build_object(
    'server_time', checked_at,
    'settings', settings_json,
    'runtime', runtime_json,
    'queue', queue_json,
    'blocked_users', blocks_json
  );
end;
$function$;

revoke all on function public.admin_get_marshy_control_state()
from public, anon, authenticated;
grant execute on function public.admin_get_marshy_control_state()
to authenticated;

create or replace function public.admin_get_marshy_control_audit(
  requested_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  safe_limit integer := least(250, greatest(1, requested_limit));
  result jsonb;
begin
  perform public.control_require_site_admin();

  select coalesce(
    pg_catalog.jsonb_agg(entry.payload order by entry.created_at desc, entry.id desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      audit.id,
      audit.created_at,
      pg_catalog.jsonb_build_object(
        'id', audit.id,
        'event_type', audit.event_type,
        'actor_kind', audit.actor_kind,
        'actor_user_id', audit.actor_user_id,
        'request_id', audit.request_id,
        'details', audit.details,
        'created_at', audit.created_at
      ) as payload
    from public.marshy_control_audit_log as audit
    order by audit.created_at desc, audit.id desc
    limit safe_limit
  ) as entry;

  return result;
end;
$function$;

revoke all on function public.admin_get_marshy_control_audit(integer)
from public, anon, authenticated;
grant execute on function public.admin_get_marshy_control_audit(integer)
to authenticated;

create or replace function public.admin_update_marshy_control_settings(
  new_settings jsonb
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
  unknown_key text;
  updated_settings public.marshy_control_settings%rowtype;
  request_row record;
begin
  if new_settings is null or pg_catalog.jsonb_typeof(new_settings) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_control_settings';
  end if;

  select key
  into unknown_key
  from pg_catalog.jsonb_object_keys(new_settings) as supplied(key)
  where key not in (
    'controls_enabled',
    'share_heart_rate',
    'low_percent',
    'high_percent',
    'extreme_percent',
    'low_cost',
    'high_cost',
    'extreme_cost',
    'low_duration_ms',
    'high_duration_ms',
    'extreme_duration_ms',
    'vibration_percent',
    'vibration_duration_ms',
    'cooldown_seconds',
    'queue_limit',
    'request_ttl_seconds',
    'minimum_discord_account_age_days'
  )
  limit 1;

  if unknown_key is not null then
    raise exception using errcode = '22023', message = 'unknown_control_setting';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );

  update public.marshy_control_settings as settings
  set
    controls_enabled = case
      when settings.emergency_stopped then false
      else coalesce(
        (new_settings ->> 'controls_enabled')::boolean,
        settings.controls_enabled
      )
    end,
    share_heart_rate = coalesce(
      (new_settings ->> 'share_heart_rate')::boolean,
      settings.share_heart_rate
    ),
    low_percent = coalesce((new_settings ->> 'low_percent')::smallint, settings.low_percent),
    high_percent = coalesce((new_settings ->> 'high_percent')::smallint, settings.high_percent),
    extreme_percent = coalesce((new_settings ->> 'extreme_percent')::smallint, settings.extreme_percent),
    low_cost = coalesce((new_settings ->> 'low_cost')::smallint, settings.low_cost),
    high_cost = coalesce((new_settings ->> 'high_cost')::smallint, settings.high_cost),
    extreme_cost = coalesce((new_settings ->> 'extreme_cost')::smallint, settings.extreme_cost),
    low_duration_ms = coalesce(
      (new_settings ->> 'low_duration_ms')::smallint,
      settings.low_duration_ms
    ),
    high_duration_ms = coalesce(
      (new_settings ->> 'high_duration_ms')::smallint,
      settings.high_duration_ms
    ),
    extreme_duration_ms = coalesce(
      (new_settings ->> 'extreme_duration_ms')::smallint,
      settings.extreme_duration_ms
    ),
    vibration_percent = coalesce(
      (new_settings ->> 'vibration_percent')::smallint,
      settings.vibration_percent
    ),
    vibration_duration_ms = coalesce(
      (new_settings ->> 'vibration_duration_ms')::smallint,
      settings.vibration_duration_ms
    ),
    cooldown_seconds = coalesce(
      (new_settings ->> 'cooldown_seconds')::smallint,
      settings.cooldown_seconds
    ),
    queue_limit = coalesce(
      (new_settings ->> 'queue_limit')::smallint,
      settings.queue_limit
    ),
    request_ttl_seconds = coalesce(
      (new_settings ->> 'request_ttl_seconds')::smallint,
      settings.request_ttl_seconds
    ),
    minimum_discord_account_age_days = coalesce(
      (new_settings ->> 'minimum_discord_account_age_days')::smallint,
      settings.minimum_discord_account_age_days
    ),
    settings_version = settings.settings_version + 1,
    updated_at = checked_at,
    updated_by = caller_id
  where settings.id = 'marshy'
  returning * into updated_settings;

  if not updated_settings.controls_enabled then
    for request_row in
      select request.id
      from public.marshy_control_requests as request
      where request.status = 'queued'
      order by request.requested_at, request.id
      for update
    loop
      perform public.control_refund_request(
        request_row.id,
        'cancelled',
        'controls_disabled_by_admin',
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
    'settings_updated',
    'admin',
    caller_id,
    pg_catalog.to_jsonb(updated_settings)
      - 'updated_by'
      - 'updated_at'
      - 'id',
    checked_at
  );

  return pg_catalog.to_jsonb(updated_settings);
end;
$function$;

revoke all on function public.admin_update_marshy_control_settings(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_update_marshy_control_settings(jsonb)
to authenticated;

create or replace function public.admin_emergency_stop_marshy_control()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := public.control_require_site_admin();
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  request_row record;
  new_stop_generation bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );

  update public.marshy_control_settings
  set
    controls_enabled = false,
    emergency_stopped = true,
    settings_version = settings_version + 1,
    updated_at = checked_at,
    updated_by = caller_id
  where id = 'marshy';

  update public.marshy_control_runtime
  set
    stop_generation = stop_generation + 1,
    locally_armed = false,
    updated_at = checked_at
  where id = 'marshy'
  returning stop_generation into new_stop_generation;

  for request_row in
    select request.id
    from public.marshy_control_requests as request
    where request.status in ('queued', 'executing')
    order by request.requested_at, request.id
    for update
  loop
    perform public.control_refund_request(
      request_row.id,
      'cancelled',
      'admin_emergency_stop',
      'admin',
      caller_id,
      checked_at
    );
  end loop;

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    details,
    created_at
  )
  values (
    'emergency_stop',
    'admin',
    caller_id,
    pg_catalog.jsonb_build_object('stop_generation', new_stop_generation),
    checked_at
  );

  return pg_catalog.jsonb_build_object(
    'stopped', true,
    'stop_generation', new_stop_generation
  );
end;
$function$;

revoke all on function public.admin_emergency_stop_marshy_control()
from public, anon, authenticated;
grant execute on function public.admin_emergency_stop_marshy_control()
to authenticated;

create or replace function public.admin_reset_marshy_control_stop()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := public.control_require_site_admin();
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
begin
  update public.marshy_control_settings
  set
    emergency_stopped = false,
    controls_enabled = false,
    settings_version = settings_version + 1,
    updated_at = checked_at,
    updated_by = caller_id
  where id = 'marshy';

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    details,
    created_at
  )
  values (
    'emergency_stop_reset',
    'admin',
    caller_id,
    pg_catalog.jsonb_build_object(
      'controls_enabled', false,
      'local_rearm_required', true
    ),
    checked_at
  );

  return pg_catalog.jsonb_build_object(
    'stopped', false,
    'controls_enabled', false,
    'local_rearm_required', true
  );
end;
$function$;

revoke all on function public.admin_reset_marshy_control_stop()
from public, anon, authenticated;
grant execute on function public.admin_reset_marshy_control_stop()
to authenticated;

create or replace function public.admin_cancel_marshy_control_request(
  target_request_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := public.control_require_site_admin();
  current_status text;
begin
  select request.status
  into current_status
  from public.marshy_control_requests as request
  where request.id = target_request_id
  for update;

  if current_status is distinct from 'queued' then
    raise exception using
      errcode = 'P0001',
      message = 'only_queued_requests_can_be_cancelled';
  end if;

  return public.control_refund_request(
    target_request_id,
    'cancelled',
    'cancelled_by_admin',
    'admin',
    caller_id,
    pg_catalog.clock_timestamp()
  );
end;
$function$;
revoke all on function public.admin_cancel_marshy_control_request(uuid)
from public, anon, authenticated;
grant execute on function public.admin_cancel_marshy_control_request(uuid)
to authenticated;

create or replace function public.admin_set_marshy_control_block(
  target_user_id uuid,
  should_block boolean,
  block_reason text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := public.control_require_site_admin();
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  clean_reason text := nullif(
    pg_catalog.left(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(coalesce(block_reason, '')),
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
  if target_user_id is null or should_block is null then
    raise exception using errcode = '22023', message = 'invalid_block_request';
  end if;

  if should_block then
    insert into public.marshy_control_blocks (
      user_id,
      reason,
      blocked_at,
      blocked_by
    )
    values (
      target_user_id,
      clean_reason,
      checked_at,
      caller_id
    )
    on conflict (user_id) do update
    set
      reason = excluded.reason,
      blocked_at = excluded.blocked_at,
      blocked_by = excluded.blocked_by;

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
        'user_blocked_by_admin',
        'admin',
        caller_id,
        checked_at
      );
    end loop;
  else
    delete from public.marshy_control_blocks
    where user_id = target_user_id;
  end if;

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    details,
    created_at
  )
  values (
    case when should_block then 'user_blocked' else 'user_unblocked' end,
    'admin',
    caller_id,
    pg_catalog.jsonb_build_object(
      'target_user_id', target_user_id,
      'reason', clean_reason
    ),
    checked_at
  );

  return true;
end;
$function$;

revoke all on function public.admin_set_marshy_control_block(uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.admin_set_marshy_control_block(uuid, boolean, text)
to authenticated;

create or replace function public.companion_marshy_control_heartbeat(
  reported_session_id text,
  reported_pishock_connected boolean,
  reported_pishock_paused boolean,
  reported_locally_armed boolean,
  reported_local_cap_configured boolean,
  reported_pulsoid_connected boolean,
  reported_pulsoid_live boolean,
  reported_heart_rate integer default null,
  reported_heart_rate_measured_at timestamp with time zone default null,
  reported_stop_ack_generation bigint default null,
  reported_error text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  clean_session_id text := pg_catalog.btrim(coalesce(reported_session_id, ''));
  clean_error text := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(reported_error, '')), 200), '');
  safe_heart_rate smallint;
  safe_heart_rate_measured_at timestamp with time zone;
  settings_row public.marshy_control_settings%rowtype;
  runtime_row public.marshy_control_runtime%rowtype;
  next_request public.marshy_control_requests%rowtype;
  stop_required boolean;
begin
  if pg_catalog.char_length(clean_session_id) not between 8 and 128
    or clean_session_id !~ '^[[:alnum:].:_-]+$'
  then
    raise exception using errcode = '22023', message = 'invalid_companion_session';
  end if;

  if reported_heart_rate between 20 and 260
    and reported_heart_rate_measured_at between checked_at - interval '5 minutes'
      and checked_at + interval '1 minute'
  then
    safe_heart_rate := reported_heart_rate::smallint;
    safe_heart_rate_measured_at := reported_heart_rate_measured_at;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );

  update public.marshy_control_runtime as runtime
  set
    companion_session_id = clean_session_id,
    companion_last_seen = checked_at,
    pishock_connected = coalesce(reported_pishock_connected, false),
    pishock_paused = coalesce(reported_pishock_paused, true),
    locally_armed = coalesce(reported_locally_armed, false),
    local_cap_configured = coalesce(reported_local_cap_configured, false),
    pulsoid_connected = coalesce(reported_pulsoid_connected, false),
    pulsoid_live = coalesce(reported_pulsoid_live, false) and safe_heart_rate is not null,
    heart_rate = case
      when coalesce(reported_pulsoid_live, false) then safe_heart_rate
      else null
    end,
    heart_rate_measured_at = case
      when coalesce(reported_pulsoid_live, false) then safe_heart_rate_measured_at
      else null
    end,
    heart_rate_received_at = case
      when coalesce(reported_pulsoid_live, false) and safe_heart_rate is not null then checked_at
      else null
    end,
    stop_ack_generation = case
      when reported_stop_ack_generation is null then runtime.stop_ack_generation
      else least(
        runtime.stop_generation,
        greatest(runtime.stop_ack_generation, reported_stop_ack_generation)
      )
    end,
    last_error = clean_error,
    updated_at = checked_at
  where runtime.id = 'marshy';

  perform public.cleanup_marshy_control_queue(checked_at);

  select settings.*
  into settings_row
  from public.marshy_control_settings as settings
  where settings.id = 'marshy';

  select runtime.*
  into runtime_row
  from public.marshy_control_runtime as runtime
  where runtime.id = 'marshy'
  for update;

  stop_required := settings_row.emergency_stopped
    or runtime_row.stop_ack_generation < runtime_row.stop_generation;

  if not stop_required
    and settings_row.controls_enabled
    and runtime_row.pishock_connected
    and not runtime_row.pishock_paused
    and runtime_row.locally_armed
    and runtime_row.local_cap_configured
    and runtime_row.executing_request_id is null
    and (
      runtime_row.last_operation_at is null
      or runtime_row.last_operation_at
        + pg_catalog.make_interval(secs => settings_row.cooldown_seconds)
        <= checked_at
    )
  then
    select request.*
    into next_request
    from public.marshy_control_requests as request
    where request.status = 'queued'
    order by request.requested_at, request.id
    limit 1
    for update skip locked;

    if next_request.id is not null then
      update public.marshy_control_requests
      set
        status = 'executing',
        started_at = checked_at
      where id = next_request.id;

      update public.marshy_control_runtime
      set
        executing_request_id = next_request.id,
        updated_at = checked_at
      where id = 'marshy';

      insert into public.marshy_control_audit_log (
        event_type,
        actor_kind,
        request_id,
        details,
        created_at
      )
      values (
        'request_claimed',
        'companion',
        next_request.id,
        pg_catalog.jsonb_build_object(
          'resolved_action', next_request.resolved_action,
          'tier_percent_of_local_cap', next_request.tier_percent,
          'duration_ms', next_request.duration_ms
        ),
        checked_at
      );
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'server_time', checked_at,
    'stop_required', stop_required,
    'stop_generation', runtime_row.stop_generation,
    'command', case
      when next_request.id is null then null
      else pg_catalog.jsonb_build_object(
        'request_id', next_request.id,
        'action', next_request.resolved_action,
        'tier_percent_of_local_cap', next_request.tier_percent,
        'duration_ms', next_request.duration_ms
      )
    end
  );
end;
$function$;

revoke all on function public.companion_marshy_control_heartbeat(
  text,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  integer,
  timestamp with time zone,
  bigint,
  text
)
from public, anon, authenticated;
grant execute on function public.companion_marshy_control_heartbeat(
  text,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  integer,
  timestamp with time zone,
  bigint,
  text
)
to service_role;

create or replace function public.companion_complete_marshy_control_request(
  target_request_id uuid,
  completion_result text,
  completion_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  request_row public.marshy_control_requests%rowtype;
  clean_result text := pg_catalog.lower(pg_catalog.btrim(coalesce(completion_result, '')));
  clean_reason text := nullif(
    pg_catalog.left(pg_catalog.btrim(coalesce(completion_reason, '')), 200),
    ''
  );
begin
  if clean_result not in ('executed', 'failed', 'uncertain', 'stopped') then
    raise exception using errcode = '22023', message = 'invalid_completion_result';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );

  select request.*
  into request_row
  from public.marshy_control_requests as request
  where request.id = target_request_id
  for update;

  if request_row.id is null then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'request_not_found');
  end if;

  if request_row.status <> 'executing' then
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reason', 'request_no_longer_executing',
      'status', request_row.status
    );
  end if;

  if clean_result = 'executed' then
    update public.marshy_control_requests
    set
      status = 'executed',
      completed_at = checked_at,
      failure_reason = null
    where id = request_row.id;

    update public.marshy_control_runtime
    set
      executing_request_id = null,
      last_operation_at = checked_at,
      last_error = null,
      updated_at = checked_at
    where id = 'marshy';

    insert into public.marshy_control_audit_log (
      event_type,
      actor_kind,
      request_id,
      details,
      created_at
    )
    values (
      'request_executed',
      'companion',
      request_row.id,
      pg_catalog.jsonb_build_object(
        'resolved_action', request_row.resolved_action,
        'tier_percent_of_local_cap', request_row.tier_percent,
        'duration_ms', request_row.duration_ms
      ),
      checked_at
    );
  else
    perform public.control_refund_request(
      request_row.id,
      case clean_result
        when 'failed' then 'failed'
        when 'uncertain' then 'uncertain'
        else 'cancelled'
      end,
      coalesce(clean_reason, 'companion_' || clean_result),
      'companion',
      null,
      checked_at
    );

    update public.marshy_control_runtime
    set
      last_operation_at = checked_at,
      last_error = coalesce(clean_reason, 'Command ' || clean_result),
      updated_at = checked_at
    where id = 'marshy';
  end if;

  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'request_id', request_row.id,
    'result', clean_result,
    'completed_at', checked_at
  );
end;
$function$;

revoke all on function public.companion_complete_marshy_control_request(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.companion_complete_marshy_control_request(uuid, text, text)
to service_role;

comment on table public.marshy_control_wallets is
'Server-authoritative Marshy Token wallets. Balance is permanently capped at 300.';
comment on column public.marshy_control_requests.tier_percent is
'Percentage of the separate owner-set local companion maximum, never raw PiShock output.';
comment on table public.marshy_control_audit_log is
'Append-only audit trail. Device credentials, OAuth tokens, IP addresses, and Pulsoid history are never stored here.';

reset search_path;
