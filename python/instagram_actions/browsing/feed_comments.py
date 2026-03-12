import re


_RESERVED_PROFILE_SEGMENTS = {
    "accounts",
    "explore",
    "p",
    "reel",
    "reels",
    "stories",
    "direct",
}


def looks_like_reply_expander(label: str) -> bool:
    cleaned = str(label or "").strip().lower()
    if not cleaned:
        return False
    if "repl" not in cleaned:
        return False
    return cleaned.startswith(("view ", "read ", "show "))


def looks_like_profile_href(href: str) -> bool:
    cleaned = str(href or "").strip()
    if not cleaned or not cleaned.startswith("/") or cleaned.startswith("http"):
        return False
    if "?" in cleaned or "#" in cleaned:
        cleaned = cleaned.split("?", 1)[0].split("#", 1)[0]

    match = re.fullmatch(r"/([A-Za-z0-9._]+)/", cleaned)
    if not match:
        return False

    segment = match.group(1).lower()
    return segment not in _RESERVED_PROFILE_SEGMENTS
