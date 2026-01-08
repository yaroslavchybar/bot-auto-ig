import json
import time
from pathlib import Path
from typing import Optional

from python.internal_systems.storage.atomic import atomic_write_json

CACHE_FILE = Path("data/selector_cache.json")

def load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text())
        except Exception:
            return {}
    return {}

def save_cache(cache: dict):
    atomic_write_json(CACHE_FILE, cache)

def record_success(element_name: str, strategy: str):
    cache = load_cache()
    cache[element_name] = {"strategy": strategy, "timestamp": time.time()}
    save_cache(cache)

def get_preferred_strategy(element_name: str) -> Optional[str]:
    cache = load_cache()
    return cache.get(element_name, {}).get("strategy")
