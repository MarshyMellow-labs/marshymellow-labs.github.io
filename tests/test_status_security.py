from __future__ import annotations

import re
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ROOT_SETUP = REPO_ROOT / "supabase-marshy-status.sql"
HISTORICAL_HARDENING_MIGRATION = (
    REPO_ROOT / "supabase/migrations/20260717010000_security_hardening.sql"
)
FORWARD_FIX_MIGRATION = (
    REPO_ROOT / "supabase/migrations/20260717020000_status_security_fix.sql"
)
SETUP_GUIDE = REPO_ROOT / "MARSHY-STATUS-SETUP.md"
SUPPORTED_FINAL_SQL = (ROOT_SETUP, FORWARD_FIX_MIGRATION)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def status_function(sql: str) -> str:
    start = sql.index("create or replace function public.get_public_marshy_status()")
    end = sql.index("revoke all on function public.get_public_marshy_status()", start)
    return sql[start:end]


def model_public_projection(
    row: dict[str, object], now: datetime
) -> dict[str, object]:
    is_current = row["updated_at"] >= now - timedelta(minutes=12)
    redact = bool(row["force_hidden"]) or not is_current
    state = (
        "private"
        if row["force_hidden"]
        else "unknown"
        if not is_current
        else row["state"]
    )
    return {
        "state": state,
        "world_name": None if redact else row["world_name"],
        "instance_type": None if redact else row["instance_type"],
        "player_count": None if redact else row["player_count"],
        "player_names": None if redact else row["player_names"],
        "message": None if redact else row["message"],
    }


class StatusSecurityTests(unittest.TestCase):
    def test_supported_status_definitions_enforce_server_freshness(self) -> None:
        for path in SUPPORTED_FINAL_SQL:
            with self.subTest(path=path.relative_to(REPO_ROOT)):
                function = status_function(read(path))
                self.assertIn("now() - interval '12 minutes'", function)
                self.assertRegex(
                    function,
                    re.compile(
                        r"case\s+when status\.force_hidden then 'private'\s+"
                        r"when not status\.is_current then 'unknown'",
                        re.IGNORECASE,
                    ),
                )
                for field in (
                    "world_name",
                    "instance_type",
                    "player_count",
                    "player_names",
                    "message",
                ):
                    self.assertRegex(
                        function,
                        re.compile(
                            r"case when status\.force_hidden or not status\.is_current "
                            rf"then null else status\.{field} end",
                            re.IGNORECASE,
                        ),
                    )

    def test_supported_setup_paths_keep_column_scoped_update(self) -> None:
        broad_grant = re.compile(
            r"grant\s+select\s*,\s*update\s+on\s+table\s+"
            r"public\.marshy_status\s+to\s+authenticated",
            re.IGNORECASE,
        )
        narrow_grant = re.compile(
            r"grant\s+update\s*\(\s*force_hidden\s*\)\s+on\s+table\s+"
            r"public\.marshy_status\s+to\s+authenticated",
            re.IGNORECASE,
        )
        for path in SUPPORTED_FINAL_SQL:
            with self.subTest(path=path.relative_to(REPO_ROOT)):
                sql = read(path)
                self.assertIsNone(broad_grant.search(sql))
                self.assertIsNotNone(narrow_grant.search(sql))

    def test_forward_fix_runs_after_historical_hardening(self) -> None:
        self.assertGreater(
            FORWARD_FIX_MIGRATION.name,
            HISTORICAL_HARDENING_MIGRATION.name,
        )

    def test_setup_guide_includes_forward_fix_for_existing_databases(self) -> None:
        self.assertIn(FORWARD_FIX_MIGRATION.name, read(SETUP_GUIDE))

    def test_projection_preserves_fresh_public_status(self) -> None:
        now = datetime(2026, 7, 17, 12, 0, tzinfo=timezone.utc)
        row = self._row(now - timedelta(minutes=11))
        projection = model_public_projection(row, now)
        self.assertEqual(projection["state"], "public")
        self.assertEqual(projection["world_name"], "Test World")
        self.assertEqual(projection["player_names"], ["Marshy", "Friend"])

    def test_projection_redacts_stale_status(self) -> None:
        now = datetime(2026, 7, 17, 12, 0, tzinfo=timezone.utc)
        projection = model_public_projection(
            self._row(now - timedelta(minutes=13)), now
        )
        self.assertEqual(projection["state"], "unknown")
        self.assertTrue(
            all(projection[field] is None for field in projection if field != "state")
        )

    def test_force_hidden_remains_private_even_when_fresh(self) -> None:
        now = datetime(2026, 7, 17, 12, 0, tzinfo=timezone.utc)
        row = self._row(now - timedelta(minutes=1))
        row["force_hidden"] = True
        projection = model_public_projection(row, now)
        self.assertEqual(projection["state"], "private")
        self.assertTrue(
            all(projection[field] is None for field in projection if field != "state")
        )

    @staticmethod
    def _row(updated_at: datetime) -> dict[str, object]:
        return {
            "state": "public",
            "world_name": "Test World",
            "instance_type": "Public",
            "player_count": 2,
            "player_names": ["Marshy", "Friend"],
            "message": "Hello",
            "updated_at": updated_at,
            "force_hidden": False,
        }


if __name__ == "__main__":
    unittest.main()
