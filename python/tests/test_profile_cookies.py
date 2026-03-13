import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

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
    client.get_profile_by_name.return_value = {}
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


def test_sync_profile_session_state_skips_preloaded_cookies_without_authenticated_session(monkeypatch):
    client = MagicMock()
    client.get_profile_by_name.return_value = {
        "name": "Profile A",
        "cookiesJson": canonical_cookies_json([
            {"name": "sessionid", "value": "persisted", "domain": ".instagram.com", "path": "/"},
            {"name": "csrftoken", "value": "persisted-csrf", "domain": ".instagram.com", "path": "/"},
        ]),
        "sessionId": "persisted",
    }
    monkeypatch.setattr("python.database.profiles.ProfilesClient", lambda: client)
    context = MagicMock()
    context.cookies.return_value = [
        {"name": "csrftoken", "value": "preloaded-only", "domain": ".instagram.com", "path": "/"},
    ]

    ok = browser_setup.sync_profile_session_state(context, "Profile A")

    assert ok is True
    client.get_profile_by_name.assert_called_once_with("Profile A")
    client.update_profile_by_name.assert_not_called()


def test_sync_profile_session_state_allows_explicit_logout_to_clear_stored_session(monkeypatch):
    client = MagicMock()
    client.get_profile_by_name.return_value = {
        "name": "Profile A",
        "cookiesJson": canonical_cookies_json([
            {"name": "sessionid", "value": "persisted", "domain": ".instagram.com", "path": "/"},
        ]),
        "sessionId": "persisted",
    }
    monkeypatch.setattr("python.database.profiles.ProfilesClient", lambda: client)
    context = MagicMock()
    context.cookies.return_value = []

    ok = browser_setup.sync_profile_session_state(context, "Profile A", explicit_logout=True)

    assert ok is True
    client.update_profile_by_name.assert_called_once_with("Profile A", {
        "name": "Profile A",
        "cookiesJson": "",
        "sessionId": "",
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


def test_create_browser_context_skips_empty_session_sync_after_bootstrap_timeout(monkeypatch):
    client = MagicMock()
    client.get_profile_by_name.return_value = {
        "name": "Profile A",
        "cookiesJson": canonical_cookies_json([
            {"name": "sessionid", "value": "persisted", "domain": ".instagram.com", "path": "/"},
        ]),
        "sessionId": "persisted",
    }
    monkeypatch.setattr("python.database.profiles.ProfilesClient", lambda: client)

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
    monkeypatch.setattr(browser_setup, "_preload_profile_cookies", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr(
        browser_setup,
        "safe_goto",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(PlaywrightTimeoutError("timeout")),
    )
    monkeypatch.setattr(browser_setup, "mark_proxy_failure", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup.proxy_circuit, "is_open", lambda: False)
    monkeypatch.setattr(browser_setup.proxy_circuit, "record_failure", lambda: None)
    monkeypatch.setattr(browser_setup, "TrafficMonitor", lambda: SimpleNamespace(
        on_response=lambda *_args, **_kwargs: None,
        should_pause=lambda: False,
        cooldown_until=0,
    ))

    with browser_setup.create_browser_context("Profile A") as (_context, _page):
        pass

    assert client.get_profile_by_name.call_count == 2
    client.update_profile_by_name.assert_not_called()


def test_create_browser_context_waits_for_cleanup_before_immediate_reopen(monkeypatch):
    cleanup_started = threading.Event()
    cleanup_finished = threading.Event()
    allow_cleanup_finish = threading.Event()
    first_context_returned = threading.Event()
    cleanup_calls = 0
    overlap_detected: list[bool] = []

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

    class FakeCamoufox:
        def __enter__(self):
            if cleanup_started.is_set() and not cleanup_finished.is_set():
                overlap_detected.append(True)
            return FakeContext()

        def __exit__(self, *_args):
            return None

    def _clean_cache2(_profile_path):
        nonlocal cleanup_calls
        cleanup_calls += 1
        cleanup_started.set()
        allow_cleanup_finish.wait(timeout=1)
        cleanup_finished.set()

    def _should_clean_today(*_args, **_kwargs):
        return cleanup_calls == 0

    def _run_first_context():
        with browser_setup.create_browser_context("Profile A") as (_context, _page):
            pass
        first_context_returned.set()

    monkeypatch.setattr(browser_setup, "Camoufox", lambda **_kwargs: FakeCamoufox())
    monkeypatch.setattr(browser_setup, "ensure_profile_path", lambda *_args, **_kwargs: "data/profiles/test")
    monkeypatch.setattr(browser_setup, "_should_clean_today", _should_clean_today)
    monkeypatch.setattr(browser_setup, "_clean_cache2", _clean_cache2)
    monkeypatch.setattr(browser_setup, "build_proxy_config", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup, "_attach_error_snapshots", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup.actions, "seed_mouse_cursor", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup, "_preload_profile_cookies", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr(browser_setup, "safe_goto", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup, "sync_profile_session_state", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(browser_setup, "TrafficMonitor", lambda: SimpleNamespace(
        on_response=lambda *_args, **_kwargs: None,
        should_pause=lambda: False,
        cooldown_until=0,
    ))
    monkeypatch.setattr(browser_setup, "initialize_browser_page", lambda context, *_args, **_kwargs: (context.new_page(), None))
    monkeypatch.setattr(browser_setup, "bootstrap_instagram_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_setup.proxy_circuit, "is_open", lambda: False)
    monkeypatch.setattr(browser_setup.proxy_circuit, "record_success", lambda: None)

    thread = threading.Thread(target=_run_first_context)
    thread.start()

    assert cleanup_started.wait(timeout=1) is True
    thread.join(timeout=0.05)
    assert first_context_returned.is_set() is False
    assert thread.is_alive() is True

    allow_cleanup_finish.set()
    thread.join(timeout=1)
    assert first_context_returned.is_set() is True
    assert cleanup_finished.is_set() is True

    with browser_setup.create_browser_context("Profile A") as (_context, _page):
        pass

    assert cleanup_calls == 1
    assert overlap_detected == []
