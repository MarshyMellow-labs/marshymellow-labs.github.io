-- Harden the public site without changing its anonymous read paths or admin UI.
-- All public submissions go through validated, rate-limited SECURITY DEFINER RPCs.

set search_path = '';

-- Keep the migration usable against the existing hosted project while documenting
-- the minimum schema expected by the static site.
create table if not exists public.site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamp with time zone not null default pg_catalog.now()
);

create table if not exists public.gallery_images (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  title text not null,
  image_path text not null unique,
  thumbnail_path text,
  vrchat_metadata jsonb,
  created_at timestamp with time zone not null default pg_catalog.now()
);

alter table public.gallery_images
  add column if not exists thumbnail_path text,
  add column if not exists vrchat_metadata jsonb;

create table if not exists public.approvals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null unique,
  approved_at timestamp with time zone not null default pg_catalog.now()
);

create table if not exists public.snake_scores (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  score integer not null,
  created_at timestamp with time zone not null default pg_catalog.now()
);

create table if not exists public.dungeon_scores (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  score integer not null,
  floor_reached integer not null default 1,
  created_at timestamp with time zone not null default pg_catalog.now()
);

-- Only display names, world names, and capture times are public. Strip stable
-- VRChat identifiers and private instance identifiers from both known metadata
-- shapes while leaving the fields used by the current gallery intact.
create or replace function public.sanitize_vrchat_metadata(metadata jsonb)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $function$
  with base as (
    select case
      when pg_catalog.jsonb_typeof(metadata) = 'object' then
        metadata
          - 'authorId'
          - 'author_id'
          - 'worldId'
          - 'world_id'
          - 'instanceId'
          - 'instance_id'
          - 'userId'
          - 'user_id'
          - 'userIds'
          - 'user_ids'
          - 'playerIds'
          - 'player_ids'
      else null
    end as value
  ),
  author_cleaned as (
    select case
      when pg_catalog.jsonb_typeof(base.value -> 'author') = 'object' then
        pg_catalog.jsonb_set(
          base.value,
          '{author}'::pg_catalog.text[],
          (base.value -> 'author') - 'id' - 'userId' - 'user_id' - 'authorId' - 'author_id',
          false
        )
      else base.value
    end as value
    from base
  ),
  world_cleaned as (
    select case
      when pg_catalog.jsonb_typeof(author_cleaned.value -> 'world') = 'object' then
        pg_catalog.jsonb_set(
          author_cleaned.value,
          '{world}'::pg_catalog.text[],
          (author_cleaned.value -> 'world')
            - 'id'
            - 'worldId'
            - 'world_id'
            - 'instanceId'
            - 'instance_id',
          false
        )
      else author_cleaned.value
    end as value
    from author_cleaned
  ),
  users_cleaned as (
    select case
      when pg_catalog.jsonb_typeof(world_cleaned.value -> 'users') = 'array' then
        pg_catalog.jsonb_set(
          world_cleaned.value,
          '{users}'::pg_catalog.text[],
          coalesce(
            (
              select pg_catalog.jsonb_agg(
                case
                  when pg_catalog.jsonb_typeof(user_entry.value) = 'object' then
                    user_entry.value - 'id' - 'userId' - 'user_id'
                  else user_entry.value
                end
                order by user_entry.ordinality
              )
              from pg_catalog.jsonb_array_elements(world_cleaned.value -> 'users')
                with ordinality as user_entry(value, ordinality)
            ),
            '[]'::jsonb
          ),
          false
        )
      else world_cleaned.value
    end as value
    from world_cleaned
  ),
  players_cleaned as (
    select case
      when pg_catalog.jsonb_typeof(users_cleaned.value -> 'players') = 'array' then
        pg_catalog.jsonb_set(
          users_cleaned.value,
          '{players}'::pg_catalog.text[],
          coalesce(
            (
              select pg_catalog.jsonb_agg(
                case
                  when pg_catalog.jsonb_typeof(player_entry.value) = 'object' then
                    player_entry.value - 'id' - 'userId' - 'user_id'
                  else player_entry.value
                end
                order by player_entry.ordinality
              )
              from pg_catalog.jsonb_array_elements(users_cleaned.value -> 'players')
                with ordinality as player_entry(value, ordinality)
            ),
            '[]'::jsonb
          ),
          false
        )
      else users_cleaned.value
    end as value
    from users_cleaned
  )
  select case
    when pg_catalog.jsonb_typeof(players_cleaned.value) is distinct from 'object'
      then null
    else pg_catalog.jsonb_build_object(
      'capturedAt',
      case
        when pg_catalog.jsonb_typeof(players_cleaned.value -> 'capturedAt') = 'string' then
          nullif(
            pg_catalog.left(
              pg_catalog.btrim(players_cleaned.value ->> 'capturedAt'),
              64
            ),
            ''
          )
        else null
      end,
      'author',
      pg_catalog.jsonb_build_object(
        'displayName',
        case
          when pg_catalog.jsonb_typeof(players_cleaned.value #> '{author,displayName}') = 'string' then
            nullif(
              pg_catalog.left(
                pg_catalog.regexp_replace(
                  pg_catalog.btrim(players_cleaned.value #>> '{author,displayName}'),
                  '[[:space:]]+',
                  ' ',
                  'g'
                ),
                80
              ),
              ''
            )
          else null
        end
      ),
      'world',
      pg_catalog.jsonb_build_object(
        'name',
        case
          when pg_catalog.jsonb_typeof(players_cleaned.value #> '{world,name}') = 'string' then
            nullif(
              pg_catalog.left(
                pg_catalog.regexp_replace(
                  pg_catalog.btrim(players_cleaned.value #>> '{world,name}'),
                  '[[:space:]]+',
                  ' ',
                  'g'
                ),
                160
              ),
              ''
            )
          else null
        end
      ),
      'users',
      coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object('displayName', cleaned_user.display_name)
            order by cleaned_user.ordinality
          )
          from (
            select
              listed_user.ordinality,
              nullif(
                pg_catalog.left(
                  pg_catalog.regexp_replace(
                    pg_catalog.btrim(listed_user.value ->> 'displayName'),
                    '[[:space:]]+',
                    ' ',
                    'g'
                  ),
                  80
                ),
                ''
              ) as display_name
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(players_cleaned.value -> 'users') = 'array' then
                  players_cleaned.value -> 'users'
                when pg_catalog.jsonb_typeof(players_cleaned.value -> 'players') = 'array' then
                  players_cleaned.value -> 'players'
                else '[]'::jsonb
              end
            ) with ordinality as listed_user(value, ordinality)
            where pg_catalog.jsonb_typeof(listed_user.value) = 'object'
              and pg_catalog.jsonb_typeof(listed_user.value -> 'displayName') = 'string'
            order by listed_user.ordinality
            limit 200
          ) as cleaned_user
          where cleaned_user.display_name is not null
        ),
        '[]'::jsonb
      )
    )
  end
  from players_cleaned;
$function$;

revoke all on function public.sanitize_vrchat_metadata(jsonb)
from public, anon, authenticated;

create or replace function public.sanitize_gallery_vrchat_metadata_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.vrchat_metadata := public.sanitize_vrchat_metadata(new.vrchat_metadata);
  return new;
end;
$function$;

revoke all on function public.sanitize_gallery_vrchat_metadata_row()
from public, anon, authenticated;

drop trigger if exists sanitize_gallery_vrchat_metadata_before_write
on public.gallery_images;

create trigger sanitize_gallery_vrchat_metadata_before_write
before insert or update of vrchat_metadata on public.gallery_images
for each row
execute function public.sanitize_gallery_vrchat_metadata_row();

update public.gallery_images as gallery
set vrchat_metadata = sanitized.vrchat_metadata
from (
  select
    source.id,
    public.sanitize_vrchat_metadata(source.vrchat_metadata) as vrchat_metadata
  from public.gallery_images as source
  where source.vrchat_metadata is not null
) as sanitized
where gallery.id = sanitized.id
  and gallery.vrchat_metadata is distinct from sanitized.vrchat_metadata;

comment on column public.gallery_images.vrchat_metadata is
'Privacy-filtered VRChat capture time, display names, and world name. Stable user/world IDs and private instance IDs are removed.';

-- Membership checks are safe for use inside RLS and do not inherit a mutable
-- search_path. Anonymous callers receive false because auth.uid() is null.
create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.site_admins as site_admin
    where site_admin.user_id = (select auth.uid())
  );
$function$;

revoke all on function public.is_site_admin()
from public, anon, authenticated;
grant execute on function public.is_site_admin()
to anon, authenticated;

-- Preserve the existing privacy-filtered status RPC while removing its mutable
-- SECURITY DEFINER search path.
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
$function$;

revoke all on function public.get_public_marshy_status()
from public, anon, authenticated;
grant execute on function public.get_public_marshy_status()
to anon, authenticated;

alter table public.gallery_images enable row level security;
alter table public.approvals enable row level security;
alter table public.snake_scores enable row level security;
alter table public.dungeon_scores enable row level security;
alter table public.site_admins enable row level security;
alter table public.marshy_status enable row level security;

-- Replace policies on the six site-owned tables so an older permissive policy
-- cannot bypass these rules. Storage policies are handled separately below.
do $block$
declare
  existing_policy record;
begin
  for existing_policy in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'gallery_images',
        'approvals',
        'snake_scores',
        'dungeon_scores',
        'site_admins',
        'marshy_status'
      )
  loop
    execute pg_catalog.format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$block$;

create policy "Public can read gallery images"
on public.gallery_images
for select
to anon, authenticated
using (true);

create policy "Site admins can insert gallery images"
on public.gallery_images
for insert
to authenticated
with check (public.is_site_admin());

create policy "Site admins can update gallery images"
on public.gallery_images
for update
to authenticated
using (public.is_site_admin())
with check (public.is_site_admin());

create policy "Site admins can delete gallery images"
on public.gallery_images
for delete
to authenticated
using (public.is_site_admin());

create policy "Public can read approvals"
on public.approvals
for select
to anon, authenticated
using (true);

create policy "Site admins can delete approvals"
on public.approvals
for delete
to authenticated
using (public.is_site_admin());

create policy "Public can read Snake scores"
on public.snake_scores
for select
to anon, authenticated
using (true);

create policy "Site admins can delete Snake scores"
on public.snake_scores
for delete
to authenticated
using (public.is_site_admin());

create policy "Public can read Dungeon scores"
on public.dungeon_scores
for select
to anon, authenticated
using (true);

create policy "Site admins can delete Dungeon scores"
on public.dungeon_scores
for delete
to authenticated
using (public.is_site_admin());

create policy "Users can read their own site admin membership"
on public.site_admins
for select
to authenticated
using (user_id = (select auth.uid()));

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

revoke all privileges on table public.gallery_images
from public, anon, authenticated;
grant select on table public.gallery_images
to anon, authenticated;
grant insert, update, delete on table public.gallery_images
to authenticated;

revoke all privileges on table public.approvals
from public, anon, authenticated;
grant select on table public.approvals
to anon, authenticated;
grant delete on table public.approvals
to authenticated;

revoke all privileges on table public.snake_scores
from public, anon, authenticated;
grant select on table public.snake_scores
to anon, authenticated;
grant delete on table public.snake_scores
to authenticated;

revoke all privileges on table public.dungeon_scores
from public, anon, authenticated;
grant select on table public.dungeon_scores
to anon, authenticated;
grant delete on table public.dungeon_scores
to authenticated;

revoke all privileges on table public.site_admins
from public, anon, authenticated;
grant select on table public.site_admins
to authenticated;

revoke all privileges on table public.marshy_status
from public, anon, authenticated;
grant select on table public.marshy_status
to authenticated;
grant update (force_hidden) on table public.marshy_status
to authenticated;

create schema if not exists app_private;
revoke all privileges on schema app_private
from public, anon, authenticated;

-- Keep the hash key outside exposed schemas so stored IP/fingerprint digests
-- cannot be brute-forced without the private per-project secret.
create table if not exists app_private.submission_rate_limit_secret (
  singleton boolean primary key default true check (singleton),
  secret text not null default pg_catalog.gen_random_uuid()::text
);

insert into app_private.submission_rate_limit_secret (singleton)
values (true)
on conflict (singleton) do nothing;

alter table app_private.submission_rate_limit_secret enable row level security;
revoke all privileges on table app_private.submission_rate_limit_secret
from public, anon, authenticated;

-- Store hashed submission keys. The advisory lock serializes
-- submissions from one visitor so concurrent requests cannot race the counters.
create table if not exists app_private.submission_rate_limit_events (
  id bigint generated always as identity primary key,
  scope text not null,
  rate_key text not null,
  submitted_at timestamp with time zone not null default pg_catalog.now()
);

create index if not exists submission_rate_limit_events_lookup_idx
on app_private.submission_rate_limit_events (scope, rate_key, submitted_at desc);

create index if not exists submission_rate_limit_events_expiry_idx
on app_private.submission_rate_limit_events (submitted_at);

alter table app_private.submission_rate_limit_events enable row level security;
revoke all privileges on table app_private.submission_rate_limit_events
from public, anon, authenticated;

create or replace function public.submission_rate_key(visitor_fingerprint text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  request_headers jsonb := '{}'::jsonb;
  ip_candidate text;
  visitor_ip pg_catalog.inet;
  normalized_fingerprint text;
begin
  begin
    request_headers := coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception
    when others then
      request_headers := '{}'::jsonb;
  end;

  -- Cloudflare overwrites this header at the trusted Supabase edge. Do not trust
  -- arbitrary client-supplied forwarding headers from the request JSON.
  ip_candidate := nullif(
    pg_catalog.btrim(request_headers ->> 'cf-connecting-ip'),
    ''
  );

  if ip_candidate is not null then
    begin
      visitor_ip := ip_candidate::pg_catalog.inet;
    exception
      when invalid_text_representation then
        visitor_ip := null;
    end;
  end if;

  if visitor_ip is not null then
    return 'ip:' || pg_catalog.md5(pg_catalog.host(visitor_ip));
  end if;

  normalized_fingerprint := pg_catalog.btrim(coalesce(visitor_fingerprint, ''));

  if pg_catalog.char_length(normalized_fingerprint) between 8 and 128
    and normalized_fingerprint ~ '^[[:alnum:].:_-]+$'
  then
    return 'fingerprint:' || pg_catalog.md5(normalized_fingerprint);
  end if;

  raise exception using
    errcode = '22023',
    message = 'invalid_visitor_fingerprint';
end;
$function$;

revoke all on function public.submission_rate_key(text)
from public, anon, authenticated;

create or replace function public.enforce_submission_rate_limit(
  submission_scope text,
  submission_key text,
  short_window interval,
  short_limit integer,
  long_window interval,
  long_limit integer,
  limit_error text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_at timestamp with time zone := pg_catalog.clock_timestamp();
  short_attempts bigint;
  long_attempts bigint;
begin
  if submission_scope not in ('tos_approval', 'snake_score', 'dungeon_score')
    or pg_catalog.char_length(submission_key) < 4
    or short_window <= interval '0 seconds'
    or long_window < short_window
    or short_limit < 1
    or long_limit < short_limit
    or limit_error not in (
      'too_many_approvals',
      'too_many_snake_scores',
      'too_many_dungeon_scores'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'invalid_rate_limit_configuration';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(submission_scope || ':' || submission_key, 0)
  );

  delete from app_private.submission_rate_limit_events as expired
  where expired.submitted_at < checked_at - interval '24 hours';

  select
    pg_catalog.count(*) filter (
      where attempt.submitted_at >= checked_at - short_window
    ),
    pg_catalog.count(*)
  into short_attempts, long_attempts
  from app_private.submission_rate_limit_events as attempt
  where attempt.scope = submission_scope
    and attempt.rate_key = submission_key
    and attempt.submitted_at >= checked_at - long_window;

  if short_attempts >= short_limit or long_attempts >= long_limit then
    raise exception using
      errcode = 'P0001',
      message = limit_error;
  end if;

  insert into app_private.submission_rate_limit_events (
    scope,
    rate_key,
    submitted_at
  )
  values (
    submission_scope,
    submission_key,
    checked_at
  );
end;
$function$;

revoke all on function public.enforce_submission_rate_limit(
  text,
  text,
  interval,
  integer,
  interval,
  integer,
  text
)
from public, anon, authenticated;

create or replace function public.normalize_submission_name(
  submitted_name text,
  reject_symbols boolean,
  reject_staff_names boolean
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  normalized_name text := pg_catalog.regexp_replace(
    pg_catalog.btrim(coalesce(submitted_name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
begin
  if pg_catalog.char_length(normalized_name) not between 2 and 32 then
    raise exception using errcode = '22023', message = 'invalid_name_length';
  end if;

  if normalized_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'invalid_name_characters';
  end if;

  if normalized_name ~* '(https?://|www[.]|[.]com|[.]gg|discord[.]gg)' then
    raise exception using errcode = '22023', message = 'links_not_allowed';
  end if;

  if reject_symbols
    and pg_catalog.translate(
      normalized_name,
      '<>()[]{}|' || pg_catalog.chr(92),
      ''
    ) <> normalized_name
  then
    raise exception using errcode = '22023', message = 'invalid_name_symbols';
  end if;

  if pg_catalog.regexp_replace(normalized_name, '[[:space:]]', '', 'g')
    ~ E'(.)\\1{5,}'
  then
    raise exception using errcode = '22023', message = 'repeated_name_characters';
  end if;

  if reject_staff_names
    and normalized_name ~* '(admin|owner|moderator|support)'
  then
    raise exception using errcode = '22023', message = 'staff_name_not_allowed';
  end if;

  return normalized_name;
end;
$function$;

revoke all on function public.normalize_submission_name(text, boolean, boolean)
from public, anon, authenticated;

-- Drop the known public RPC signatures first so an older implementation cannot
-- remain as an overload that bypasses validation or rate limiting.
drop function if exists public.submit_tos_approval(text, text);
drop function if exists public.submit_snake_score(text, integer, text);
drop function if exists public.submit_dungeon_score(text, integer, integer, text);

create function public.submit_tos_approval(
  approval_name text,
  visitor_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  normalized_name text;
  rate_key text;
begin
  normalized_name := public.normalize_submission_name(
    approval_name,
    true,
    true
  );
  rate_key := public.submission_rate_key(visitor_fingerprint);

  perform public.enforce_submission_rate_limit(
    'tos_approval',
    rate_key,
    interval '10 minutes',
    2,
    interval '1 hour',
    10,
    'too_many_approvals'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'tos-approval-name:' || pg_catalog.lower(normalized_name),
      0
    )
  );

  if exists (
    select 1
    from public.approvals as approval
    where pg_catalog.lower(approval.name) = pg_catalog.lower(normalized_name)
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate_approval';
  end if;

  insert into public.approvals (name, approved_at)
  values (normalized_name, pg_catalog.clock_timestamp());
end;
$function$;

create function public.submit_snake_score(
  player_name text,
  player_score integer,
  visitor_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  normalized_name text;
  rate_key text;
begin
  normalized_name := public.normalize_submission_name(
    player_name,
    false,
    false
  );

  -- A 20x20 board starts with three occupied cells, so 397 is the natural
  -- maximum score for the current game implementation.
  if player_score is null or player_score not between 1 and 397 then
    raise exception using errcode = '22023', message = 'invalid_snake_score';
  end if;

  rate_key := public.submission_rate_key(visitor_fingerprint);
  perform public.enforce_submission_rate_limit(
    'snake_score',
    rate_key,
    interval '10 minutes',
    10,
    interval '1 hour',
    30,
    'too_many_snake_scores'
  );

  insert into public.snake_scores (name, score, created_at)
  values (normalized_name, player_score, pg_catalog.clock_timestamp());
end;
$function$;

create function public.submit_dungeon_score(
  player_name text,
  player_score integer,
  floor_reached integer,
  visitor_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  normalized_name text;
  rate_key text;
  submitted_floor integer := floor_reached;
begin
  normalized_name := public.normalize_submission_name(
    player_name,
    true,
    false
  );

  if submitted_floor is null or submitted_floor not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'invalid_dungeon_floor';
  end if;

  -- An absolute cap rejects pathological payloads while preserving floor reshuffles.
  if player_score is null
    or player_score < 1
    or player_score > 2000000
    -- No floor-to-score ratio: reshuffling can legitimately farm one floor.
  then
    raise exception using errcode = '22023', message = 'invalid_dungeon_score';
  end if;

  rate_key := public.submission_rate_key(visitor_fingerprint);
  perform public.enforce_submission_rate_limit(
    'dungeon_score',
    rate_key,
    interval '10 minutes',
    10,
    interval '1 hour',
    30,
    'too_many_dungeon_scores'
  );

  insert into public.dungeon_scores (
    name,
    score,
    floor_reached,
    created_at
  )
  values (
    normalized_name,
    player_score,
    submitted_floor,
    pg_catalog.clock_timestamp()
  );
end;
$function$;

revoke all on function public.submit_tos_approval(text, text)
from public, anon, authenticated;
revoke all on function public.submit_snake_score(text, integer, text)
from public, anon, authenticated;
revoke all on function public.submit_dungeon_score(text, integer, integer, text)
from public, anon, authenticated;

grant execute on function public.submit_tos_approval(text, text)
to anon, authenticated;
grant execute on function public.submit_snake_score(text, integer, text)
to anon, authenticated;
grant execute on function public.submit_dungeon_score(text, integer, integer, text)
to anon, authenticated;

-- Enforce upload constraints at the bucket as well as in browser-side image
-- processing. Existing objects remain readable even if they predate these limits.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'gallery',
  'gallery',
  true,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp']::pg_catalog.text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

-- Restrictive policies protect gallery writes even if the project already has a
-- broader permissive storage policy. They evaluate to true for every other bucket,
-- so unrelated bucket policies and behavior are not changed or dropped.
drop policy if exists "Gallery inserts require a site admin"
on storage.objects;
drop policy if exists "Gallery updates require a site admin"
on storage.objects;
drop policy if exists "Gallery deletes require a site admin"
on storage.objects;
drop policy if exists "Public can read gallery objects"
on storage.objects;
drop policy if exists "Site admins can upload gallery objects"
on storage.objects;
drop policy if exists "Site admins can update gallery objects"
on storage.objects;
drop policy if exists "Site admins can delete gallery objects"
on storage.objects;

create policy "Gallery inserts require a site admin"
on storage.objects
as restrictive
for insert
to anon, authenticated
with check (bucket_id <> 'gallery' or public.is_site_admin());

create policy "Gallery updates require a site admin"
on storage.objects
as restrictive
for update
to anon, authenticated
using (bucket_id <> 'gallery' or public.is_site_admin())
with check (bucket_id <> 'gallery' or public.is_site_admin());

create policy "Gallery deletes require a site admin"
on storage.objects
as restrictive
for delete
to anon, authenticated
using (bucket_id <> 'gallery' or public.is_site_admin());

create policy "Public can read gallery objects"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'gallery');

create policy "Site admins can upload gallery objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'gallery'
  and (name like 'full/%' or name like 'thumbs/%')
  and public.is_site_admin()
);

create policy "Site admins can update gallery objects"
on storage.objects
for update
to authenticated
using (bucket_id = 'gallery' and public.is_site_admin())
with check (
  bucket_id = 'gallery'
  and (name like 'full/%' or name like 'thumbs/%')
  and public.is_site_admin()
);

create policy "Site admins can delete gallery objects"
on storage.objects
for delete
to authenticated
using (bucket_id = 'gallery' and public.is_site_admin());

reset search_path;
