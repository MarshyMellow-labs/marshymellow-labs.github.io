import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
THEME_SCRIPT = (ROOT / "theme.js").read_text(encoding="utf-8")
THEME_STYLES = (ROOT / "theme.css").read_text(encoding="utf-8")
GAMES_PAGE = (ROOT / "games.html").read_text(encoding="utf-8")
HEADERS = (ROOT / "_headers").read_text(encoding="utf-8")
CONTROL_STYLES = (ROOT / "control-marshy.css").read_text(encoding="utf-8")

SITE_PAGES = (
    "404.html",
    "admin.html",
    "approved.html",
    "control-marshy.html",
    "donate.html",
    "dungeon.html",
    "games.html",
    "headset.html",
    "index.html",
    "snake.html",
    "where-is-marshy.html",
)

NAV_PAGES = (
    "approved.html",
    "control-marshy.html",
    "donate.html",
    "dungeon.html",
    "games.html",
    "headset.html",
    "index.html",
    "snake.html",
    "where-is-marshy.html",
)


class SharedSiteFeatureTests(unittest.TestCase):
    def test_every_page_loads_versioned_shared_theme_assets(self):
        for filename in SITE_PAGES:
            page = (ROOT / filename).read_text(encoding="utf-8")
            self.assertIn(
                'src="theme.js?v=20260720-1"',
                page,
                filename,
            )
            self.assertIn(
                'href="theme.css?v=20260720-1"',
                page,
                filename,
            )

    def test_shared_heart_rate_is_public_privacy_gated_data_only(self):
        self.assertIn("get_marshy_control_state", THEME_SCRIPT)
        self.assertIn('state?.heart_rate_status === "live"', THEME_SCRIPT)
        self.assertIn("Number.isInteger(state?.heart_rate)", THEME_SCRIPT)
        self.assertIn('JSON.stringify({ control_session_id: null })', THEME_SCRIPT)
        self.assertNotRegex(
            THEME_SCRIPT,
            r"PULSOID_ACCESS_TOKEN|MARSHY_CONTROL_COMPANION_SECRET|SUPABASE_SERVICE_ROLE_KEY",
        )

        for filename in SITE_PAGES:
            page = (ROOT / filename).read_text(encoding="utf-8")
            self.assertRegex(
                page,
                r"connect-src[^;]*https://hnqrptrfxxtuxhawyvge.supabase.co",
                filename,
            )

    def test_navigation_uses_one_games_destination(self):
        for filename in NAV_PAGES:
            page = (ROOT / filename).read_text(encoding="utf-8")
            self.assertIn('href="games.html"', page, filename)
            self.assertNotIn('href="snake.html"', page, filename)
            self.assertNotIn('href="dungeon.html"', page, filename)

        self.assertIn('window.location.replace("games.html#" + pageName)', THEME_SCRIPT)

    def test_games_run_in_one_document_without_frames_or_duplicate_ids(self):
        self.assertIn('data-game-root="snake"', GAMES_PAGE)
        self.assertIn('data-game-root="dungeon"', GAMES_PAGE)
        self.assertIn('src="snake-game.js?v=20260720-1"', GAMES_PAGE)
        self.assertIn('src="dungeon-game.js?v=20260720-1"', GAMES_PAGE)
        self.assertNotIn("<iframe", GAMES_PAGE)

        ids = re.findall(r'id="([^"]+)"', GAMES_PAGE)
        self.assertEqual(len(ids), len(set(ids)))

        self.assertIn("frame-ancestors 'none'", HEADERS)
        self.assertIn("X-Frame-Options: DENY", HEADERS)

    def test_zappy_dark_mode_uses_dark_cards_and_high_contrast_text(self):
        self.assertIn(
            'html[data-theme="dark"][data-page="control-marshy"]',
            THEME_STYLES,
        )
        self.assertIn("--control-card: rgba(27, 34, 51, 0.94)", THEME_STYLES)
        self.assertIn("--control-ink: #fff8ff", THEME_STYLES)
        self.assertIn('html[data-theme="dark"] .roulette-panel', CONTROL_STYLES)
        self.assertIn('html[data-theme="dark"] .roulette-odds li', CONTROL_STYLES)


if __name__ == "__main__":
    unittest.main()