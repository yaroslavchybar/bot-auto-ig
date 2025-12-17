"""
Data models for automation configuration
"""
from dataclasses import dataclass
from typing import Optional, List


@dataclass
class ThreadsAccount:
    """Represents an Account with credentials"""
    username: str
    password: str
    proxy: Optional[str] = None
    
    @classmethod
    def from_string(cls, account_str: str):
        """Parse account from string format: username:password"""
        parts = account_str.strip().split(':')
        if len(parts) >= 2:
            return cls(username=parts[0], password=parts[1])
        raise ValueError(f"Invalid account format: {account_str}")


@dataclass
class ScrollingConfig:
    """Configuration for scrolling automation"""
    use_private_profiles: bool
    use_threads_profiles: bool
    like_chance: int  # 0-100%
    comment_chance: int  # 0-100%
    follow_chance: int  # 0-100%
    reels_like_chance: int  # 0-100%
    reels_follow_chance: int  # 0-100%
    min_time_minutes: int  # Legacy - kept for compatibility
    max_time_minutes: int  # Legacy - kept for compatibility
    feed_min_time_minutes: int
    feed_max_time_minutes: int
    reels_min_time_minutes: int
    reels_max_time_minutes: int
    cycle_interval_minutes: int
    enable_feed: bool = True
    enable_reels: bool = False
    carousel_watch_chance: int = 0  # 0-100%
    carousel_max_slides: int = 3
    watch_stories: bool = True
    stories_max: int = 3
