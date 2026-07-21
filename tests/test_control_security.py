import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260719010000_control_marshy.sql"
SESSION_HARDENING_MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260721010000_harden_marshy_earning_sessions.sql"
)
MODERATION_MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260721020000_add_marshy_request_moderation.sql"
)
ROULETTE_MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260721030000_add_marshy_roulette.sql"
)
ONE_SECOND_COOLDOWN_MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260721040000_allow_one_second_cooldown.sql"
)
PUBLIC_STYLES = ROOT / "control-marshy.css"
EDGE_FUNCTION = ROOT / "supabase" / "functions" / "marshy-control" / "index.ts"
PUBLIC_PAGE = ROOT / "control-marshy.html"
ADMIN_PAGE = ROOT / "admin.html"
PUBLIC_SCRIPT = ROOT / "control-marshy.js"
ADMIN_SCRIPT = ROOT / "control-admin.js"
SUPABASE_CONFIG = ROOT / "supabase" / "config.toml"
COMPANION_SCRIPT = ROOT / "companion" / "marshy-control.mjs"
COMPANION_CORE = ROOT / "companion" / "control-core.mjs"
COMPANION_ENV_EXAMPLE = ROOT / "companion" / ".env.example"


class ControlMarshySecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.session_hardening_sql = (
            SESSION_HARDENING_MIGRATION.read_text(encoding="utf-8").lower()
            if SESSION_HARDENING_MIGRATION.exists()
            else ""
        )
        cls.moderation_sql = (
            MODERATION_MIGRATION.read_text(encoding="utf-8").lower()
            if MODERATION_MIGRATION.exists()
            else ""
        )
        cls.roulette_sql = (
            ROULETTE_MIGRATION.read_text(encoding="utf-8").lower()
            if ROULETTE_MIGRATION.exists()
            else ""
        )
        cls.cooldown_sql = ONE_SECOND_COOLDOWN_MIGRATION.read_text(encoding="utf-8").lower()
        cls.edge = EDGE_FUNCTION.read_text(encoding="utf-8")
        cls.public_styles = PUBLIC_STYLES.read_text(encoding="utf-8")
        cls.page = PUBLIC_PAGE.read_text(encoding="utf-8")
        cls.admin_page = ADMIN_PAGE.read_text(encoding="utf-8")
        cls.public_script = PUBLIC_SCRIPT.read_text(encoding="utf-8")
        cls.admin_script = ADMIN_SCRIPT.read_text(encoding="utf-8")
        cls.supabase_config = SUPABASE_CONFIG.read_text(encoding="utf-8")
        cls.companion_script = COMPANION_SCRIPT.read_text(encoding="utf-8")
        cls.companion_core = COMPANION_CORE.read_text(encoding="utf-8")
        cls.companion_env_example = COMPANION_ENV_EXAMPLE.read_text(encoding="utf-8")

    def test_earning_rpc_errors_are_visible_in_the_wallet(self):
        self.assertIn('let earningConnectionError = "";', self.public_script)
        self.assertIn(
            "elements.tokenEarning.textContent = earningConnectionError",
            self.public_script,
        )
        self.assertIn(
            "earningConnectionError = messageForError(error)",
            self.public_script,
        )

    def test_control_scripts_use_cache_busting_versions(self):
        self.assertIn('src="control-marshy.js?v=20260721-8"', self.page)
        self.assertIn('src="control-admin.js?v=20260721-4"', self.admin_page)
        self.assertIn('href="control-admin.css?v=20260721-1"', self.admin_page)
        self.assertIn('href="control-marshy.css?v=20260721-6"', self.page)

    def test_local_oauth_redirects_use_one_consistent_hostname(self):
        self.assertIn('site_url = "http://localhost:3000"', self.supabase_config)
        self.assertIn(
            '"http://localhost:3000/control-marshy.html"',
            self.supabase_config,
        )
        self.assertIn('"http://localhost:3000/admin.html"', self.supabase_config)
        self.assertNotIn(
            'site_url = "http://127.0.0.1:3000"',
            self.supabase_config,
        )
        self.assertNotIn(
            '"http://127.0.0.1:3000/control-marshy.html"',
            self.supabase_config,
        )
        self.assertNotIn(
            '"http://127.0.0.1:3000/admin.html"',
            self.supabase_config,
        )

        self.assertIn(
            'new URL("control-marshy.html", window.location.href)',
            self.public_script,
        )
        self.assertIn(
            'new URL("admin.html", window.location.href)',
            self.admin_script,
        )

    def test_server_owns_wallet_and_queue_data(self):
        for table in (
            "marshy_control_settings",
            "marshy_control_runtime",
            "marshy_control_wallets",
            "marshy_control_blocks",
            "marshy_control_requests",
            "marshy_control_audit_log",
        ):
            self.assertIn(f"alter table public.{table} enable row level security", self.sql)
            self.assertRegex(
                self.sql,
                rf"revoke all privileges on table public\.{table}\s+from public, anon, authenticated",
            )

        self.assertNotIn(".from(\"marshy_control_wallets\")", self.public_script)
        self.assertNotIn(".from(\"marshy_control_requests\")", self.public_script)
        self.assertIn('db.rpc("enqueue_marshy_control_request"', self.public_script)

    def test_token_cap_and_single_active_session_are_database_enforced(self):
        self.assertIn("constraint marshy_control_token_cap check (balance between 0 and 300)", self.sql)
        self.assertIn("balance = least(300, balance + credited_seconds)", self.sql)
        self.assertIn("active_session_expires_at = checked_at + interval '15 seconds'", self.sql)
        self.assertIn("message = 'earning_session_active_elsewhere'", self.sql)
        self.assertIn("least(\n        10,", self.sql)

    def test_expired_earning_lease_cannot_receive_backfill(self):
        self.assertIn(
            "wallet_row.active_session_expires_at > checked_at",
            self.session_hardening_sql,
        )
        self.assertNotIn(
            "wallet_row.active_session_expires_at > wallet_row.last_accrual_at",
            self.session_hardening_sql,
        )
        self.assertIn(
            "drop function if exists public.heartbeat_marshy_control_session(uuid, boolean)",
            self.session_hardening_sql,
        )

    def test_hidden_official_client_releases_instead_of_heartbeating(self):
        self.assertNotIn(
            "page_visible: !document.hidden",
            self.public_script,
        )
        self.assertIn("if (document.hidden)", self.public_script)
        self.assertIn(
            'db.rpc("release_marshy_control_session"',
            self.public_script,
        )
        self.assertNotIn("page_visible:", self.public_script)
        self.assertIn(
            'db.rpc("heartbeat_marshy_control_session", {\n'
            "            control_session_id: sessionId\n"
            "          })",
            self.public_script,
        )

    def test_only_one_request_per_discord_user_can_be_pending(self):
        self.assertRegex(
            self.sql,
            r"create unique index if not exists marshy_control_one_pending_request_per_user\s+"
            r"on public\.marshy_control_requests \(user_id\)\s+"
            r"where status in \('queued', 'executing'\)",
        )
        self.assertIn("message = 'request_already_pending'", self.sql)

    def test_cooldown_and_duration_have_hard_safety_floors_and_ceilings(self):
        self.assertIn("cooldown_seconds between 1 and 600", self.sql)
        self.assertIn("cooldown_seconds between 1 and 600", self.cooldown_sql)
        self.assertIn("cooldown_seconds = 1", self.cooldown_sql)
        self.assertIn("settings.cooldown_seconds = 10", self.cooldown_sql)
        for duration in (
            "low_duration_ms",
            "high_duration_ms",
            "extreme_duration_ms",
            "vibration_duration_ms",
        ):
            self.assertIn(f"{duration} between 100 and 1000", self.sql)
        self.assertIn("last_operation_at = checked_at", self.sql)

    def test_extreme_requests_are_not_downgraded(self):
        self.assertIn("pg_advisory_xact_lock", self.sql)
        self.assertNotIn("previous_zap", self.sql)
        self.assertNotIn("request_queued_and_converted", self.sql)
        self.assertIn("'converted', false", self.sql)
        self.assertIn("when 'extreme' then settings_row.extreme_cost", self.sql)

    def test_requests_fail_closed_when_controller_is_not_ready(self):
        for guard in (
            "not settings_row.controls_enabled",
            "settings_row.emergency_stopped",
            "not runtime_row.pishock_connected",
            "runtime_row.pishock_paused",
            "not runtime_row.locally_armed",
            "not runtime_row.local_cap_configured",
        ):
            self.assertIn(guard, self.sql)
        self.assertIn("message = 'controller_not_ready'", self.sql)
        self.assertIn("companion_ack_timeout_no_retry", self.sql)

    def test_physical_tiers_are_only_percentages_of_a_local_cap(self):
        self.assertIn("percentage of the separate owner-set local companion maximum", self.sql)
        self.assertIn("tier_percent_of_local_cap", self.sql)
        self.assertNotRegex(self.public_script, r"api[_-]?key|share[_-]?code|access[_-]?token")

    def test_roulette_is_server_selected_stored_and_separately_redeemed(self):
        self.assertIn(
            "create table if not exists public.marshy_control_roulette_prizes",
            self.roulette_sql,
        )
        self.assertIn("user_id uuid not null unique", self.roulette_sql)
        self.assertIn(
            "alter table public.marshy_control_roulette_prizes enable row level security",
            self.roulette_sql,
        )
        self.assertIn(
            "revoke all privileges on table public.marshy_control_roulette_prizes",
            self.roulette_sql,
        )
        self.assertIn("tier_percent between 1 and 200", self.roulette_sql)
        self.assertIn("create or replace function public.spin_marshy_roulette", self.roulette_sql)
        self.assertIn("create or replace function public.redeem_marshy_roulette_prize", self.roulette_sql)
        self.assertIn("create or replace function public.get_my_marshy_roulette_prize", self.roulette_sql)
        self.assertIn(
            "roulette_slot := 1 + pg_catalog.floor(pg_catalog.random() * 22)::integer",
            self.roulette_sql,
        )
        self.assertIn("roulette_slot in (1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21)", self.roulette_sql)
        self.assertIn("roulette_slot in (2, 6, 10, 14, 20)", self.roulette_sql)
        self.assertIn("roulette_slot in (4, 12, 18)", self.roulette_sql)
        self.assertIn("roulette_slot in (8, 22)", self.roulette_sql)
        self.assertIn("resolved_percent := 200", self.roulette_sql)
        self.assertIn("balance = balance - 100", self.roulette_sql)
        self.assertIn("prize_row.created_at + interval '3.6 seconds'", self.roulette_sql)
        self.assertIn("'roulette',\n    prize_row.resolved_action,\n    0,", self.roulette_sql)
        self.assertIn('db.rpc("spin_marshy_roulette"', self.public_script)
        self.assertIn('db.rpc("redeem_marshy_roulette_prize"', self.public_script)
        self.assertIn('db.rpc("get_my_marshy_roulette_prize"', self.public_script)
        self.assertNotIn("math.random", self.public_script.lower())
        self.assertNotIn('data-control-action="roulette"', self.page)
        self.assertIn('id="roulette-spin" type="button" disabled', self.page)
        self.assertIn('elements.rouletteSpin.textContent = "Choosing your result..."', self.public_script)
        self.assertIn('id="roulette-use"', self.page)
        self.assertNotIn("half-scale", self.page.lower())
        self.assertIn('label.startsWith("Vib") ? "V"', self.public_script)
        self.assertIn("Send my zappies!", self.page)
        self.assertIn("You got: ${prizeLabel} Sending zappies...", self.public_script)
        self.assertIn("Your zappies are on the way!", self.public_script)
        self.assertNotIn("${ROULETTE_SLOTS[prize.slot - 1]} was added to the queue", self.public_script)
        self.assertIn('label.match(/^\\d+/)?.[0]', self.public_script)
        self.assertIn('"50% Zappy!"', self.public_script)
        self.assertIn('elements.rouletteWheel.animate(', self.public_script)
        self.assertIn("transition: none;", self.public_styles)
        self.assertIn("roulette database update has not been deployed", self.public_script.lower())

    def test_discord_identity_is_checked_at_the_database_boundary(self):
        self.assertIn("from auth.identities as identity", self.sql)
        self.assertIn("identity.provider = 'discord'", self.sql)
        self.assertIn("discord_account_too_new", self.sql)
        self.assertIn('provider: "discord"', self.public_script)
        self.assertIn('provider: "discord"', self.admin_script)

    def test_postgres_conditional_expressions_are_not_schema_qualified(self):
        self.assertNotIn("pg_catalog.least(", self.sql)
        self.assertNotIn("pg_catalog.greatest(", self.sql)
    def test_companion_service_functions_are_not_browser_callable(self):
        for signature in (
            "public.companion_marshy_control_heartbeat(",
            "public.companion_complete_marshy_control_request(",
        ):
            self.assertIn(signature, self.sql)
        self.assertGreaterEqual(self.sql.count("to service_role;"), 2)
        self.assertIn('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")', self.edge)
        self.assertIn('Deno.env.get("MARSHY_CONTROL_COMPANION_SECRET")', self.edge)
        self.assertNotIn("Access-Control-Allow-Origin", self.edge)

    def test_no_private_companion_credentials_are_shipped_to_the_browser(self):
        browser_bundle = "\n".join((self.page, self.public_script, self.admin_script))
        for forbidden in (
            "SUPABASE_SERVICE_ROLE_KEY",
            "MARSHY_CONTROL_COMPANION_SECRET",
            "PISHOCK_API_KEY",
            "PISHOCK_SHARE_CODE",
            "PULSOID_ACCESS_TOKEN",
        ):
            self.assertNotIn(forbidden, browser_bundle)

    def test_heart_rate_is_display_only_and_privacy_gated(self):
        self.assertIn("share_heart_rate", self.sql)
        self.assertIn("heart_rate_received_at < checked_at - interval '30 seconds'", self.sql)
        self.assertNotRegex(
            self.sql,
            r"heart_rate\s*(?:>|<|=)\s*\d+.+?(?:enqueue|resolved_action|tier_percent)",
        )
        self.assertNotIn("heart_rate", self.public_script[self.public_script.find("async function enqueue"):])

    def test_recent_request_users_have_server_authorized_moderation(self):
        self.assertIn(
            "create table if not exists public.marshy_control_timeouts",
            self.moderation_sql,
        )
        self.assertIn(
            "alter table public.marshy_control_timeouts enable row level security",
            self.moderation_sql,
        )
        self.assertIn(
            "revoke all privileges on table public.marshy_control_timeouts",
            self.moderation_sql,
        )
        self.assertIn(
            "create trigger marshy_control_clear_timeout_on_block",
            self.moderation_sql,
        )
        self.assertIn(
            "before insert on public.marshy_control_requests",
            self.moderation_sql,
        )
        self.assertIn("timeout.timed_out_until > checked_at", self.moderation_sql)
        self.assertIn("timeout_minutes > 10080", self.moderation_sql)
        self.assertGreaterEqual(
            self.moderation_sql.count("perform public.control_require_site_admin()"),
            1,
        )
        self.assertIn('db.rpc("admin_get_marshy_control_request_users"', self.admin_script)
        self.assertIn('db.rpc("admin_set_marshy_control_timeout"', self.admin_script)
        self.assertIn("function displayDiscordName", self.admin_script)
        self.assertIn(
            "title.textContent = displayDiscordName(blocked.display_name);",
            self.admin_script,
        )
        self.assertNotIn("title.textContent = blocked.display_name ||", self.admin_script)
        self.assertNotIn("admin_get_marshy_control_audit", self.admin_script)
        self.assertNotIn("JSON.stringify(entry.details", self.admin_script)
        self.assertIn("Recent request users", self.admin_page)
        self.assertIn("usr_[a-z0-9-]{8,}", self.admin_script)
        self.assertNotIn("usr_[a-z0-9-]{8,}\\s*\\)\\s*$/i", self.admin_script)
        self.assertIn("\\u200b-\\u200d\\ufeff", self.admin_script.lower())
        self.assertIn("title.textContent = username", self.admin_script)
        self.assertIn("setUserBlock(entry.user_id", self.admin_script)

    def test_admin_refresh_preserves_unsaved_control_settings(self):
        self.assertIn("let formDirty = false;", self.admin_script)
        self.assertIn("if (formDirty)", self.admin_script)
        self.assertIn(
            'elements.form.addEventListener("input", () => {',
            self.admin_script,
        )

    def test_companion_surfaces_scrubbed_backend_connection_errors(self):
        self.assertIn("Control backend error:", self.companion_script)
        self.assertIn("lastBackendError: this.lastError", self.companion_script)

    def test_companion_allows_hardware_limited_full_software_scale(self):
        self.assertIn("const HARD_LOCAL_CAP_LIMIT = 100;", self.companion_script)
        self.assertIn("hardware-side safety cap", self.companion_env_example)
        self.assertIn("does not configure or verify that hardware cap", self.companion_env_example)
        self.assertIn("Math.round(maximum * percent / 200)", self.companion_core)
        self.assertIn("roulette-only 200 result", self.companion_env_example)

    def test_pishock_broker_body_uses_validated_numeric_ids(self):
        self.assertIn("function requiredNumericIdentifier", self.companion_script)
        self.assertIn("Number.isSafeInteger(parsed)", self.companion_script)
        self.assertIn("id: device.shockerId", self.companion_script)
        self.assertIn("u: device.userId", self.companion_script)
    def test_local_arm_persists_until_stop_or_an_existing_fail_safe(self):
        self.assertNotIn("ARM_WINDOW_MS", self.companion_script)
        self.assertNotIn("arm window expired", self.companion_script.lower())
        self.assertIn("ARMED locally until stopped", self.companion_script)
        self.assertIn('command === "disarm" || command === "stop"', self.companion_script)
        self.assertIn("const BACKEND_LOSS_LIMIT_MS = 30_000", self.companion_script)
        self.assertIn("Control backend has been unavailable for over 30 seconds", self.companion_script)
        self.assertIn("Server emergency stop is active", self.companion_script)
    def test_pulsoid_osc_input_is_loopback_only_and_documented(self):
        self.assertIn('socket.bind(this.port, "127.0.0.1"', self.companion_script)
        self.assertIn("parseOscHeartRatePacket", self.companion_script)
        self.assertIn("PULSOID_OSC_ENABLED=false", self.companion_env_example)
        self.assertIn("PULSOID_OSC_PORT=9002", self.companion_env_example)
        self.assertIn(
            "PULSOID_OSC_ADDRESS=/avatar/parameters/HeartRateInt",
            self.companion_env_example,
        )


if __name__ == "__main__":
    unittest.main()
