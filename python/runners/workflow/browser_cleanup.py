import time
from typing import Any, Dict, Optional

from python.browser.session_state import sync_profile_session_state
from python.runners.workflow.io import log

_COOKIE_SYNC_RETRY_DELAY_SECONDS = 0.25
_CTX_MGR_CLOSE_COMPLETE_ATTR = '_workflow_close_complete'


def close_browser_state(runner, browser_state: Dict[str, Any]) -> None:
    ctx_mgr = browser_state.get('_ctx_mgr')
    context = browser_state.get('context')
    profile_name = str(browser_state.get('profile_name') or '').strip()

    close_browser_resource(
        runner,
        ctx_mgr=ctx_mgr,
        context=context,
        profile_name=profile_name,
    )

    browser_state['context'] = None
    browser_state['page'] = None
    browser_state['_ctx_mgr'] = None


def close_tracked_browser_entry(runner, entry: Dict[str, Any]) -> None:
    close_browser_resource(
        runner,
        ctx_mgr=entry.get('ctx_mgr'),
        context=entry.get('context'),
        profile_name=str(entry.get('profile_name') or '').strip(),
    )


def close_browser_resource(
    runner,
    *,
    ctx_mgr: Any = None,
    context: Any = None,
    profile_name: str = '',
) -> None:
    if ctx_mgr and _is_close_complete(ctx_mgr):
        return

    if ctx_mgr and runner is not None:
        try:
            runner.unregister_browser_context(ctx_mgr)
        except Exception:
            pass

    _sync_cookies_before_close(context, profile_name)

    try:
        if ctx_mgr:
            ctx_mgr.__exit__(None, None, None)
        elif context:
            context.close()
    except Exception:
        pass
    finally:
        if ctx_mgr:
            _mark_close_complete(ctx_mgr)


def _sync_cookies_before_close(context: Any, profile_name: str) -> bool:
    cleaned_profile = str(profile_name or '').strip()
    if not context or not cleaned_profile:
        if cleaned_profile:
            log(f'Cookie sync skipped for @{cleaned_profile} before browser close: no active browser context.')
        return True

    if _context_is_closed(context):
        log(f'Cookie sync skipped for @{cleaned_profile} before browser close: browser context is already closed.')
        return True

    explicit_logout = _explicit_logout(context)
    messages: list[str] = []
    ok = sync_profile_session_state(
        context,
        cleaned_profile,
        log=messages.append,
        explicit_logout=explicit_logout,
    )
    _emit_cookie_sync_messages(cleaned_profile, messages)
    if ok:
        if not messages:
            log(f'Cookie sync completed for @{cleaned_profile} before browser close.')
        return True

    log(f'Cookie sync failed for @{cleaned_profile} before browser close; retrying once...')
    time.sleep(_COOKIE_SYNC_RETRY_DELAY_SECONDS)

    retry_messages: list[str] = []
    ok = sync_profile_session_state(
        context,
        cleaned_profile,
        log=retry_messages.append,
        explicit_logout=explicit_logout,
    )
    _emit_cookie_sync_messages(cleaned_profile, retry_messages, retry=True)
    if ok:
        if not retry_messages:
            log(f'Cookie sync completed for @{cleaned_profile} before browser close on retry.')
        return True

    log(f'Cookie sync failed for @{cleaned_profile} before browser close; continuing with browser shutdown.')
    return False


def _context_is_closed(context: Any) -> bool:
    try:
        is_closed = getattr(context, 'is_closed', None)
        if callable(is_closed):
            result = is_closed()
            if isinstance(result, bool):
                return result
    except Exception:
        return True
    return False


def _explicit_logout(context: Any) -> bool:
    return bool(
        getattr(context, 'explicit_logout', False)
        or getattr(context, '_explicit_logout', False)
    )


def _is_close_complete(ctx_mgr: Any) -> bool:
    value = getattr(ctx_mgr, _CTX_MGR_CLOSE_COMPLETE_ATTR, False)
    return value if isinstance(value, bool) else False


def _mark_close_complete(ctx_mgr: Any) -> None:
    try:
        setattr(ctx_mgr, _CTX_MGR_CLOSE_COMPLETE_ATTR, True)
    except Exception:
        pass


def _emit_cookie_sync_messages(profile_name: str, messages: list[str], *, retry: bool = False) -> None:
    suffix = ' on retry' if retry else ''
    for message in messages:
        cleaned = str(message or '').strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if cleaned.startswith(('INFO ', 'WARN ', 'WARNING ', 'ERROR ')):
            log(cleaned)
            continue
        if lowered.startswith('saved browser cookies'):
            log(f'Cookie sync saved latest cookies for @{profile_name} before browser close{suffix}.')
            continue
        if lowered.startswith('cleared browser session state'):
            log(f'Cookie sync cleared stored session for @{profile_name} before browser close{suffix}.')
            continue
        if lowered.startswith('skipped saving browser session state'):
            log(f'Cookie sync skipped for @{profile_name} before browser close{suffix}: no authenticated Instagram session was available.')
            continue
        if lowered.startswith('failed saving browser cookies'):
            log(f'WARN Cookie sync failed for @{profile_name} before browser close{suffix}: {cleaned}')
            continue
        log(cleaned)
