import random
import time
import functools
import logging
from typing import Tuple, Type

logger = logging.getLogger(__name__)

def jitter(base_ms: int, variance: float = 0.3) -> int:
    """Add random jitter to a timeout value."""
    delta = int(base_ms * variance)
    return base_ms + random.randint(-delta, delta)

def calculate_sleep_time(attempt: int, base_delay: float = 1.0, backoff_factor: float = 2.0, jitter_range: float = 0.5) -> float:
    """
    Calculate sleep time with exponential backoff and jitter.
    
    Args:
        attempt: Current attempt number (0-based)
        base_delay: Initial delay in seconds
        backoff_factor: Multiplier for each attempt
        jitter_range: Random jitter to add (0 to value)
    """
    delay = base_delay * (backoff_factor ** attempt)
    return delay + random.uniform(0, jitter_range)

def retry_with_backoff(
    max_retries: int = 3,
    initial_delay: float = 1.0,
    exceptions: Tuple[Type[Exception], ...] = (TimeoutError, ConnectionError),
):
    """Decorator that retries with exponential backoff."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt < max_retries:
                        sleep_time = calculate_sleep_time(attempt, initial_delay)
                        logger.warning(f"Retry {attempt + 1}/{max_retries} after {sleep_time:.1f}s: {e}")
                        time.sleep(sleep_time)
                    else:
                        raise
            
            if last_exception:
                raise last_exception
        return wrapper
    return decorator
