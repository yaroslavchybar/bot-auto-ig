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

