import logging

from camoufox import Camoufox
from camoufox.exceptions import InvalidProxy
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from python.actions import common as actions
from python.actions.browsing import scroll_feed, scroll_reels
from python.browser.context import create_browser_context
from python.browser.fingerprint_config import (
    _apply_cached_properties,
    _fingerprint_cache_path,
    _load_cached_fingerprint,
    _save_fingerprint_cache,
)
from python.browser.page_bootstrap import (
    _attach_error_snapshots,
    _safe_get,
    bootstrap_instagram_session,
    initialize_browser_page,
    safe_goto,
)
from python.browser.profile_paths import (
    _clean_cache2,
    _mark_cleaned_today,
    _read_text,
    _should_clean_today,
    _write_text,
    ensure_profile_path,
)
from python.browser.proxy import (
    ProxyCircuitBreaker,
    _proxy_health,
    build_proxy_config,
    is_proxy_healthy,
    mark_proxy_failure,
    mark_proxy_success,
    parse_proxy_string,
    proxy_circuit,
)
from python.browser.runtime import run_browser
from python.browser.session_state import _load_profile_cookies, sync_profile_session_state
from python.browser.traffic import TrafficMonitor
from python.core.errors.exceptions import AccountBannedException, ProxyError
from python.core.errors.retry import jitter, retry_with_backoff
from python.core.snapshot_debugger import save_debug_snapshot


logger = logging.getLogger(__name__)


def _preload_profile_cookies(context, profile_name: str) -> int:
    cookies = _load_profile_cookies(profile_name)
    if not cookies:
        return 0
    context.add_cookies(cookies)
    return len(cookies)
