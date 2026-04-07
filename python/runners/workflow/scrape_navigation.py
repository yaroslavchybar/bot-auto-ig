"""Navigation helpers for scrape_relationships: opening relationship views and fetching chunks."""

from typing import Any, Dict, Optional, Tuple

from python.runners.workflow.io import log
from python.runners.workflow.scrape_script import RELATIONSHIP_CHUNK_SCRIPT

RELATIONSHIP_CLICK_TIMEOUT_MS = 5000
RELATIONSHIP_OPEN_RETRY_DELAYS_MS = (400, 1200, 2500)


def open_relationship_view(
    runner,
    page: Any,
    *,
    target_username: str,
    kind: str,
) -> Optional[Tuple[str, str]]:
    normalized_target = str(target_username or '').strip().strip('/').lower()
    log(f'scrape_relationships @{normalized_target}: opening {kind} list')
    attempt_count = len(RELATIONSHIP_OPEN_RETRY_DELAYS_MS) + 1
    click_error: Optional[Exception] = None
    ui_error: Optional[Tuple[str, str]] = None

    for attempt_index in range(attempt_count):
        if attempt_index > 0:
            delay_ms = RELATIONSHIP_OPEN_RETRY_DELAYS_MS[attempt_index - 1]
            log(
                f'scrape_relationships @{normalized_target}: retrying {kind} open '
                f'(attempt {attempt_index + 1}/{attempt_count}, delay={delay_ms}ms)'
            )
            page.wait_for_timeout(delay_ms)

        clicked_selector, click_error = _click_relationship_link(page, normalized_target, kind)
        if not clicked_selector:
            ui_error = None
            continue

        ui_error = _wait_for_relationship_ui(page, normalized_target, kind)
        if ui_error is None:
            return None

    if click_error is not None:
        return _relationship_link_error(normalized_target, kind, click_error)
    return ui_error or _relationship_link_error(normalized_target, kind, None)


def _click_relationship_link(page: Any, normalized_target: str, kind: str) -> Tuple[Optional[str], Optional[Exception]]:
    clicked_selector, click_error = _click_via_selector(page, normalized_target, kind)
    if clicked_selector:
        return clicked_selector, None
    return _click_via_locators(page, kind, click_error)


def _click_via_selector(page: Any, normalized_target: str, kind: str) -> Tuple[Optional[str], Optional[Exception]]:
    selectors = [
        f'a[href="/{normalized_target}/{kind}/"]',
        f'a[href="/{normalized_target}/{kind}"]',
        f'a[href$="/{kind}/"]',
        f'a[href$="/{kind}"]',
        f'a[href*="/{kind}/"]',
        f'a[href*="/{kind}"]',
    ]
    try:
        clicked_selector = page.evaluate(
            """
            ({ selectors }) => {
              for (const selector of selectors) {
                const el = document.querySelector(selector)
                if (el instanceof HTMLElement) {
                  el.click()
                  return selector
                }
              }
              return null
            }
            """,
            {'selectors': selectors},
        )
        return clicked_selector, None
    except Exception as exc:
        return None, exc


def _click_via_locators(page: Any, kind: str, click_error: Optional[Exception]) -> Tuple[Optional[str], Optional[Exception]]:
    label = 'Followers' if kind == 'followers' else 'Following'
    locators = [
        ('role link', page.get_by_role('link', name=label, exact=True).first),
        ('header link', page.locator('header a', has_text=label).first),
        ('header section link', page.locator('header section a', has_text=label).first),
        ('text link', page.locator('a', has_text=label).first),
    ]
    for description, locator in locators:
        try:
            locator.click(timeout=RELATIONSHIP_CLICK_TIMEOUT_MS)
            return description, None
        except Exception as exc:
            click_error = exc
    return None, click_error


def _relationship_link_error(
    normalized_target: str,
    kind: str,
    click_error: Optional[Exception],
) -> Tuple[str, str]:
    if click_error is not None:
        log(
            f'scrape_relationships @{normalized_target}: failed to resolve {kind} link '
            f'via in-page click: {click_error}'
        )
    return (
        'relationship_link_not_found',
        f'Could not find {kind} link on @{normalized_target}',
    )


def _wait_for_relationship_ui(
    page: Any,
    normalized_target: str,
    kind: str,
) -> Optional[Tuple[str, str]]:
    try:
        page.wait_for_function(
            r"""
            ({ targetUsername, kind }) => {
              const normalizedPath = String(window.location.pathname || '')
                .toLowerCase()
                .replace(/\/+$/, '/')
              if (normalizedPath.includes(`/${targetUsername}/${kind}/`)) {
                return true
              }
              if (normalizedPath.endsWith(`/${kind}/`) || normalizedPath.includes(`/${kind}/`)) {
                return true
              }
              return Boolean(document.querySelector('div[role="dialog"]'))
            }
            """,
            arg={'targetUsername': normalized_target, 'kind': kind},
            timeout=7000,
        )
        log(f'scrape_relationships @{normalized_target}: {kind} UI opened')
        return None
    except Exception as exc:
        return (
            'relationship_open_failed',
            f'Failed to open {kind} list for @{normalized_target}: {exc}',
        )


def scrape_relationship_chunk(
    runner,
    page: Any,
    *,
    target_username: str,
    kind: str,
    cursor: Optional[str],
    chunk_limit: int,
    max_pages: int,
) -> Dict[str, Any]:
    return page.evaluate(
        RELATIONSHIP_CHUNK_SCRIPT,
        {
            'targetUsername': target_username,
            'kind': kind,
            'cursor': cursor,
            'chunkLimit': chunk_limit,
            'maxPages': max_pages,
        },
    )
