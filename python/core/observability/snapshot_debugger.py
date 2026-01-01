from pathlib import Path
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

def save_debug_snapshot(page, element_name: str, base_dir: str = "debug"):
    """Save page state for post-mortem debugging."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    snapshot_dir = Path(base_dir) / f"{element_name}_{timestamp}"
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
