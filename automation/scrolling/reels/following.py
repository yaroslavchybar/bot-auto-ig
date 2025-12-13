from automation.actions import random_delay


def _is_follow_button(btn) -> bool:
    try:
        label = (btn.inner_text() or "").strip().lower()
        if label == "follow":
            return True
        aria = (btn.get_attribute("aria-label") or "").lower()
        return "follow" in aria and "following" not in aria and "requested" not in aria
    except Exception:
        return False


def perform_follow(page) -> bool:
    """Follow the user from the current reel."""
    try:
        selectors = [
            # Prefer exact-text follow controls in the header
            'xpath=//div[@role="button" and normalize-space()="Follow"]',
            'xpath=//button[normalize-space()="Follow"]',
            'div[role="button"][tabindex]:has-text("Follow")',
            'button:has-text("Follow")',
            # Fallbacks with aria-label
            'div[aria-label*="Follow"]',
            'button[aria-label*="Follow"]',
        ]

        for selector in selectors:
            buttons = page.query_selector_all(selector)
            if not buttons:
                continue

            for _ in range(3):
                target_btn = None
                for btn in buttons:
                    if btn.is_visible() and _is_follow_button(btn):
                        target_btn = btn
                        break

                if not target_btn:
                    break

                try:
                    # Try a direct click first to avoid bubbling into the reel surface
                    try:
                        target_btn.click(force=True)
                    except Exception:
                        box = target_btn.bounding_box()
                        if box:
                            target_x = box["x"] + box["width"] / 2
                            target_y = box["y"] + box["height"] / 2
                            page.mouse.move(target_x, target_y, steps=10)
                            page.mouse.click(target_x, target_y)
                        else:
                            target_btn.click()

                    print("[➕] Followed user from reel")
                    return True
                except Exception as click_err:
                    # Element may detach or be covered; retry with a fresh handle
                    print(f"[!] Follow click retry: {click_err}")
                    random_delay(0.2, 0.6)
                    # Re-query on next loop to avoid stale handles
                    buttons = page.query_selector_all(selector)
                    continue
    except Exception as e:
        print(f"[!] Error following user from reel: {e}")

    return False


