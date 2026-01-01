"""Tests for I/O optimizations (Phase 4: Buffered Logging & Background Cleanup)."""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import unittest
from unittest.mock import patch, MagicMock
import logging
from logging.handlers import MemoryHandler


class TestBufferedLogging(unittest.TestCase):
    """Test cases for buffered logging in instagram_automation.py."""

    def test_logger_uses_memory_handler(self):
        """Logger should use MemoryHandler for buffered output."""
        from scripts.instagram_automation import _logger
        
        has_memory_handler = any(
            isinstance(h, MemoryHandler) for h in _logger.handlers
        )
        self.assertTrue(has_memory_handler, "Logger should have a MemoryHandler")

    def test_memory_handler_has_capacity(self):
        """MemoryHandler should buffer messages (capacity > 1)."""
        from scripts.instagram_automation import _log_memory_handler
        
        self.assertIsInstance(_log_memory_handler, MemoryHandler)
        self.assertGreater(_log_memory_handler.capacity, 1)

    def test_log_function_uses_logger(self):
        """log() function should route messages through the logger."""
        from scripts.instagram_automation import log, _logger
        
        with patch.object(_logger, "log") as mock_log:
            log("test message")
            mock_log.assert_called()

    def test_log_function_detects_errors(self):
        """log() should use ERROR level for error messages."""
        from scripts.instagram_automation import log, _logger
        
        with patch.object(_logger, "log") as mock_log:
            log("Ошибка: something failed")
            call_args = mock_log.call_args
            level = call_args[0][0]
            self.assertEqual(level, logging.ERROR)


class TestBackgroundCacheCleanup(unittest.TestCase):
    """Test cases for background cache cleanup in browser.py."""

    def test_cache_cleanup_runs_in_thread(self):
        """_clean_cache2 should be called in a background thread."""
        events = []

        class FakePage:
            def __init__(self):
                self.url = "about:blank"

            def goto(self, *_args, **_kwargs):
                return None

            def on(self, *_args, **_kwargs):
                pass

        class FakeContext:
            def __init__(self):
                self.pages = [FakePage()]

            def close(self):
                events.append("close")

        class FakeCamoufox:
            def __init__(self, *_args, **_kwargs):
                self._context = FakeContext()

            def __enter__(self):
                return self._context

            def __exit__(self, *_args, **_kwargs):
                return None

        def thread_ctor(*_args, **_kwargs):
            self.assertIn("close", events)
            events.append("thread")
            thread_obj = MagicMock()
            thread_obj.start = MagicMock()
            return thread_obj

        with patch("python.automation.browser.ensure_profile_path", return_value="/fake/profile"):
            with patch("python.automation.browser._should_clean_today", return_value=True):
                with patch("python.automation.browser.Camoufox", FakeCamoufox):
                    with patch("python.automation.browser.Thread", side_effect=thread_ctor) as MockThread:
                        from python.automation.browser import create_browser_context

                        with create_browser_context(profile_name="p") as (_context, _page):
                            pass

                        self.assertGreaterEqual(MockThread.call_count, 1)
                        self.assertEqual(events[0], "close")

    def test_should_clean_today_logic(self):
        """_should_clean_today should return True if not cleaned today."""
        with patch("python.automation.browser._read_text", return_value="2020-01-01"):
            from python.automation.browser import _should_clean_today
            
            # Since today is not 2020-01-01, should return True
            result = _should_clean_today("/fake/path")
            self.assertTrue(result)

    def test_should_clean_today_returns_false_if_cleaned(self):
        """_should_clean_today should return False if already cleaned today."""
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).date().isoformat()
        
        with patch("python.automation.browser._read_text", return_value=today):
            from python.automation.browser import _should_clean_today
            
            result = _should_clean_today("/fake/path")
            self.assertFalse(result)


class TestProxyParsing(unittest.TestCase):
    def test_user_pass_at_host_port_emits_credentials_fields(self):
        from python.automation.browser import parse_proxy_string

        cfg = parse_proxy_string("http://user:pass@host:8080")
        self.assertIsInstance(cfg, dict)
        self.assertEqual(cfg.get("server"), "http://host:8080")
        self.assertEqual(cfg.get("username"), "user")
        self.assertEqual(cfg.get("password"), "pass")


if __name__ == "__main__":
    unittest.main()
