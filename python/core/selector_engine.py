import logging
from typing import Optional

from playwright.sync_api import Locator

from python.core.storage.selector_cache import get_preferred_strategy, record_success

logger = logging.getLogger(__name__)

_ACTIONABLE_SCAN_LIMIT = 8
_DEFAULT_TEXT_FALLBACK_QUERY = (
    'button, a, input, textarea, select, label, '
    '[role="button"], [role="link"], [tabindex], [contenteditable="true"]'
)


def find_semantic_selector(selector, page, *, save_debug_snapshot_fn=None) -> Optional[Locator]:
    preferred = get_preferred_strategy(selector.element_name)
    strategies = _strategy_order(preferred)
    try:
        result = _run_strategies(selector, page, strategies, preferred)
        if result:
            return result
        return _text_fallback(selector, page)
    except Exception as exc:
        logger.warning(f'Selector search failed for {selector.element_name}: {exc}')
        _save_selector_snapshot(page, selector.element_name, save_debug_snapshot_fn)
        return None


def _strategy_order(preferred: Optional[str]) -> list[str]:
    strategies = ['role', 'text', 'label', 'css']
    if preferred and preferred in strategies:
        strategies.remove(preferred)
        strategies.insert(0, preferred)
    return strategies


def _run_strategies(selector, page, strategies: list[str], preferred: Optional[str]) -> Optional[Locator]:
    for strategy in strategies:
        result = _run_single_strategy(selector, page, strategy)
        if not result:
            continue
        if strategy != preferred:
            record_success(selector.element_name, strategy)
        return result
    return None


def _run_single_strategy(selector, page, strategy: str) -> Optional[Locator]:
    locator = _strategy_locator(selector, page, strategy)
    if strategy != 'role':
        locator = _apply_role_constraint(selector, locator)
    return _first_actionable(locator)


def _strategy_locator(selector, page, strategy: str):
    if strategy == 'role' and selector.role:
        name_filter = selector.label or selector.text
        return page.get_by_role(selector.role, name=name_filter) if name_filter else page.get_by_role(selector.role)
    if strategy == 'text' and selector.text:
        return page.get_by_text(selector.text, exact=False)
    if strategy == 'label' and selector.label:
        return page.get_by_label(selector.label)
    if strategy == 'css' and selector.css_fallback:
        return page.locator(selector.css_fallback)
    return None


def _first_actionable(locator: Optional[Locator], *, limit: int = _ACTIONABLE_SCAN_LIMIT) -> Optional[Locator]:
    if not locator:
        return None
    try:
        count = locator.count()
    except Exception:
        return None
    for index in range(min(count, limit)):
        candidate = locator.nth(index)
        try:
            if candidate.is_visible() and candidate.is_enabled():
                return candidate
        except Exception:
            continue
    return None


def _apply_role_constraint(selector, locator: Optional[Locator]) -> Optional[Locator]:
    if not locator or not selector.role:
        return locator
    if selector.role == 'button':
        xpath = 'xpath=ancestor-or-self::*[self::button or @role="button"][1]'
    elif selector.role == 'link':
        xpath = 'xpath=ancestor-or-self::*[self::a or @role="link"][1]'
    else:
        xpath = f'xpath=ancestor-or-self::*[@role="{selector.role}"][1]'
    return locator.locator(xpath)


def _text_fallback_query(selector) -> str:
    if selector.role == 'button':
        return 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
    if selector.role == 'link':
        return 'a, [role="link"]'
    if selector.role:
        return f'[role="{selector.role}"]'
    return _DEFAULT_TEXT_FALLBACK_QUERY


def _text_fallback(selector, page) -> Optional[Locator]:
    if not selector.text:
        return None
    locator = page.locator(_text_fallback_query(selector)).filter(has_text=selector.text)
    result = _first_actionable(locator)
    if result:
        logger.info(f'Discovered {selector.element_name} via text fallback')
        return result
    return None


def _save_selector_snapshot(page, element_name: str, save_debug_snapshot_fn) -> None:
    if save_debug_snapshot_fn is None:
        return
    try:
        save_debug_snapshot_fn(page, f'selector_fail_{element_name}')
    except Exception as snapshot_error:
        logger.error(f'Failed to save debug snapshot: {snapshot_error}')
