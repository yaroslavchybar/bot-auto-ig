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
        import python.supabase.shared_session as ss
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


class TestProfilesClientSharedSession(unittest.TestCase):
    """Test that profiles_client.py uses shared session."""

    def test_profiles_client_uses_shared_session(self):
        """SupabaseProfilesClient should use get_shared_session()."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SECRET_KEY": "test-key"
        }):
            # Reset config cache
            import importlib
            import python.supabase.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.supabase.profiles_client.get_shared_session") as mock_get:
                mock_session = MagicMock()
                mock_get.return_value = mock_session
                
                from python.supabase.profiles_client import SupabaseProfilesClient
                client = SupabaseProfilesClient()
                
                mock_get.assert_called_once()
                self.assertEqual(client.session, mock_session)


class TestInstagramAccountsClientSharedSession(unittest.TestCase):
    """Test that instagram_accounts_client.py uses shared session."""

    def test_instagram_accounts_client_uses_shared_session(self):
        """InstagramAccountsClient should use get_shared_session()."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SECRET_KEY": "test-key"
        }):
            import importlib
            import python.supabase.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.supabase.instagram_accounts_client.get_shared_session") as mock_get:
                mock_session = MagicMock()
                mock_get.return_value = mock_session
                
                from python.supabase.instagram_accounts_client import InstagramAccountsClient
                client = InstagramAccountsClient()
                
                mock_get.assert_called_once()
                self.assertEqual(client.session, mock_session)


if __name__ == "__main__":
    unittest.main()
