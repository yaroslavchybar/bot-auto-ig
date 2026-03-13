import time
from contextlib import contextmanager
from typing import Optional

from camoufox.exceptions import InvalidProxy

from python.browser.compat import compat as compat_module
from python.browser.fingerprint_config import load_or_generate_fingerprint_config
from python.core.errors.exceptions import ProxyError


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
    compat = compat_module()
    _wait_for_circuit_breaker(compat)
    profile_path = compat.ensure_profile_path(profile_name, base_dir=base_dir)
    should_clean = compat._should_clean_today(profile_path)
    _assert_proxy_is_healthy(compat, proxy_string)
    launch_kwargs = _build_launch_kwargs(
        compat,
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
        cm, context = _enter_camoufox_context(compat, launch_kwargs)
        page, monitor = compat.initialize_browser_page(context, profile_name)
        compat.bootstrap_instagram_session(page, monitor, profile_name, proxy_string)
        _sync_session_state(compat, context, profile_name)
        yield context, page
    finally:
        _close_context_manager(compat, cm, context, profile_name)
        _schedule_cache_cleanup(compat, should_clean, profile_path)


def _wait_for_circuit_breaker(compat) -> None:
    if not compat.proxy_circuit.is_open():
        return
    wait_time = max(0.0, compat.proxy_circuit.global_pause_until - time.time())
    print(f'[!] Circuit breaker open. Waiting {wait_time:.1f}s...')
    time.sleep(wait_time)


def _assert_proxy_is_healthy(compat, proxy_string: Optional[str]) -> None:
    if proxy_string and not compat.is_proxy_healthy(proxy_string):
        print(f'[!] Proxy {proxy_string} is tainted. Skipping...')
        raise ProxyError(f'Proxy {proxy_string} is currently tainted due to previous failures.')


def _build_launch_kwargs(
    compat,
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
    proxy_config = compat.build_proxy_config(proxy_string)
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


def _enter_camoufox_context(compat, launch_kwargs: dict):
    try:
        cm = compat.Camoufox(geoip=True, **launch_kwargs)
        return cm, cm.__enter__()
    except InvalidProxy:
        if not launch_kwargs.get('proxy'):
            raise
        print('[!] Proxy GeoIP check failed. Retrying with geoip=False...')
        cm = compat.Camoufox(geoip=False, **launch_kwargs)
        return cm, cm.__enter__()


def _sync_session_state(compat, context, profile_name: str) -> None:
    try:
        if context:
            compat.sync_profile_session_state(
                context,
                profile_name,
                explicit_logout=bool(
                    getattr(context, 'explicit_logout', False)
                    or getattr(context, '_explicit_logout', False)
                ),
            )
    except Exception:
        return


def _close_context_manager(compat, cm, context, profile_name: str) -> None:
    if not cm:
        return
    try:
        if context:
            try:
                _sync_session_state(compat, context, profile_name)
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


def _schedule_cache_cleanup(compat, should_clean: bool, profile_path: str) -> None:
    if not should_clean:
        return
    try:
        compat._clean_cache2(profile_path)
    except Exception:
        return
