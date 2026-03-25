import logging

from playwright.sync_api import Error as PlaywrightError
from python.core.errors.exceptions import ElementNotFoundError, BotException
from python.core.selectors import FOLLOW_BUTTON

logger = logging.getLogger(__name__)


def perform_follow(page, post_element) -> bool:
    """Follow the user from a feed post."""
    try:
        btn = FOLLOW_BUTTON.find(post_element)
        if btn:
            btn.click()
            logger.info("Followed user")
            return True
    except ElementNotFoundError:
        logger.warning("Follow button not found")
    except (PlaywrightError, BotException) as e:
        logger.error("Error following: %s - %s", type(e).__name__, e)

    return False


