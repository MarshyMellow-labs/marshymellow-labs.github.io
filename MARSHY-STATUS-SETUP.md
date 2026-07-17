# Where is Marshy setup

The page uses a local VRChat log updater, a protected Supabase Edge Function, and a privacy-filtered database function.

## Privacy behavior

- Public, Friends+, Group+, and Group Public instances show the map, instance type, player count, and current display-name roster.
- Friends, Group, Invite+, and Invite instances show **Marshy is hiding**, the map, and the instance type. They never publish a player count or roster.
- Between worlds: **Marshy is on the move**.
- VRChat closed: **Marshy is offline**.
- Old or missing heartbeat: **Nobody knows**.
- The admin privacy override removes the map, type, count, and roster from the public response.

The updater never publishes an instance ID, user ID, VRChat password, authentication cookie, or Supabase service-role key. Public rosters contain the display names that VRChat writes to the local output log.

## 1. Apply the database migration

Open the linked Supabase project, choose **SQL Editor**, paste `supabase-marshy-status.sql`, and select **Run**. The script is safe to rerun: it adds the instance and roster columns when upgrading an existing setup, preserves the `force_hidden`-only administrator grant, and enforces the twelve-minute freshness rule in the public database response.

Then run **supabase/migrations/20260717010000_security_hardening.sql**. It removes private VRChat identifiers from existing gallery rows, locks all admin mutations to site admins, replaces public score and approval writes with validated rate-limited RPCs, and restricts gallery uploads.

Finally run **supabase/migrations/20260717020000_status_security_fix.sql**. This forward migration updates databases that already applied the earlier migrations, so stale status details are redacted by the RPC and authenticated administrators retain only `UPDATE(force_hidden)`.

In **Authentication > Providers > Email**, turn off **Allow new users to sign up** after confirming the existing admin account works. Existing users can still sign in.

The public page reads `get_public_marshy_status()` instead of the underlying table. This makes both the admin privacy override and the twelve-minute heartbeat expiry apply at the database boundary rather than only hiding fields in the browser.

## 2. Deploy the protected Edge Function

From the website folder:

```powershell
supabase login
supabase link --project-ref hnqrptrfxxtuxhawyvge
supabase functions deploy marshy-status --no-verify-jwt
```

The `--no-verify-jwt` option is required because the local updater uses its own private secret rather than a public Supabase user token.

The function deliberately does not enable browser CORS because only the local updater calls it. Failed secret checks are throttled per source address, and authenticated request bodies are limited to 64 KiB.

## 3. Create the private updater secret

Generate a long random value. Do not put it in GitHub, HTML, screenshots, or chat messages.

Set the same value in Supabase:

```powershell
supabase secrets set MARSHY_STATUS_SECRET="PASTE_A_LONG_RANDOM_SECRET_HERE"
```

Store it for your Windows account:

```powershell
[Environment]::SetEnvironmentVariable(
  "MARSHY_STATUS_SECRET",
  "PASTE_THE_SAME_LONG_RANDOM_SECRET_HERE",
  "User"
)
```

Close and reopen PowerShell after setting the Windows variable.

## 4. Start or restart the updater

Run `Start-MarshyStatus.bat`, or:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\marshy-status\Update-MarshyStatus.ps1"
```

Leave that window open while using VRChat. It reads the newest VRChat output log from:

```text
%USERPROFILE%\AppData\LocalLow\VRChat\VRChat
```

The roster updates when VRChat logs player joins and leaves. The updater also sends a heartbeat every five minutes. If it stops, the database response and website treat the signal as unknown after twelve minutes.
