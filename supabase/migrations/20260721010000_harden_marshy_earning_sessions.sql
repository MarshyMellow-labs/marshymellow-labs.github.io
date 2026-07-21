-- Harden token earning against expired-lease backfill. Browser visibility is
-- advisory because authenticated callers control browser requests; the server
-- therefore enforces identity, one live lease, server time, per-call cadence,
-- and the 300-token cap. The official client releases this lease when hidden.

drop function if exists public.heartbeat_marshy_control_session(uuid, boolean);

create or replace function public.heartbeat_marshy_control_session(
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
  wallet_row public.marshy_control_wallets%rowtype;
  credited_seconds integer := 0;
begin
  if control_session_id is null then
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

  if wallet_row.active_session_id is distinct from control_session_id
    and wallet_row.active_session_expires_at > checked_at
  then
    raise exception using
      errcode = 'P0001',
      message = 'earning_session_active_elsewhere';
  end if;

  -- Credit only a lease that was still live when this request reached the
  -- database. Reusing the same UUID after expiry starts a new lease at zero.
  if wallet_row.active_session_id = control_session_id
    and wallet_row.last_accrual_at is not null
    and wallet_row.last_accrual_at <= checked_at
    and wallet_row.active_session_expires_at > checked_at
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

  return public.get_marshy_control_state(control_session_id);
end;
$function$;

revoke all on function public.heartbeat_marshy_control_session(uuid)
from public, anon, authenticated;
grant execute on function public.heartbeat_marshy_control_session(uuid)
to authenticated;

comment on function public.heartbeat_marshy_control_session(uuid) is
  'Renews one Discord-bound earning lease. Credits only elapsed server time from a lease that is unexpired when the heartbeat arrives.';
