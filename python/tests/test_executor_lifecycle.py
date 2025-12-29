"""Tests for ThreadPoolExecutor lifecycle (Phase 3: Async & Parallel)."""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import unittest
from unittest.mock import patch, MagicMock
from concurrent.futures import ThreadPoolExecutor


class TestExecutorLifecycle(unittest.TestCase):
    """Test cases for ThreadPoolExecutor lifecycle in InstagramAutomationRunner."""

    def test_executor_created_in_init(self):
        """Executor should be created once during __init__, not per-cycle."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SECRET_KEY": "test-key"
        }):
            import importlib
            import python.supabase.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.supabase.profiles_client.get_shared_session"):
                with patch("python.supabase.instagram_accounts_client.get_shared_session"):
                    from scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 2
                    
                    runner = InstagramAutomationRunner(mock_config, [MagicMock(), MagicMock()])
                    
                    self.assertIsInstance(runner._executor, ThreadPoolExecutor)
                    # Cleanup
                    runner._executor.shutdown(wait=False)

    def test_max_workers_respects_parallel_profiles(self):
        """Max workers should respect parallel_profiles config."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SECRET_KEY": "test-key"
        }):
            import importlib
            import python.supabase.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.supabase.profiles_client.get_shared_session"):
                with patch("python.supabase.instagram_accounts_client.get_shared_session"):
                    from scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 5
                    
                    accounts = [MagicMock() for _ in range(10)]
                    runner = InstagramAutomationRunner(mock_config, accounts)
                    
                    # Should be min(len(accounts), parallel_profiles) = 5
                    self.assertEqual(runner._max_workers, 5)
                    runner._executor.shutdown(wait=False)

    def test_max_workers_capped_by_account_count(self):
        """Max workers should not exceed account count."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SECRET_KEY": "test-key"
        }):
            import importlib
            import python.supabase.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.supabase.profiles_client.get_shared_session"):
                with patch("python.supabase.instagram_accounts_client.get_shared_session"):
                    from scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 10
                    
                    accounts = [MagicMock() for _ in range(3)]
                    runner = InstagramAutomationRunner(mock_config, accounts)
                    
                    # Should be min(3, 10) = 3
                    self.assertEqual(runner._max_workers, 3)
                    runner._executor.shutdown(wait=False)

    def test_stop_shuts_down_executor(self):
        """stop() should shutdown the executor."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SECRET_KEY": "test-key"
        }):
            import importlib
            import python.supabase.config as config_mod
            importlib.reload(config_mod)
            
            with patch("python.supabase.profiles_client.get_shared_session"):
                with patch("python.supabase.instagram_accounts_client.get_shared_session"):
                    from scripts.instagram_automation import InstagramAutomationRunner
                    from python.core.models import ScrollingConfig
                    
                    mock_config = MagicMock(spec=ScrollingConfig)
                    mock_config.parallel_profiles = 1
                    
                    runner = InstagramAutomationRunner(mock_config, [])
                    
                    # Mock the executor's shutdown
                    mock_shutdown = MagicMock()
                    runner._executor.shutdown = mock_shutdown
                    
                    runner.stop()
                    
                    self.assertFalse(runner.running)
                    mock_shutdown.assert_called()


if __name__ == "__main__":
    unittest.main()
