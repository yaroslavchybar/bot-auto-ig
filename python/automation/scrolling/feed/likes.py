from playwright.sync_api import Error as PlaywrightError
from python.core.resilience.exceptions import ElementNotFoundError, BotException
from python.core.automation.selectors import LIKE_BUTTON

def perform_like(page, post_element) -> bool:
    """Like a feed post, skipping if already liked."""
    try:
        # Skip if already liked
        if post_element.query_selector('svg[aria-label="Unlike"]'):
            return False

        like_button = LIKE_BUTTON.find(post_element)
        if like_button:
            clickable = like_button.query_selector('xpath=..')
            if clickable:
                clickable.click()
                print("Liked post")
                return True
    except ElementNotFoundError:
        print(f"[!] Like button not found")
    except (PlaywrightError, BotException) as e:
        print(f"[!] Error liking post: {type(e).__name__} - {e}")
    
    return False


