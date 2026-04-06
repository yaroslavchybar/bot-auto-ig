import asyncio
from pathlib import Path
from datetime import datetime
import logging
import re

from playwright.sync_api import Error as PlaywrightError

logger = logging.getLogger(__name__)

_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")

def _sanitize_snapshot_name(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return "snapshot"
    value = _SAFE_NAME_RE.sub("_", value).strip("._-")
    if not value:
        return "snapshot"
    return value[:120]

def _page_is_closed(page) -> bool:
    try:
        is_closed = getattr(page, 'is_closed', None)
        if callable(is_closed):
            result = is_closed()
            if isinstance(result, bool):
                return result
    except Exception:
        return True
    return False

def _is_closed_target_error(exc: BaseException) -> bool:
    if not isinstance(exc, PlaywrightError):
        return False
    message = str(exc).lower()
    return (
        'target page, context or browser has been closed' in message
        or 'browser has been closed' in message
    )

def save_debug_snapshot(page, element_name: str, base_dir: str = "data/debug"):
    """Save page state for post-mortem debugging."""
    if page is None or _page_is_closed(page):
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = _sanitize_snapshot_name(element_name)
    snapshot_dir = Path(base_dir) / f"{safe_name}_{timestamp}"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    
    # Save HTML
    try:
        (snapshot_dir / "page.html").write_text(page.content(), encoding="utf-8")
    except asyncio.CancelledError:
        logger.debug("Skipping HTML snapshot because the page request was cancelled during shutdown")
    except PlaywrightError as e:
        if _is_closed_target_error(e):
            logger.debug("Skipping HTML snapshot because the page is already closed")
        else:
            logger.error(f"Failed to save HTML snapshot: {e}")
    except Exception as e:
        logger.error(f"Failed to save HTML snapshot: {e}")
    
    # Save screenshot
    try:
        page.screenshot(path=str(snapshot_dir / "screenshot.png"))
    except asyncio.CancelledError:
        logger.debug("Skipping screenshot because the page request was cancelled during shutdown")
    except PlaywrightError as e:
        if _is_closed_target_error(e):
            logger.debug("Skipping screenshot because the page is already closed")
        else:
            logger.error(f"Failed to save screenshot: {e}")
    except Exception as e:
        logger.error(f"Failed to save screenshot: {e}")
    
    return snapshot_dir
