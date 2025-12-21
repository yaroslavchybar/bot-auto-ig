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
    reels_skip_chance: int = 30  # 0-100%
    reels_skip_min_time: float = 0.8
    reels_skip_max_time: float = 2.0
    reels_normal_min_time: float = 5.0
    reels_normal_max_time: float = 20.0
    enable_feed: bool = True
    enable_reels: bool = False
    enable_follow: bool = False
    enable_unfollow: bool = False
    enable_approve: bool = False
    enable_message: bool = False
    carousel_watch_chance: int = 0  # 0-100%
    carousel_max_slides: int = 3
    watch_stories: bool = True
    stories_max: int = 3
    
    # Follow Config
    highlights_range: Optional[tuple] = None
    likes_percentage: int = 0
    scroll_percentage: int = 0
    following_limit: Optional[int] = None
    follow_count_range: Optional[tuple] = None
    
    # Unfollow/Approve/Message Config
    unfollow_delay_range: Optional[tuple] = None
    message_texts: Optional[List[str]] = None
    action_order: Optional[List[str]] = None
