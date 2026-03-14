import random
from typing import Any, Dict, List, Optional

from python.actions.engagement.follow.types import FollowInteractionsConfig
from python.runners.multi_account.compat import compat as compat_module


def run_scrolling(runner, page, mode: str) -> None:
    compat = compat_module()
    try:
        duration = _scroll_duration(runner, mode)
        if duration <= 0:
            return
        config = _scroll_config(runner.config, mode)
        if mode == 'feed':
            compat.log(f'Feed: {duration} min')
            compat.scroll_feed(page, duration, config, should_stop=lambda: not runner.running)
            return
        compat.log(f'Reels: {duration} min')
        compat.scroll_reels(page, duration, config, should_stop=lambda: not runner.running)
    except Exception as exc:
        compat.log(f'Scrolling error: {exc}')


def _scroll_duration(runner, mode: str) -> int:
    compat = compat_module()
    if mode == 'feed' and runner.config.enable_feed:
        low, high = compat.normalize_range(
            (runner.config.feed_min_time_minutes, runner.config.feed_max_time_minutes),
            (0, 0),
        )
        return random.randint(low, high)
    if mode == 'reels' and runner.config.enable_reels:
        low, high = compat.normalize_range(
            (runner.config.reels_min_time_minutes, runner.config.reels_max_time_minutes),
            (0, 0),
        )
        return random.randint(low, high)
    return 0


def _scroll_config(config, mode: str) -> Dict[str, Any]:
    return {
        'like_chance': config.like_chance if mode == 'feed' else config.reels_like_chance,
        'comment_chance': config.comment_chance,
        'follow_chance': config.follow_chance if mode == 'feed' else config.reels_follow_chance,
        'reels_skip_chance': config.reels_skip_chance,
        'reels_skip_min_time': config.reels_skip_min_time,
        'reels_skip_max_time': config.reels_skip_max_time,
        'reels_normal_min_time': config.reels_normal_min_time,
        'reels_normal_max_time': config.reels_normal_max_time,
        'carousel_watch_chance': config.carousel_watch_chance,
        'carousel_max_slides': config.carousel_max_slides,
        'watch_stories': config.watch_stories,
        'stories_max': config.stories_max,
    }


def run_stories(runner, page) -> None:
    compat = compat_module()
    try:
        max_stories = runner.config.stories_max if isinstance(runner.config.stories_max, int) else 3
        compat.log(f'Stories (max {max_stories})')
        compat.watch_stories(page, max_stories=max_stories, log=compat.log)
    except Exception as exc:
        compat.log(f'Stories error: {exc}')


def run_follow(runner, page, account, profile_data: Optional[Dict[str, Any]] = None) -> None:
    compat = compat_module()
    try:
        compat.log('Follow...')
        profile_id = _resolve_profile_id(runner, account, profile_data)
        if not profile_id:
            compat.log('Profile not found in DB.')
            return
        accounts = runner.accounts_client.get_accounts_for_profile(profile_id)
        usernames = _apply_session_limit(compat, _usernames(accounts), runner.config.follow_count_range, 'Follow')
        if not usernames:
            compat.log('No targets for follow.')
            return
        compat.follow_usernames(
            profile_name=account.username,
            proxy_string=account.proxy or '',
            usernames=usernames,
            log=compat.log,
            should_stop=lambda: not runner.running,
            page=page,
            interactions_config=_follow_interactions_config(runner.config),
            following_limit=runner.config.following_limit,
            on_success=_follow_success_callback(compat, runner, _account_map(accounts)),
            on_skip=_follow_skip_callback(compat, runner, _account_map(accounts)),
        )
    except Exception as exc:
        compat.log(f'Follow error: {exc}')


def _follow_interactions_config(config) -> FollowInteractionsConfig:
    return {
        'highlights_range': config.highlights_range,
        'likes_percentage': config.likes_percentage,
        'scroll_percentage': config.scroll_percentage,
    }


def _follow_success_callback(compat, runner, account_map: Dict[str, str]):
    return compat.create_status_callback(
        runner.accounts_client,
        account_map,
        compat.log,
        'subscribed',
        success_message="Status @{username} -> 'subscribed'.",
    )


def _follow_skip_callback(compat, runner, account_map: Dict[str, str]):
    return compat.create_status_callback(
        runner.accounts_client,
        account_map,
        compat.log,
        'skipped',
        clear_assigned=True,
        success_message="Skipping @{username}: 'skipped', assignment cleared.",
    )


def run_unfollow(runner, page, account, profile_data: Optional[Dict[str, Any]] = None) -> None:
    compat = compat_module()
    try:
        compat.log('Unfollow...')
        profile_id = _resolve_profile_id(runner, account, profile_data, status='unsubscribed')
        if not profile_id:
            compat.log('No profile data for unfollow.')
            return
        accounts = runner.accounts_client.get_accounts_for_profile(profile_id, status='unsubscribed')
        usernames = _apply_session_limit(compat, _usernames(accounts), runner.config.unfollow_count_range, 'Unfollow')
        if not usernames:
            compat.log('No assigned accounts for unfollow.')
            return
        compat.unfollow_usernames(
            profile_name=account.username,
            proxy_string=account.proxy or '',
            usernames=usernames,
            log=compat.log,
            should_stop=lambda: not runner.running,
            delay_range=runner.config.unfollow_delay_range or (10, 30),
            on_success=compat.create_status_callback(
                runner.accounts_client,
                _account_map(accounts),
                compat.log,
                'done',
                clear_assigned=True,
            ),
            page=page,
        )
    except Exception as exc:
        compat.log(f'Unfollow error: {exc}')


def run_approve(runner, page, account) -> None:
    compat = compat_module()
    try:
        compat.log('Approve Requests...')
        compat.approve_follow_requests(
            profile_name=account.username,
            proxy_string=account.proxy or '',
            log=compat.log,
            should_stop=lambda: not runner.running,
            page=page,
        )
    except Exception as exc:
        compat.log(f'Approve error: {exc}')


def run_messages(
    runner,
    page,
    account,
    profile_data: Optional[Dict[str, Any]] = None,
    cached_targets: Optional[List[Dict[str, Any]]] = None,
) -> None:
    compat = compat_module()
    try:
        compat.log('Messaging...')
        profile_id = _resolve_profile_id(runner, account, profile_data)
        if not profile_id:
            compat.log('Profile not found for messaging.')
            return
        eligible = cached_targets if cached_targets is not None else runner.accounts_client.get_accounts_to_message(profile_id)
        if not eligible:
            compat.log('No targets for messaging.')
            return
        compat.send_messages(
            profile_name=account.username,
            proxy_string=account.proxy or '',
            targets=eligible,
            message_texts=runner.config.message_texts or ['Hi!'],
            log=compat.log,
            should_stop=lambda: not runner.running,
            page=page,
        )
    except Exception as exc:
        compat.log(f'Messaging error: {exc}')


def _resolve_profile_id(runner, account, profile_data: Optional[Dict[str, Any]], status: Optional[str] = None) -> Optional[str]:
    if profile_data and profile_data.get('profile_id'):
        return str(profile_data.get('profile_id'))
    profiles = runner.accounts_client.get_profiles_with_assigned_accounts(status=status)
    fallback = next((profile for profile in profiles if profile.get('name') == account.username), None)
    if not isinstance(fallback, dict):
        return None
    profile_id = fallback.get('profile_id')
    return str(profile_id) if profile_id else None


def _usernames(accounts: List[Dict[str, Any]]) -> List[str]:
    return [account.get('user_name') for account in accounts if account.get('user_name')]


def _account_map(accounts: List[Dict[str, Any]]) -> Dict[str, str]:
    return {
        account['user_name']: account['id']
        for account in accounts
        if account.get('id') and account.get('user_name')
    }


def _apply_session_limit(compat, usernames: List[str], count_range, label: str) -> List[str]:
    limited = compat.apply_count_limit(usernames, count_range)
    if count_range:
        compat.log(f'{label} session limit: {len(limited)}')
    return limited
