import logging
import time
from contextlib import contextmanager
from typing import Optional

from camoufox import Camoufox
from camoufox.exceptions import InvalidProxy

from python.browser.fingerprint_config import load_or_generate_fingerprint_config
from python.browser.page_bootstrap import (
    bootstrap_instagram_session,
    initialize_browser_page,
)
from python.browser.profile_paths import (
    _clean_cache2,
    _should_clean_today,
    ensure_profile_path,
)
from python.browser.proxy import (
    build_proxy_config,
    is_proxy_healthy,
    proxy_circuit,
)
from python.browser.session_state import sync_profile_session_state
from python.core.errors.exceptions import ProxyError

logger = logging.getLogger(__name__)


@contextmanager
def create_browser_context(
    profile_name: str,
    proxy_string: Optional[str] = None,
    user_agent: Optional[str] = None,
    base_dir: Optional[str] = None,
    headless: bool = False,
    block_images: bool = False,
    os: Optional[str] = None,
    fingerprint_seed: Optional[str] = None,
    fingerprint_os: Optional[str] = None,
    display: Optional[str] = None,
):
    _wait_for_circuit_breaker()
    profile_path = ensure_profile_path(profile_name, base_dir=base_dir)
    should_clean = _should_clean_today(profile_path)
    _assert_proxy_is_healthy(proxy_string)
    launch_kwargs = _build_launch_kwargs(
        profile_path,
        proxy_string,
        user_agent,
        headless,
        block_images,
        os,
        fingerprint_seed,
        fingerprint_os,
        display,
    )
    cm = None
    context = None
    try:
        cm, context = _open_camoufox(launch_kwargs)
        page, monitor = initialize_browser_page(context, profile_name)
        bootstrap_instagram_session(page, monitor, profile_name, proxy_string)
        _sync_session_state(context, profile_name)
        yield context, page
    finally:
        _close_context_manager(cm, context, profile_name)
        _schedule_cache_cleanup(should_clean, profile_path)


def _wait_for_circuit_breaker() -> None:
    if not proxy_circuit.is_open():
        return
    wait_time = max(0.0, proxy_circuit.global_pause_until - time.time())
    logger.warning('Circuit breaker open. Waiting %.1fs...', wait_time)
    time.sleep(wait_time)


def _assert_proxy_is_healthy(proxy_string: Optional[str]) -> None:
    if proxy_string and not is_proxy_healthy(proxy_string):
        logger.warning('Proxy %s is tainted. Skipping...', proxy_string)
        raise ProxyError(f'Proxy {proxy_string} is currently tainted due to previous failures.')


def _build_launch_kwargs(
    profile_path: str,
    proxy_string: Optional[str],
    user_agent: Optional[str],
    headless: bool,
    block_images: bool,
    os_name: Optional[str],
    fingerprint_seed: Optional[str],
    fingerprint_os: Optional[str],
    display: Optional[str],
) -> dict:
    proxy_config = build_proxy_config(proxy_string)
    target_os = fingerprint_os or os_name or 'windows'
    cached_config = load_or_generate_fingerprint_config(profile_path, fingerprint_seed, target_os)
    launch_kwargs = {
        'headless': headless,
        'user_data_dir': profile_path,
        'persistent_context': True,
        'proxy': proxy_config,
        'block_images': block_images,
        'os': target_os,
        'humanize': True,
        'locale': 'en-US',
    }
    if display:
        import os as _os

        launch_kwargs['env'] = {**_os.environ, 'DISPLAY': str(display)}
    if cached_config:
        launch_kwargs['config'] = dict(cached_config)
        launch_kwargs['i_know_what_im_doing'] = True
    elif user_agent:
        launch_kwargs['user_agent'] = user_agent
    return launch_kwargs


def _open_camoufox(launch_kwargs: dict):
    """Open a Camoufox browser context using the context manager protocol."""
    try:
        cm = Camoufox(geoip=True, **launch_kwargs)
        return cm, cm.__enter__()
    except InvalidProxy:
        if not launch_kwargs.get('proxy'):
            raise
        logger.warning('Proxy GeoIP check failed. Retrying with geoip=False...')
        cm = Camoufox(geoip=False, **launch_kwargs)
        return cm, cm.__enter__()


def _sync_session_state(context, profile_name: str) -> None:
    try:
        if context:
            sync_profile_session_state(
                context,
                profile_name,
                explicit_logout=bool(
                    getattr(context, 'explicit_logout', False)
                    or getattr(context, '_explicit_logout', False)
                ),
            )
    except Exception:
        return


def _close_context_manager(cm, context, profile_name: str) -> None:
    if not cm:
        return
    try:
        if context:
            try:
                _sync_session_state(context, profile_name)
            except Exception:
                pass
            finally:
                try:
                    context.close()
                except Exception:
                    pass
        cm.__exit__(None, None, None)
    except Exception:
        return


def _schedule_cache_cleanup(should_clean: bool, profile_path: str) -> None:
    if not should_clean:
        return
    try:
        _clean_cache2(profile_path)
    except Exception:
        return
