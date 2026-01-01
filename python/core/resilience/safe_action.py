import functools
import logging

logger = logging.getLogger(__name__)

def safe_action(action_name: str, continue_on_error: bool = True):
    """Wrap an action to catch non-fatal errors."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.warning(f"Action '{action_name}' failed: {e}")
                if not continue_on_error:
                    raise
                return None
        return wrapper
    return decorator
