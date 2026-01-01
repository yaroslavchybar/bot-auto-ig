from typing import Callable, Optional


def extract_username_from_confirm_button(confirm_button, log: Callable[[str], None]) -> Optional[str]:
    try:
        row = confirm_button.locator(
            'xpath=ancestor::*[.//div[@role="button" and normalize-space()="Delete"] and .//a[@role="link" and starts-with(@href, "/")]][1]'
        ).first

        if not row.is_visible():
            log("Skipping row without Delete button (Suggested for you?)")
            return None

        link = row.locator('xpath=.//a[@role="link" and starts-with(@href, "/")][1]').first
        href = link.get_attribute("href") if link.is_visible() else None
        if not href:
            return None

        href = href.strip()
        parts = [p for p in href.split("/") if p]
        if not parts:
            return None

        return parts[0]
    except Exception as e:
        log(f"Extraction error: {e}")
        return None

