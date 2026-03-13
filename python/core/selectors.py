from dataclasses import dataclass
import logging
from typing import Optional

from playwright.sync_api import Locator

from python.core.selector_engine import find_semantic_selector
from python.core.snapshot_debugger import save_debug_snapshot

logger = logging.getLogger(__name__)


@dataclass
class SemanticSelector:
    """Multi-strategy selector with semantic-first fallback."""

    element_name: str
    role: Optional[str] = None
    label: Optional[str] = None
    text: Optional[str] = None
    css_fallback: Optional[str] = None

    def find(self, page) -> Optional[Locator]:
        return find_semantic_selector(self, page, save_debug_snapshot_fn=save_debug_snapshot)


HOME_BUTTON = SemanticSelector(
    element_name='Home Button',
    role='link',
    label='Home',
    css_fallback='svg[aria-label="Home"]',
)

SEARCH_BUTTON = SemanticSelector(
    element_name='Search Button',
    role='link',
    label='Search',
    css_fallback='svg[aria-label="Search"]',
)

NOTIFICATIONS_BUTTON = SemanticSelector(
    element_name='Notifications',
    role='link',
    label='Notifications',
    css_fallback='svg[aria-label="Notifications"]',
)

LIKE_BUTTON = SemanticSelector(
    element_name='Like Button',
    role='button',
    label='Like',
    css_fallback='svg[aria-label="Like"]',
)

UNLIKE_BUTTON = SemanticSelector(
    element_name='Unlike Button',
    role='button',
    label='Unlike',
    css_fallback='svg[aria-label="Unlike"]',
)

FOLLOW_BACK_BUTTON = SemanticSelector(
    element_name='Follow Back Button',
    role='button',
    text='Follow Back',
    css_fallback='button:has-text("Follow Back")',
)

FOLLOW_BUTTON = SemanticSelector(
    element_name='Follow Button',
    role='button',
    text='Follow',
    css_fallback='button:has-text("Follow"):not(:has-text("Following"))',
)

FOLLOWING_BUTTON = SemanticSelector(
    element_name='Following Button',
    role='button',
    text='Following',
    css_fallback='button:has-text("Following")',
)

REQUESTED_BUTTON = SemanticSelector(
    element_name='Requested Button',
    role='button',
    text='Requested',
    css_fallback='button:has-text("Requested")',
)

UNFOLLOW_CONFIRM_BUTTON = SemanticSelector(
    element_name='Unfollow Confirm',
    role='button',
    text='Unfollow',
    css_fallback='button:has-text("Unfollow")',
)

MESSAGE_BUTTON = SemanticSelector(
    element_name='Message Button',
    role='button',
    text='Message',
    css_fallback='div[role="button"]:has-text("Message")',
)

SEND_MESSAGE_BUTTON = SemanticSelector(
    element_name='Send Message',
    role='button',
    text='Send',
    css_fallback='div[role="button"]:has-text("Send")',
)

NOT_NOW_BUTTON = SemanticSelector(
    element_name='Not Now',
    role='button',
    text='Not Now',
    css_fallback='button:has-text("Not Now")',
)

LOGIN_BUTTON = SemanticSelector(
    element_name='Log In',
    role='button',
    text='Log in',
    css_fallback='button[type="submit"]',
)

NEXT_CAROUSEL = SemanticSelector(
    element_name='Next Slide',
    role='button',
    label='Next',
    css_fallback='button[aria-label="Next"]',
)
