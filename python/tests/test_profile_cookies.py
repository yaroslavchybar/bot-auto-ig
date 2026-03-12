from types import SimpleNamespace
from unittest.mock import MagicMock

from python.browser import setup as browser_setup
from python.browser.cookies import (
    canonical_cookies_json,
    extract_instagram_session_id,
    normalize_profile_cookies,
)


def test_normalize_profile_cookies_accepts_array_and_object_shapes():
    raw_array = '[{"name":"sessionid","value":"abc","domain":".instagram.com","path":"/"}]'
    object_shape = {
        "cookies": [
            {"name": "csrftoken", "value": "def", "domain": ".instagram.com", "path": "/"}
        ]
    }

    normalized_array = normalize_profile_cookies(raw_array)
    normalized_object = normalize_profile_cookies(object_shape)

    assert normalized_array[0]["name"] == "sessionid"
    assert normalized_object[0]["name"] == "csrftoken"


def test_normalize_profile_cookies_drops_invalid_entries_when_requested():
    cookies = normalize_profile_cookies({
        "cookies": [
            {"name": "sessionid", "value": "abc", "domain": ".instagram.com", "path": "/"},
            {"name": "", "value": "broken", "domain": ".instagram.com", "path": "/"},
        ]
    }, drop_invalid=True)

    assert cookies == [{"name": "sessionid", "value": "abc", "domain": ".instagram.com", "path": "/"}]


def test_extract_instagram_session_id_reads_normalized_cookies():
    cookies = normalize_profile_cookies([
        {"name": "sessionid", "value": "abc", "domain": ".instagram.com", "path": "/"},
        {"name": "other", "value": "x", "domain": ".instagram.com", "path": "/"},
    ])
    assert extract_instagram_session_id(cookies) == "abc"


def test_preload_profile_cookies_adds_normalized_cookies(monkeypatch):
    monkeypatch.setattr(browser_setup, "_load_profile_cookies", lambda profile_name: [
        {"name": "sessionid", "value": "abc", "domain": ".instagram.com", "path": "/"}
    ])
    context = MagicMock()

    loaded = browser_setup._preload_profile_cookies(context, "Profile A")

    assert loaded == 1
    context.add_cookies.assert_called_once_with([
        {"name": "sessionid", "value": "abc", "domain": ".instagram.com", "path": "/"}
    ])


def test_sync_profile_session_state_writes_cookies_and_session(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr("python.database.profiles.ProfilesClient", lambda: client)
    context = MagicMock()
    context.cookies.return_value = [
        {"name": "sessionid", "value": "abc", "domain": ".instagram.com", "path": "/"},
        {"name": "csrftoken", "value": "def", "domain": ".instagram.com", "path": "/"},
    ]

    ok = browser_setup.sync_profile_session_state(context, "Profile A")

    assert ok is True
    client.update_profile_by_name.assert_called_once_with("Profile A", {
        "name": "Profile A",
        "cookiesJson": canonical_cookies_json([
            {"name": "sessionid", "value": "abc", "domain": ".instagram.com", "path": "/"},
            {"name": "csrftoken", "value": "def", "domain": ".instagram.com", "path": "/"},
        ]),
        "sessionId": "abc",
    })


def test_create_browser_context_preloads_cookies_before_navigation(monkeypatch):
    events = []

    class FakePage:
        def __init__(self):
            self.url = "about:blank"

        def on(self, *_args, **_kwargs):
            return None

        def content(self):
            return ""

    class FakeContext:
        def __init__(self):
            self.pages = []
            self.page = FakePage()

        def new_page(self):
            return self.page

        def close(self):
            return None

        def cookies(self):
            return []

    fake_context = FakeContext()

    class FakeCamoufox:
        def __enter__(self):
            return fake_context

        def __exit__(self, *_args):
            return None

    monkeypatch.setattr(browser_setup, "Camoufox", lambda **_kwargs: FakeCamoufox())
    monkeypatch.setattr(browser_setup, "ensure_profile_path", lambda *_args, **_kwargs: "data/profiles/test")
    monkeypatch.setattr(browser_setup, "_should_clean_today", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(browser_setup, "build_proxy_config", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup, "_attach_error_snapshots", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup.actions, "seed_mouse_cursor", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup, "_preload_profile_cookies", lambda *_args, **_kwargs: events.append("preload") or 1)
    monkeypatch.setattr(browser_setup, "safe_goto", lambda *_args, **_kwargs: events.append("goto"))
    monkeypatch.setattr(browser_setup, "sync_profile_session_state", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(browser_setup, "TrafficMonitor", lambda: SimpleNamespace(
        on_response=lambda *_args, **_kwargs: None,
        should_pause=lambda: False,
        cooldown_until=0,
    ))
    monkeypatch.setattr(browser_setup.proxy_circuit, "is_open", lambda: False)
    monkeypatch.setattr(browser_setup.proxy_circuit, "record_success", lambda: None)

    with browser_setup.create_browser_context("Profile A") as (_context, _page):
        pass

    assert events == ["preload", "goto"]
