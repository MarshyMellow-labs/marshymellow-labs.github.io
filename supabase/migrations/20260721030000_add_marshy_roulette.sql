-- Add a two-stage, server-resolved 22-slot roulette. Spinning spends 100 tokens
-- and stores exactly one prize for the Discord account. A separate redemption
-- queues the stored result, so no physical command runs until the visitor clicks
-- Use result after the wheel has landed.

alter table public.marshy_control_requests
  drop constraint if exists marshy_control_requested_action;

alter table public.marshy_control_requests
  add constraint marshy_control_requested_action check (
    requested_action in ('vibrate', 'low', 'high', 'extreme', 'roulette')
  );

alter table public.marshy_control_requests
  drop constraint if exists marshy_control_request_tier;

alter table public.marshy_control_requests
  add constraint marshy_control_request_tier check (
    tier_percent between 1 and 200
  );

create table if not exists public.marshy_control_roulette_prizes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  slot smallint not null,
  resolved_action text not null,
  tier_percent smallint not null,
  duration_ms smallint not null,
  created_at timestamp with time zone not null default pg_catalog.now(),
  constraint marshy_control_roulette_slot check (slot between 1 and 22),
  constraint marshy_control_roulette_action check (
    resolved_action in ('vibrate', 'low', 'high', 'extreme')
  ),
  constraint marshy_control_roulette_tier check (tier_percent between 1 and 200),
  constraint marshy_control_roulette_duration check (duration_ms between 100 and 1000)
);

alter table public.marshy_control_roulette_prizes enable row level security;
revoke all privileges on table public.marshy_control_roulette_prizes
from public, anon, authenticated;

create or replace function public.get_my_marshy_roulette_prize()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid;
  prize_row public.marshy_control_roulette_prizes%rowtype;
begin
  caller_id := public.control_require_discord_user(0);

  select prize.*
  into prize_row
  from public.marshy_control_roulette_prizes as prize
  where prize.user_id = caller_id;

  if prize_row.id is null then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', prize_row.id,
    'slot', prize_row.slot,
    'resolved_action', prize_row.resolved_action,
    'roulette_percent', case
      when prize_row.resolved_action = 'vibrate' then null
      else prize_row.tier_percent
    end,
    'created_at', prize_row.created_at
  );
end;
$function$;

revoke all on function public.get_my_marshy_roulette_prize()
from public, anon, authenticated;
grant execute on function public.get_my_marshy_roulette_prize()
to authenticated;

create or replace function public.spin_marshy_roulette(
  control_session_id uuid
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
  prize_id uuid;
  roulette_slot integer;
  resolved_control text;
  resolved_percent integer;
  resolved_duration integer;
  credited_seconds integer := 0;
  active_request_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );
  perform public.cleanup_marshy_control_queue(checked_at);

  if control_session_id is null then
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
    select 1 from public.marshy_control_blocks as blocked
    where blocked.user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'control_access_blocked';
  end if;

  if exists (
    select 1 from public.marshy_control_timeouts as timeout
    where timeout.user_id = caller_id
      and timeout.timed_out_until > checked_at
  ) then
    raise exception using errcode = '42501', message = 'control_access_timed_out';
  end if;

  if exists (
    select 1 from public.marshy_control_roulette_prizes as prize
    where prize.user_id = caller_id
  ) then
    raise exception using errcode = 'P0001', message = 'roulette_prize_already_waiting';
  end if;

  if exists (
    select 1 from public.marshy_control_requests as pending
    where pending.user_id = caller_id
      and pending.status in ('queued', 'executing')
  ) then
    raise exception using errcode = 'P0001', message = 'request_already_pending';
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

  select pg_catalog.count(*)::integer
  into active_request_count
  from public.marshy_control_requests as pending
  where pending.status in ('queued', 'executing');

  if active_request_count >= settings_row.queue_limit then
    raise exception using errcode = 'P0001', message = 'control_queue_full';
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

  if wallet_row.balance < 100 then
    raise exception using errcode = 'P0001', message = 'not_enough_marshy_tokens';
  end if;

  -- The browser supplies no random input. All 22 equally sized slots are
  -- selected here on the trusted database server.
  roulette_slot := 1 + pg_catalog.floor(pg_catalog.random() * 22)::integer;

  if roulette_slot in (1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21) then
    resolved_control := 'vibrate';
    resolved_percent := settings_row.vibration_percent;
    resolved_duration := settings_row.vibration_duration_ms;
  elsif roulette_slot in (2, 6, 10, 14, 20) then
    resolved_control := 'low';
    resolved_percent := 50;
    resolved_duration := settings_row.low_duration_ms;
  elsif roulette_slot in (4, 12, 18) then
    resolved_control := 'high';
    resolved_percent := 75;
    resolved_duration := settings_row.high_duration_ms;
  elsif roulette_slot in (8, 22) then
    resolved_control := 'extreme';
    resolved_percent := 100;
    resolved_duration := settings_row.extreme_duration_ms;
  else
    resolved_control := 'extreme';
    resolved_percent := 200;
    resolved_duration := settings_row.extreme_duration_ms;
  end if;

  insert into public.marshy_control_roulette_prizes (
    user_id,
    slot,
    resolved_action,
    tier_percent,
    duration_ms,
    created_at
  ) values (
    caller_id,
    roulette_slot,
    resolved_control,
    resolved_percent,
    resolved_duration,
    checked_at
  )
  returning id into prize_id;

  update public.marshy_control_wallets
  set
    balance = balance - 100,
    updated_at = checked_at
  where user_id = caller_id;

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    details,
    created_at
  ) values (
    'roulette_spun',
    'visitor',
    caller_id,
    pg_catalog.jsonb_build_object(
      'prize_id', prize_id,
      'roulette_slot', roulette_slot,
      'resolved_action', resolved_control,
      'tier_percent_of_local_cap', resolved_percent,
      'token_cost', 100
    ),
    checked_at
  );

  return pg_catalog.jsonb_build_object(
    'id', prize_id,
    'slot', roulette_slot,
    'resolved_action', resolved_control,
    'roulette_percent', case
      when resolved_control = 'vibrate' then null
      else resolved_percent
    end,
    'token_cost', 100,
    'state', public.get_marshy_control_state(control_session_id)
  );
end;
$function$;

revoke all on function public.spin_marshy_roulette(uuid)
from public, anon, authenticated;
grant execute on function public.spin_marshy_roulette(uuid)
to authenticated;

create or replace function public.redeem_marshy_roulette_prize(
  control_session_id uuid,
  target_prize_id uuid
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
  prize_row public.marshy_control_roulette_prizes%rowtype;
  request_id uuid;
  active_request_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marshy-control-queue', 0)
  );
  perform public.cleanup_marshy_control_queue(checked_at);

  if control_session_id is null or target_prize_id is null then
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
    select 1 from public.marshy_control_blocks as blocked
    where blocked.user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'control_access_blocked';
  end if;

  select prize.*
  into prize_row
  from public.marshy_control_roulette_prizes as prize
  where prize.id = target_prize_id
    and prize.user_id = caller_id
  for update;

  if prize_row.id is null then
    raise exception using errcode = 'P0001', message = 'roulette_prize_not_found';
  end if;

  if prize_row.created_at + interval '3.6 seconds' > checked_at then
    raise exception using errcode = 'P0001', message = 'roulette_still_spinning';
  end if;

  if exists (
    select 1 from public.marshy_control_requests as pending
    where pending.user_id = caller_id
      and pending.status in ('queued', 'executing')
  ) then
    raise exception using errcode = 'P0001', message = 'request_already_pending';
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

  select pg_catalog.count(*)::integer
  into active_request_count
  from public.marshy_control_requests as pending
  where pending.status in ('queued', 'executing');

  if active_request_count >= settings_row.queue_limit then
    raise exception using errcode = 'P0001', message = 'control_queue_full';
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
  ) values (
    caller_id,
    'roulette',
    prize_row.resolved_action,
    0,
    prize_row.tier_percent,
    prize_row.duration_ms,
    'queued',
    settings_row.settings_version,
    checked_at,
    checked_at + pg_catalog.make_interval(secs => settings_row.request_ttl_seconds)
  )
  returning id into request_id;

  delete from public.marshy_control_roulette_prizes
  where id = prize_row.id;

  insert into public.marshy_control_audit_log (
    event_type,
    actor_kind,
    actor_user_id,
    request_id,
    details,
    created_at
  ) values (
    'roulette_redeemed',
    'visitor',
    caller_id,
    request_id,
    pg_catalog.jsonb_build_object(
      'prize_id', prize_row.id,
      'roulette_slot', prize_row.slot,
      'resolved_action', prize_row.resolved_action,
      'tier_percent_of_local_cap', prize_row.tier_percent,
      'spin_token_cost', 100
    ),
    checked_at
  );

  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'request_id', request_id,
    'requested_action', 'roulette',
    'resolved_action', prize_row.resolved_action,
    'token_cost', 0,
    'state', public.get_marshy_control_state(control_session_id)
  );
end;
$function$;

revoke all on function public.redeem_marshy_roulette_prize(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.redeem_marshy_roulette_prize(uuid, uuid)
to authenticated;

comment on table public.marshy_control_roulette_prizes is
  'One server-selected, unredeemed roulette prize per Discord account.';
