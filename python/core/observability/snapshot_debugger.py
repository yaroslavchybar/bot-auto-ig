from pathlib import Path
from datetime import datetime
import logging
import re

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

def save_debug_snapshot(page, element_name: str, base_dir: str = "data/debug"):
    """Save page state for post-mortem debugging."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = _sanitize_snapshot_name(element_name)
    snapshot_dir = Path(base_dir) / f"{safe_name}_{timestamp}"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    
    # Save HTML
    try:
        (snapshot_dir / "page.html").write_text(page.content(), encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to save HTML snapshot: {e}")
    
    # Save screenshot
    try:
        page.screenshot(path=str(snapshot_dir / "screenshot.png"))
    except Exception as e:
        logger.error(f"Failed to save screenshot: {e}")
    
    return snapshot_dir
