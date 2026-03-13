"""Tests for shared session module (Phase 1: Connection Pooling)."""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import unittest
from unittest.mock import patch, MagicMock
import threading


class TestSharedSession(unittest.TestCase):
    """Test cases for shared_session.py singleton HTTP session."""

    def setUp(self):
        """Reset the global session before each test."""
        # Import here to avoid module-level import issues
        import python.database.session as ss
        self.ss = ss
        # Reset global state
        ss._session = None

    def test_get_shared_session_returns_session(self):
        """Should return a requests.Session instance."""
        session = self.ss.get_shared_session()
        import requests
        self.assertIsInstance(session, requests.Session)

    def test_get_shared_session_is_singleton(self):
        """Should return the same session instance on multiple calls."""
        session1 = self.ss.get_shared_session()
        session2 = self.ss.get_shared_session()
        self.assertIs(session1, session2)

    def test_session_has_https_adapter(self):
        """Session should have an HTTPAdapter mounted for https://."""
        session = self.ss.get_shared_session()
        adapter = session.get_adapter("https://example.com")
        from requests.adapters import HTTPAdapter
        self.assertIsInstance(adapter, HTTPAdapter)

    def test_session_has_http_adapter(self):
        """Session should have an HTTPAdapter mounted for http://."""
        session = self.ss.get_shared_session()
        adapter = session.get_adapter("http://example.com")
        from requests.adapters import HTTPAdapter
        self.assertIsInstance(adapter, HTTPAdapter)

    def test_adapter_has_connection_pool(self):
        """HTTPAdapter should have connection pooling configured."""
        session = self.ss.get_shared_session()
        adapter = session.get_adapter("https://example.com")
        # Check pool maxsize (set to 20 in implementation)
        self.assertEqual(adapter.config.get("pool_maxsize", adapter._pool_maxsize), 20)

    def test_thread_safety(self):
        """Session creation should be thread-safe (no race conditions)."""
        sessions = []
        errors = []

        def get_session():
            try:
                s = self.ss.get_shared_session()
                sessions.append(s)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=get_session) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        # All threads should get the same session instance
        self.assertTrue(all(s is sessions[0] for s in sessions))


class TestProfilesClientResilientHttpClient(unittest.TestCase):
    """Test that profiles_client.py uses ResilientHttpClient."""

    def test_profiles_client_uses_resilient_http_client(self):
        """ProfilesClient should use ResilientHttpClient."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            # Reset config cache
            import importlib
            import python.core.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.database.profiles.ResilientHttpClient") as MockClient:
                mock_http_client = MagicMock()
                MockClient.return_value = mock_http_client
                
                from python.database.profiles import ProfilesClient
                client = ProfilesClient()
                
                MockClient.assert_called_once()
                self.assertEqual(client.http_client, mock_http_client)


class TestInstagramAccountsClientResilientHttpClient(unittest.TestCase):
    """Test that instagram_accounts_client.py uses ResilientHttpClient."""

    def test_instagram_accounts_client_uses_resilient_http_client(self):
        """InstagramAccountsClient should use ResilientHttpClient."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            import importlib
            import python.core.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.database.accounts.ResilientHttpClient") as MockClient:
                mock_http_client = MagicMock()
                MockClient.return_value = mock_http_client
                
                from python.database.accounts import InstagramAccountsClient
                client = InstagramAccountsClient()
                
                MockClient.assert_called_once()
                self.assertEqual(client.http_client, mock_http_client)


class TestWorkflowRunnerSettings(unittest.TestCase):
    def test_extract_start_browser_settings_maps_legacy_fields(self):
        import python.runners.run_workflow as run_workflow

        settings = run_workflow._extract_start_browser_settings(
            [
                {
                    "id": "start_browser_1",
                    "type": "activity",
                    "data": {
                        "activityId": "start_browser",
                        "config": {
                            "headlessMode": True,
                            "parallelProfiles": 4,
                            "profileReopenCooldown": 45,
                            "messagingCooldown": 12,
                        },
                    },
                }
            ],
            {},
        )

        self.assertEqual(
            settings,
            {
                "headless": True,
                "parallel_profiles": 4,
                "profile_reopen_cooldown_enabled": True,
                "profile_reopen_cooldown_minutes": 45,
                "messaging_cooldown_enabled": True,
                "messaging_cooldown_hours": 12,
            },
        )

    def test_fetch_profiles_for_lists_uses_available_endpoint_when_cooldown_enabled(self):
        import python.runners.run_workflow as run_workflow

        captured = {}

        class Response:
            status_code = 200

            @staticmethod
            def json():
                return [{"profile_id": "profile-1", "name": "Profile 1"}]

        def fake_post(url, json, headers, timeout):
            captured["url"] = url
            captured["payload"] = json
            captured["timeout"] = timeout
            return Response()

        with patch.object(run_workflow, "PROJECT_URL", "https://convex.example"), patch.object(
            run_workflow, "SECRET_KEY", "secret"
        ), patch("requests.post", side_effect=fake_post):
            profiles = run_workflow._fetch_profiles_for_lists(
                ["list-1"],
                cooldown_minutes=30,
                enforce_cooldown=True,
            )

        self.assertEqual(
            captured["url"],
            "https://convex.example/api/profiles/available",
        )
        self.assertEqual(
            captured["payload"],
            {"listIds": ["list-1"], "cooldownMinutes": 30},
        )
        self.assertEqual(captured["timeout"], 30)
        self.assertEqual(
            profiles,
            [{"profile_id": "profile-1", "name": "Profile 1"}],
        )


class TestWorkflowActivityDispatch(unittest.TestCase):
    def test_close_existing_context_exits_ctx_manager(self):
        from python.runners.workflow.activity_dispatch import _close_existing_context

        calls = []

        class _Context:
            def close(self):
                calls.append('close')

        class _CtxMgr:
            def __exit__(self, exc_type, exc, tb):
                calls.append((exc_type, exc, tb))

        browser_state = {
            'context': _Context(),
            'page': object(),
            '_ctx_mgr': _CtxMgr(),
        }

        _close_existing_context(browser_state)

        self.assertEqual(calls, [(None, None, None)])
        self.assertIsNone(browser_state['context'])
        self.assertIsNone(browser_state['page'])
        self.assertIsNone(browser_state['_ctx_mgr'])


if __name__ == "__main__":
    unittest.main()
