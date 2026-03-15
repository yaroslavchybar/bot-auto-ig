from typing import Any, Dict, List, Tuple

from python.actions.engagement.follow.common import normalize_range
from python.core.models import ScrollingConfig
from python.runners.workflow.parsing import _parse_float, _parse_int


def _build_config(settings: Dict[str, Any], message_texts: List[str]):
    payload = {
        'use_private_profiles': True,
        'use_threads_profiles': False,
        'action_order': _action_order(settings),
        'comment_chance': 0,
        'message_texts': message_texts,
        'headless': bool(settings.get('headless')),
        **_chance_settings(settings),
        **_duration_settings(settings),
        **_range_settings(settings),
        **_feature_flags(settings),
        **_cooldown_settings(settings),
    }
    return ScrollingConfig(**payload)


def _action_order(settings: Dict[str, Any]) -> List[str]:
    action_order = settings.get('action_order')
    if not isinstance(action_order, list):
        return []
    order: List[str] = []
    for action in action_order:
        if not action:
            continue
        action_name = str(action).strip()
        if action_name:
            order.append(action_name)
    return order


def _chance_settings(settings: Dict[str, Any]) -> Dict[str, int]:
    return {
        'like_chance': _parse_int(settings.get('like_chance'), 10),
        'follow_chance': _parse_int(settings.get('follow_chance'), 50),
        'reels_like_chance': _parse_int(settings.get('reels_like_chance'), 10),
        'reels_follow_chance': _parse_int(settings.get('reels_follow_chance'), 50),
        'reels_skip_chance': _parse_int(settings.get('reels_skip_chance'), 30),
        'carousel_watch_chance': _parse_int(settings.get('carousel_watch_chance'), 0),
        'carousel_max_slides': _parse_int(settings.get('carousel_max_slides'), 3),
        'stories_max': _parse_int(settings.get('stories_max'), 3),
        'likes_percentage': _parse_int(settings.get('likes_percentage'), 0),
        'scroll_percentage': _parse_int(settings.get('scroll_percentage'), 0),
        'following_limit': _parse_int(settings.get('following_limit'), 3000),
        'max_sessions_per_day': _parse_int(settings.get('max_sessions'), 5),
        'parallel_profiles': _parse_int(settings.get('parallel_profiles'), 1),
    }


def _duration_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    feed_range = _normalized_range(
        (
            settings.get('feed_min_time_minutes', settings.get('min_time_minutes')),
            settings.get('feed_max_time_minutes', settings.get('max_time_minutes')),
        ),
        (1, 3),
    )
    reels_range = _normalized_range(
        (settings.get('reels_min_time_minutes'), settings.get('reels_max_time_minutes')),
        (1, 3),
    )
    return {
        'min_time_minutes': feed_range[0],
        'max_time_minutes': feed_range[1],
        'feed_min_time_minutes': feed_range[0],
        'feed_max_time_minutes': feed_range[1],
        'reels_min_time_minutes': reels_range[0],
        'reels_max_time_minutes': reels_range[1],
        'reels_skip_min_time': _parse_float(settings.get('reels_skip_min_time'), 0.8),
        'reels_skip_max_time': _parse_float(settings.get('reels_skip_max_time'), 2.0),
        'reels_normal_min_time': _parse_float(settings.get('reels_normal_min_time'), 5.0),
        'reels_normal_max_time': _parse_float(settings.get('reels_normal_max_time'), 20.0),
    }


def _range_settings(settings: Dict[str, Any]) -> Dict[str, Tuple[int, int]]:
    return {
        'highlights_range': _normalized_range(
            (settings.get('highlights_min'), settings.get('highlights_max')),
            (2, 4),
        ),
        'follow_count_range': _normalized_range(
            (settings.get('follow_min_count'), settings.get('follow_max_count')),
            (5, 15),
        ),
        'unfollow_delay_range': _normalized_range(
            (settings.get('min_delay'), settings.get('max_delay')),
            (10, 30),
        ),
        'unfollow_count_range': _normalized_range(
            (settings.get('unfollow_min_count'), settings.get('unfollow_max_count')),
            (5, 15),
        ),
    }


def _feature_flags(settings: Dict[str, Any]) -> Dict[str, bool]:
    return {
        'enable_feed': bool(settings.get('enable_feed')),
        'enable_reels': bool(settings.get('enable_reels')),
        'enable_follow': bool(settings.get('enable_follow')),
        'enable_unfollow': bool(settings.get('do_unfollow')),
        'enable_approve': bool(settings.get('do_approve')),
        'enable_message': bool(settings.get('do_message')),
        'watch_stories': bool(settings.get('watch_stories')),
    }


def _cooldown_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'profile_reopen_cooldown_enabled': bool(settings.get('profile_reopen_cooldown_enabled', True)),
        'profile_reopen_cooldown_minutes': _parse_int(settings.get('profile_reopen_cooldown_minutes'), 30),
        'messaging_cooldown_enabled': bool(settings.get('messaging_cooldown_enabled', True)),
        'messaging_cooldown_hours': _parse_int(settings.get('messaging_cooldown_hours'), 2),
    }


def _normalized_range(values: Tuple[Any, Any], default: Tuple[int, int]) -> Tuple[int, int]:
    minimum = _parse_int(values[0], default[0])
    maximum = _parse_int(values[1], default[1])
    return normalize_range((minimum, maximum), default)
