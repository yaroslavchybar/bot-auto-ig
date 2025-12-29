def perform_like(page, post_element) -> bool:
    """Like a feed post, skipping if already liked."""
    try:
        # Skip if already liked
        if post_element.query_selector('svg[aria-label="Unlike"]'):
            return False

        like_button = post_element.query_selector('svg[aria-label="Like"]')
        if like_button:
            clickable = like_button.query_selector('xpath=..')
            if clickable:
                clickable.click()
                print("Liked post")
                return True
    except Exception as e:
        print(f"[!] Error liking post: {e}")

    return False


