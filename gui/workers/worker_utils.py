"""
Shared utilities for Instagram worker classes.
Reduces code duplication across worker implementations.
"""
import os
import random
import signal
import subprocess
from typing import Tuple, Optional, List, Callable, Any
from contextlib import contextmanager

from automation.browser import create_browser_context as _create_browser_context

# Windows process handling constants
CTRL_BREAK = getattr(signal, "CTRL_BREAK_EVENT", None)
IS_WINDOWS = os.name == "nt"


def kill_process_tree(proc, log: Callable[[str], None]) -> None:
    """Best-effort kill for subprocess and its children on Windows."""
    if proc is None or proc.poll() is not None:
        return

    if IS_WINDOWS:
        if CTRL_BREAK is not None:
            try:
                proc.send_signal(CTRL_BREAK)
                proc.wait(timeout=5)
            except Exception as err:
                log(f"⚠️ CTRL_BREAK to child failed: {err}")

        if proc.poll() is None:
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                proc.wait(timeout=3)
            except Exception as err:
                log(f"⚠️ taskkill failed: {err}")
    else:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception as err:
            log(f"⚠️ terminate failed: {err}")

    if proc.poll() is None:
        try:
            proc.kill()
        except Exception:
            pass


@contextmanager
def create_browser_context(
    profile_name: str,
    proxy_string: Optional[str] = None,
    user_agent: Optional[str] = None,
    base_dir: Optional[str] = None,
):
    """
    Create a Camoufox browser context with standard configuration.
    
    Args:
        profile_name: Profile name for the user data directory
        proxy_string: Optional proxy string (format: protocol://user:pass@host:port)
        user_agent: Optional custom user agent
        base_dir: Base directory for profiles (defaults to cwd)
    
    Yields:
        Tuple of (context, page)
    """
    with _create_browser_context(
        profile_name=profile_name,
        proxy_string=proxy_string,
        user_agent=user_agent,
        base_dir=base_dir,
    ) as (context, page):
        yield context, page


def normalize_range(range_values: Optional[Tuple], default: Tuple[int, int]) -> Tuple[int, int]:
    """
    Normalize a range tuple, ensuring low <= high and non-negative values.
    
    Args:
        range_values: Tuple of (min, max) or None
        default: Default tuple if range_values is invalid
    
    Returns:
        Normalized (min, max) tuple
    """
    try:
        low, high = range_values
        low = max(0, int(low))
        high = max(0, int(high))
        if low > high:
            low, high = high, low
        return low, high
    except Exception:
        return default


def apply_count_limit(
    items: List[Any],
    count_range: Optional[Tuple[int, int]],
    shuffle: bool = True
) -> List[Any]:
    """
    Apply a random count limit to a list of items.
    
    Args:
        items: List of items to limit
        count_range: Optional (min, max) count range
        shuffle: Whether to shuffle before limiting
    
    Returns:
        Limited list (may be empty if count is 0)
    """
    if not count_range or not isinstance(count_range, tuple):
        return items
    
    try:
        cmin, cmax = count_range
        cmin = int(cmin)
        cmax = int(cmax)
    except Exception:
        return items
    
    if cmin > cmax:
        cmin, cmax = cmax, cmin
    
    if cmax <= 0:
        return items
    
    count = random.randint(max(0, cmin), cmax)
    if count <= 0:
        return []
    
    result = list(items)
    if shuffle:
        random.shuffle(result)
    return result[:count]


def create_status_callback(
    client,
    account_map: dict,
    log: Callable[[str], None],
    status: str,
    assigned_to: Optional[str] = None,
    clear_assigned: bool = False,
    success_message: str = "💾 Status @{username} updated to '{status}'.",
    error_message: str = "⚠️ Failed to update status for @{username}: {error}"
) -> Callable[[str], None]:
    """
    Create a callback function for updating account status on success/skip.
    
    Args:
        client: InstagramAccountsClient instance
        account_map: Dict mapping username to account ID
        log: Logging function
        status: Status to set (e.g., 'sunscribed', 'skiped', 'done')
        assigned_to: Value to set for assigned_to field
        clear_assigned: If True, set assigned_to to None
        success_message: Message template on success (supports {username}, {status})
        error_message: Message template on error (supports {username}, {error})
    
    Returns:
        Callback function that takes a username string
    """
    def callback(username: str):
        account_id = account_map.get(username)
        if not account_id:
            return
        try:
            kwargs = {"status": status}
            if clear_assigned:
                kwargs["assigned_to"] = None
            elif assigned_to is not None:
                kwargs["assigned_to"] = assigned_to
            
            client.update_account_status(account_id, **kwargs)
            log(success_message.format(username=username, status=status))
        except Exception as err:
            log(error_message.format(username=username, error=err))
    
    return callback


def get_action_enabled_map(config) -> dict:
    """
    Create a dictionary mapping action names to their enabled state.
    
    Args:
        config: ScrollingConfig instance
    
    Returns:
        Dict mapping action name to enabled boolean
    """
    return {
        "Feed Scroll": config.enable_feed,
        "Reels Scroll": config.enable_reels,
        "Watch Stories": config.watch_stories,
        "Follow": config.enable_follow,
        "Unfollow": config.enable_unfollow,
        "Approve Requests": config.enable_approve,
        "Send Messages": config.enable_message,
    }


def build_action_order(config) -> List[str]:
    """
    Build the action order list based on config, using provided order or defaults.
    
    Args:
        config: ScrollingConfig instance
    
    Returns:
        Ordered list of action names to execute
    """
    if config.action_order:
        order = list(config.action_order)
        # Ensure Watch Stories is included if enabled but not in order
        if config.watch_stories and "Watch Stories" not in order:
            order.append("Watch Stories")
        return order
    
    # Default order based on enabled flags
    order = []
    if config.enable_feed:
        order.append("Feed Scroll")
    if config.enable_reels:
        order.append("Reels Scroll")
    if config.watch_stories:
        order.append("Watch Stories")
    if config.enable_follow:
        order.append("Follow")
    if config.enable_unfollow:
        order.append("Unfollow")
    if config.enable_approve:
        order.append("Approve Requests")
    if config.enable_message:
        order.append("Send Messages")
    
    return order
