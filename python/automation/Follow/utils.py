from typing import Callable, Iterable, List, Optional


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
        log(f"Не удалось обновить статус @{username}: {callback_err}")
