def perform_like(page) -> bool:
    """Like the current reel."""
    try:
        like_btns = page.query_selector_all('svg[aria-label="Like"]')
        for btn in like_btns:
            if btn.is_visible():
                clickable = btn.query_selector('xpath=..')
                if clickable:
                    clickable.click()
                    print("[♥] Liked reel")
                    return True
    except Exception as e:
        print(f"[!] Error liking reel: {e}")

    return False


