from pathlib import Path
import json
import tempfile
import os
import time
from typing import Optional

from python.core.persistence.atomic import atomic_write_json

# Adjust relative path if needed, or keep using absolute from root
STATE_FILE = Path("data/session_state.json")

def save_state(profile: str, action: str, progress: int):
    state = {
        "profile": profile,
        "action": action,
        "progress": progress,
        "timestamp": time.time()
    }
    atomic_write_json(STATE_FILE, state)

def load_state() -> Optional[dict]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding='utf-8'))
        except Exception:
            return None
    return None

def clear_state():
    if STATE_FILE.exists():
        try:
            STATE_FILE.unlink()
        except OSError:
            pass
