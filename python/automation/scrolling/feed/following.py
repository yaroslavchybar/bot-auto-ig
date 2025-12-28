def perform_follow(page, post_element) -> bool:
    """Follow the user from a feed post."""
    try:
        btn = post_element.query_selector(
            'button:has-text("Follow"), div[role="button"]:has-text("Follow")'
        )
        if btn:
            btn.click()
            print("[➕] Followed user")
            return True
    except Exception as e:
        print(f"[!] Error following: {e}")

    return False


