-- Permit the owner to configure a serialized global cooldown as low as one
-- second. Existing custom cooldowns above 10 seconds are preserved; the
-- previous untouched 10-second setting moves to the new default.

alter table public.marshy_control_settings
  alter column cooldown_seconds set default 1;

alter table public.marshy_control_settings
  drop constraint if exists marshy_control_cooldown_floor;

alter table public.marshy_control_settings
  add constraint marshy_control_cooldown_floor
  check (cooldown_seconds between 1 and 600);

update public.marshy_control_settings as settings
set
  cooldown_seconds = 1,
  settings_version = settings.settings_version + 1,
  updated_at = pg_catalog.clock_timestamp()
where settings.id = 'marshy'
  and settings.cooldown_seconds = 10;

notify pgrst, 'reload schema';
