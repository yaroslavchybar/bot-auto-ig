import os
from typing import Callable, Iterable, List, Optional

from automation.browser import parse_proxy_string


def ensure_profile_path(profile_name: str) -> str:
    """Create and return profile directory path."""
    profile_path = os.path.join(os.getcwd(), "profiles", profile_name)
    os.makedirs(profile_path, exist_ok=True)
    return profile_path


def build_proxy_config(proxy_string: str):
    """Parse proxy string or return None."""
    if proxy_string and proxy_string.lower() not in ("none", ""):
        return parse_proxy_string(proxy_string)
    return None


def clean_usernames(usernames: Iterable[str]) -> List[str]:
    """Normalize username list (strip, remove @, drop empties)."""
    clean: List[str] = []
    for u in usernames:
        if not u:
            continue
        name = u.strip().lstrip("@")
        if name:
            clean.append(name)
    return clean


def call_on_success(
    on_success: Optional[Callable[[str], None]],
    username: str,
    log: Callable[[str], None],
):
    """Safe wrapper for on_success callbacks."""
    if not on_success:
        return
    try:
        on_success(username)
    except Exception as callback_err:
        log(f"⚠️ Не удалось обновить статус @{username}: {callback_err}")

