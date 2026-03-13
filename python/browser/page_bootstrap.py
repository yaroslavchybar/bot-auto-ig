import time
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from python.browser.compat import compat as compat_module
from python.core.errors.exceptions import AccountBannedException
from python.core.errors.retry import jitter, retry_with_backoff
from python.core.snapshot_debugger import save_debug_snapshot


@retry_with_backoff(exceptions=(PlaywrightTimeoutError,))
def safe_goto(page, url, timeout=None):
    return page.goto(url, timeout=timeout)


def _safe_get(value, default=None):
    try:
        return value() if callable(value) else value
    except Exception:
        return default


def _attach_error_snapshots(page, base_dir: str = 'data/debug'):
    state = {'window_start': time.time(), 'count': 0, 'last_by_key': {}}

    def should_capture(key: str) -> bool:
        now = time.time()
        if now - state['window_start'] >= 60:
            state['window_start'] = now
            state['count'] = 0
            state['last_by_key'].clear()
        if state['last_by_key'].get(key) is not None and now - state['last_by_key'][key] < 5:
            return False
        if state['count'] >= 10:
            return False
        state['count'] += 1
        state['last_by_key'][key] = now
        return True

    def capture(event_type: str, detail: str | None = None) -> None:
        name = f'browser_{event_type}' if not detail else f'browser_{event_type}_{(detail or "").strip()}'
        if not should_capture(event_type):
            return
        try:
            save_debug_snapshot(page, name, base_dir=base_dir)
        except Exception:
            return

    try:
        page.on('pageerror', lambda exc: capture('pageerror', str(exc)[:120]))
        page.on('crash', lambda _value: capture('crash'))
        page.on('requestfailed', lambda request: _capture_request_failed(request, capture))
        page.on('console', lambda msg: _capture_console_error(msg, capture))
    except Exception:
        return


def _capture_request_failed(request, capture) -> None:
    try:
        resource_type = _safe_get(getattr(request, 'resource_type', None), '') or ''
        if resource_type.lower() in {'image', 'media', 'font', 'stylesheet'}:
            return
    except Exception:
        pass
    url = _safe_get(getattr(request, 'url', None), '') or ''
    capture('requestfailed', url.split('?', 1)[0][-120:])


def _capture_console_error(msg, capture) -> None:
    msg_type = (_safe_get(getattr(msg, 'type', None), '') or '').lower()
    if msg_type != 'error':
        return
    text = _safe_get(getattr(msg, 'text', None), '') or ''
    lowered = text.lower()
    ignored = {
        'content-security-policy',
        'blocked an inline script',
        'cookie',
        'rejected for invalid domain',
        'cross-origin request blocked',
        'same origin policy',
        'access-control-allow-origin',
    }
    important = {
        'referenceerror',
        'typeerror',
        'syntaxerror',
        'rangeerror',
        'ebdeps is not initialized',
        'uncaught',
    }
    if any(item in lowered for item in ignored):
        return
    if any(item in lowered for item in important):
        capture('console', text[:120])


def initialize_browser_page(context, profile_name: str):
    compat = compat_module()
    try:
        loaded_count = compat._preload_profile_cookies(context, profile_name)
        if loaded_count:
            print(f'[*] Preloaded {loaded_count} cookies from database for {profile_name}')
    except Exception as exc:
        compat.logger.warning('Cookie preload failed for %s: %s', profile_name, exc)

    page = context.pages[0] if context.pages else context.new_page()
    monitor = compat.TrafficMonitor()
    page.on('response', monitor.on_response)
    compat._attach_error_snapshots(page)
    compat.actions.seed_mouse_cursor(page)
    return page, monitor


def bootstrap_instagram_session(page, monitor, profile_name: str, proxy_string: str | None):
    compat = compat_module()
    try:
        if page.url == 'about:blank':
            compat.safe_goto(page, 'https://www.instagram.com', timeout=jitter(45000))
            _wait_for_monitor_cooldown(monitor)
            _raise_if_account_banned(page)
        compat.mark_proxy_success(proxy_string)
        compat.proxy_circuit.record_success()
    except PlaywrightTimeoutError:
        print('[!] Timeout navigating to Instagram')
        compat.mark_proxy_failure(proxy_string)
        compat.proxy_circuit.record_failure()
    except AccountBannedException:
        raise
    except Exception as exc:
        print(f'[!] Error navigating to Instagram: {exc}')
        compat.mark_proxy_failure(proxy_string)
        compat.proxy_circuit.record_failure()


def _wait_for_monitor_cooldown(monitor) -> None:
    if not monitor.should_pause():
        return
    wait_time = max(0.0, monitor.cooldown_until - time.time())
    print(f'[!] Traffic monitor triggered cooldown. Waiting {wait_time:.1f}s...')
    time.sleep(wait_time)


def _raise_if_account_banned(page: Any) -> None:
    try:
        content = page.content().lower()
        if 'account has been disabled' in content or 'account suspended' in content:
            raise AccountBannedException('Account appears to be banned/suspended')
    except AccountBannedException:
        raise
    except Exception:
        return
