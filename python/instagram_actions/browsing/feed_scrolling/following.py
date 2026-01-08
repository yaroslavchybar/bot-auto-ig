from playwright.sync_api import Error as PlaywrightError
from python.internal_systems.error_handling.exceptions import ElementNotFoundError, BotException
from python.internal_systems.shared_utilities.selectors import FOLLOW_BUTTON

def perform_follow(page, post_element) -> bool:
    """Follow the user from a feed post."""
    try:
        btn = FOLLOW_BUTTON.find(post_element)
        if btn:
            btn.click()
            print("Followed user")
            return True
    except ElementNotFoundError:
        print(f"[!] Follow button not found")
    except (PlaywrightError, BotException) as e:
        print(f"[!] Error following: {type(e).__name__} - {e}")

    return False


