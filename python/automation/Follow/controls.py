def _is_in_suggested(btn, max_depth: int = 6) -> bool:
    """Heuristically detect if button is inside 'Suggested for you' carousel."""
    try:
        parent = btn
        for _ in range(max_depth):
            parent = parent.parent_element()
            if not parent:
                break
            text = (parent.inner_text() or "").lower()
            if "suggested for you" in text:
                return True
    except Exception:
        pass
    return False


import time

def find_follow_control(page):
    """
    Find a follow-related button and classify its state.
    Returns tuple (state, element) where state in {"follow", "requested", "following", None}
    Skips buttons inside "Suggested for you".
    """
    priority_candidates = [
        ("follow", [
            "header button:has-text(\"Follow\")",
            "main header button:has-text(\"Follow\")",
            "header div[role=\"button\"]:has-text(\"Follow\")",
            "main header div[role=\"button\"]:has-text(\"Follow\")",
            "header button:has-text(\"Follow Back\")",
            "main header button:has-text(\"Follow Back\")",
            "header div[role=\"button\"]:has-text(\"Follow Back\")",
            "main header div[role=\"button\"]:has-text(\"Follow Back\")",
            "header button:has-text(\"Подписаться\")",
            "main header button:has-text(\"Подписаться\")",
            "header div[role=\"button\"]:has-text(\"Подписаться\")",
            "main header div[role=\"button\"]:has-text(\"Подписаться\")",
        ]),
        ("requested", [
            "header button:has-text(\"Requested\")",
            "main header button:has-text(\"Requested\")",
            "header div[role=\"button\"]:has-text(\"Requested\")",
            "main header div[role=\"button\"]:has-text(\"Requested\")",
        ]),
        ("following", [
            "header button:has-text(\"Following\")",
            "main header button:has-text(\"Following\")",
            "header div[role=\"button\"]:has-text(\"Following\")",
            "main header div[role=\"button\"]:has-text(\"Following\")",
        ]),
    ]

    fallback_candidates = [
        ("follow", [
            'xpath=//button[normalize-space()="Follow"]',
            'xpath=//div[@role="button" and normalize-space()="Follow"]',
            'button:has-text("Follow")',
            'div[role="button"]:has-text("Follow")',
            'button[aria-label*="Follow"]',
            'div[aria-label*="Follow"]',
            'button:has-text("Follow Back")',
            'div[role="button"]:has-text("Follow Back")',
            'xpath=//button[normalize-space()="Follow Back"]',
            'xpath=//div[@role="button" and normalize-space()="Follow Back"]',
            'button:has-text("Подписаться")',
            'div[role="button"]:has-text("Подписаться")',
            'xpath=//button[normalize-space()="Подписаться"]',
            'xpath=//div[@role="button" and normalize-space()="Подписаться"]',
        ]),
        ("requested", [
            'button:has-text("Requested")',
            'div[role="button"]:has-text("Requested")',
            'xpath=//button[normalize-space()="Requested"]',
            'xpath=//div[@role="button" and normalize-space()="Requested"]',
        ]),
        ("following", [
            'button:has-text("Following")',
            'div[role="button"]:has-text("Following")',
            'xpath=//button[normalize-space()="Following"]',
            'xpath=//div[@role="button" and normalize-space()="Following"]',
        ]),
    ]

    def search(candidates):
        for state, selectors in candidates:
            for selector in selectors:
                try:
                    buttons = page.query_selector_all(selector)
                except Exception:
                    continue
                for btn in buttons:
                    try:
                        if _is_in_suggested(btn):
                            continue
                        label = (btn.inner_text() or "").lower()
                        aria = (btn.get_attribute("aria-label") or "").lower()
                        if state == "follow":
                            if "following" in label or "requested" in label:
                                continue
                            if "following" in aria or "requested" in aria:
                                continue
                        return state, btn
                    except Exception:
                        continue
        return None, None

    state, btn = search(priority_candidates)
    if state and btn:
        return state, btn
    return search(fallback_candidates)

def wait_for_follow_state(page, timeout_ms: int = 8000):
    deadline = time.time() + (timeout_ms / 1000.0)
    while time.time() < deadline:
        try:
            state, _ = find_follow_control(page)
            if state in ("requested", "following"):
                return state
        except Exception:
            pass
        try:
            page.wait_for_selector('header button:has-text("Following"), main header button:has-text("Following"), header div[role="button"]:has-text("Following"), main header div[role="button"]:has-text("Following")', timeout=250)
            return "following"
        except Exception:
            pass
        try:
            page.wait_for_selector('header button:has-text("Requested"), main header button:has-text("Requested"), header div[role="button"]:has-text("Requested"), main header div[role="button"]:has-text("Requested")', timeout=250)
            return "requested"
        except Exception:
            pass
        time.sleep(0.25)
    return None
