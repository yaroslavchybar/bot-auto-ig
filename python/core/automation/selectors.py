from dataclasses import dataclass
from typing import Callable, Optional
from playwright.sync_api import Locator
import logging
from python.core.observability.snapshot_debugger import save_debug_snapshot
from python.core.persistence.selector_cache import get_preferred_strategy, record_success

logger = logging.getLogger(__name__)

@dataclass
class SemanticSelector:
    """Multi-strategy selector with semantic-first fallback."""
    element_name: str
    role: Optional[str] = None       # get_by_role
    label: Optional[str] = None      # get_by_label  
    text: Optional[str] = None       # get_by_text
    css_fallback: Optional[str] = None  # Last resort
    
    def find(self, page) -> Optional[Locator]:
        """Try semantic locators first, fall back to CSS."""
        preferred = get_preferred_strategy(self.element_name)

        def first_actionable(locator: Optional[Locator]) -> Optional[Locator]:
            if not locator:
                return None
            try:
                count = locator.count()
            except Exception:
                return None

            limit = min(count, 8)
            for i in range(limit):
                candidate = locator.nth(i)
                try:
                    if candidate.is_visible() and candidate.is_enabled():
                        return candidate
                except Exception:
                    continue
            return None

        def apply_role_constraint(locator: Optional[Locator]) -> Optional[Locator]:
            if not locator or not self.role:
                return locator

            if self.role == "button":
                xpath = 'xpath=ancestor-or-self::*[self::button or @role="button"][1]'
            elif self.role == "link":
                xpath = 'xpath=ancestor-or-self::*[self::a or @role="link"][1]'
            else:
                xpath = f'xpath=ancestor-or-self::*[@role="{self.role}"][1]'

            return locator.locator(xpath)
        
        # Helper to execute a strategy
        def try_strategy(strategy: str) -> Optional[Locator]:
            locator = None
            if strategy == "role" and self.role:
                # If both role and label/text are provided, use name filter
                name_filter = self.label or self.text
                if name_filter:
                    locator = page.get_by_role(self.role, name=name_filter)
                else:
                    locator = page.get_by_role(self.role)
            elif strategy == "text" and self.text:
                locator = page.get_by_text(self.text, exact=False)
            elif strategy == "label" and self.label:
                locator = page.get_by_label(self.label)
            elif strategy == "css" and self.css_fallback:
                locator = page.locator(self.css_fallback)

            if strategy != "role":
                locator = apply_role_constraint(locator)
            
            return first_actionable(locator)

        # Order of execution
        strategies = ["role", "text", "label", "css"]
        if preferred and preferred in strategies:
            strategies.remove(preferred)
            strategies.insert(0, preferred)
            
        try:
            for strategy in strategies:
                result = try_strategy(strategy)
                if result:
                    if strategy != preferred:
                         record_success(self.element_name, strategy)
                    return result
            
            # Final fallback: Text-based discovery
            if self.text:
                 # Try partial text match for resilience to markup changes
                 for candidate in page.locator(f"*:has-text('{self.text}')").all():
                     constrained = apply_role_constraint(candidate)
                     result = first_actionable(constrained)
                     if result:
                         logger.info(f"Discovered {self.element_name} via text fallback")
                         return result

        except Exception as e:
            logger.warning(f"Selector search failed for {self.element_name}: {e}")
            try:
                save_debug_snapshot(page, f"selector_fail_{self.element_name}")
            except Exception as snapshot_error:
                logger.error(f"Failed to save debug snapshot: {snapshot_error}")
            
        return None

# --- Semantic Definitions ---

# Navigation
HOME_BUTTON = SemanticSelector(
    element_name="Home Button",
    role="link",
    label="Home",
    css_fallback='svg[aria-label="Home"]'
)

SEARCH_BUTTON = SemanticSelector(
    element_name="Search Button",
    role="link",
    label="Search",
    css_fallback='svg[aria-label="Search"]'
)

NOTIFICATIONS_BUTTON = SemanticSelector(
    element_name="Notifications",
    role="link",
    label="Notifications",
    css_fallback='svg[aria-label="Notifications"]'
)

# Interactions
LIKE_BUTTON = SemanticSelector(
    element_name="Like Button",
    role="button",
    label="Like",
    css_fallback='svg[aria-label="Like"]'
)

UNLIKE_BUTTON = SemanticSelector(
    element_name="Unlike Button",
    role="button",
    label="Unlike",
    css_fallback='svg[aria-label="Unlike"]'
)

# Follow / Unfollow
FOLLOW_BACK_BUTTON = SemanticSelector(
    element_name="Follow Back Button",
    role="button",
    text="Follow Back",
    css_fallback='button:has-text("Follow Back")'
)

FOLLOW_BUTTON = SemanticSelector(
    element_name="Follow Button",
    role="button",
    text="Follow",
    css_fallback='button:has-text("Follow"):not(:has-text("Following"))'
)

FOLLOWING_BUTTON = SemanticSelector(
    element_name="Following Button",
    role="button",
    text="Following",
    css_fallback='button:has-text("Following")'
)

REQUESTED_BUTTON = SemanticSelector(
    element_name="Requested Button",
    role="button",
    text="Requested",
    css_fallback='button:has-text("Requested")'
)

UNFOLLOW_CONFIRM_BUTTON = SemanticSelector(
    element_name="Unfollow Confirm",
    role="button",
    text="Unfollow",
    css_fallback='button:has-text("Unfollow")' # Often in modal
)

# Messaging
MESSAGE_BUTTON = SemanticSelector(
    element_name="Message Button",
    role="button",
    text="Message",
    css_fallback='div[role="button"]:has-text("Message")'
)

SEND_MESSAGE_BUTTON = SemanticSelector(
    element_name="Send Message",
    role="button",
    text="Send",
    css_fallback='div[role="button"]:has-text("Send")'
)

NOT_NOW_BUTTON = SemanticSelector(
    element_name="Not Now",
    role="button",
    text="Not Now",
    css_fallback='button:has-text("Not Now")'
)

# Login
LOGIN_BUTTON = SemanticSelector(
    element_name="Log In",
    role="button",
    text="Log in",
    css_fallback='button[type="submit"]'
)

# Carousel
NEXT_CAROUSEL = SemanticSelector(
    element_name="Next Slide",
    role="button",
    label="Next",
    css_fallback='button[aria-label="Next"]'
)
