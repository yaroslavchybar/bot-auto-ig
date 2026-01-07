"""Tests for profile caching (Phase 2: Caching Layer)."""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import unittest
from unittest.mock import patch, MagicMock
import threading


class TestProfileCaching(unittest.TestCase):
    """Test cases for profile caching in InstagramAutomationRunner."""

    def test_profile_cache_initialized(self):
        """Runner should initialize empty profile cache."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            import importlib
            import python.convex.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.convex.profiles_client.ResilientHttpClient"):
                with patch("python.convex.instagram_accounts_client.ResilientHttpClient"):
                    from python.scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.domain.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 1
                    mock_config.max_sessions_per_day = 5
                    
                    runner = InstagramAutomationRunner(mock_config, [])
                    
                    self.assertIsInstance(runner._profile_cache, dict)
                    self.assertEqual(len(runner._profile_cache), 0)

    def test_profile_cache_lock_exists(self):
        """Runner should have a lock for thread-safe cache access."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            import importlib
            import python.convex.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.convex.profiles_client.ResilientHttpClient"):
                with patch("python.convex.instagram_accounts_client.ResilientHttpClient"):
                    from python.scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.domain.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 1
                    
                    runner = InstagramAutomationRunner(mock_config, [])
                    
                    self.assertIsInstance(runner._profile_cache_lock, type(threading.Lock()))

    def test_get_cached_profile_returns_none_for_missing(self):
        """_get_cached_profile should return None for non-existent profiles."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            import importlib
            import python.convex.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.convex.profiles_client.ResilientHttpClient"):
                with patch("python.convex.instagram_accounts_client.ResilientHttpClient"):
                    from python.scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.domain.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 1
                    
                    runner = InstagramAutomationRunner(mock_config, [])
                    
                    result = runner._get_cached_profile("nonexistent")
                    self.assertIsNone(result)

    def test_set_and_get_cached_profile(self):
        """_set_cached_profile and _get_cached_profile should work together."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            import importlib
            import python.convex.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.convex.profiles_client.ResilientHttpClient"):
                with patch("python.convex.instagram_accounts_client.ResilientHttpClient"):
                    from python.scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.domain.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 1
                    
                    runner = InstagramAutomationRunner(mock_config, [])
                    
                    profile_data = {"profile_id": "123", "name": "test_user"}
                    runner._set_cached_profile("test_user", profile_data)
                    
                    result = runner._get_cached_profile("test_user")
                    self.assertEqual(result, profile_data)


class TestGetAvailableProfiles(unittest.TestCase):
    """Test cases for get_available_profiles method (SQL-level filtering)."""

    def test_get_available_profiles_empty_list_ids(self):
        """Should return empty list for empty list_ids."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            import importlib
            import python.convex.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.convex.profiles_client.ResilientHttpClient"):
                from python.convex.profiles_client import ProfilesClient
                client = ProfilesClient()
                
                result = client.get_available_profiles([], 5, 30)
                self.assertEqual(result, [])

    def test_get_available_profiles_builds_correct_params(self):
        """Should build payload for Convex available profiles endpoint."""
        with patch.dict(os.environ, {
            "CONVEX_URL": "https://test.convex.site",
            "CONVEX_API_KEY": "test-key"
        }):
            import importlib
            import python.convex.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.convex.profiles_client.ResilientHttpClient"):
                from python.convex.profiles_client import ProfilesClient
                client = ProfilesClient()
                
                with patch.object(client, "_make_request") as mock_req:
                    mock_req.return_value = []
                    client.get_available_profiles(["list1", "list2"], 5, 30)
                    
                    mock_req.assert_called_once()
                    call_args = mock_req.call_args
                    self.assertGreaterEqual(len(call_args.args), 2)
                    self.assertEqual(call_args.args[0], "POST")
                    self.assertEqual(call_args.args[1], "/available")

                    data = call_args.kwargs.get("data", {})
                    self.assertEqual(data.get("list_ids"), ["list1", "list2"])
                    self.assertEqual(data.get("max_sessions"), 5)
                    self.assertEqual(data.get("cooldown_minutes"), 30)


if __name__ == "__main__":
    unittest.main()
