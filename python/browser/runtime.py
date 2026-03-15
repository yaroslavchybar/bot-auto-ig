import logging
import random
import time
import traceback
from typing import Optional

from python.actions.browsing import scroll_feed, scroll_reels
from python.browser.context import create_browser_context

logger = logging.getLogger(__name__)


def run_browser(
    profile_name,
    proxy_string,
    action='manual',
    duration=5,
    match_likes=0,
    match_comments=0,
    match_follows=0,
    carousel_watch_chance=0,
    carousel_max_slides=3,
    watch_stories=True,
    stories_max=3,
    feed_duration=0,
    reels_duration=0,
    reels_match_likes=None,
    reels_match_follows=None,
    user_agent=None,
    headless=False,
    os=None,
    fingerprint_seed=None,
    fingerprint_os=None,
    display: Optional[str] = None,
):
    _print_run_header(profile_name, proxy_string, action, fingerprint_seed, fingerprint_os, os, user_agent, headless)
    # Signal handlers are registered by the caller (launcher.py / ShutdownManager).
    # Browser contexts are cleaned up via the context manager below.
    try:
        with _open_browser_session(
            profile_name,
            proxy_string,
            user_agent,
            headless,
            os,
            fingerprint_seed,
            fingerprint_os,
            display,
        ) as (context, page):
            _run_requested_action(
                profile_name,
                action,
                duration,
                page,
                context,
                match_likes,
                match_comments,
                match_follows,
                carousel_watch_chance,
                carousel_max_slides,
                watch_stories,
                stories_max,
                feed_duration,
                reels_duration,
                reels_match_likes,
                reels_match_follows,
            )
    except KeyboardInterrupt:
        logger.info('Stopped.')
    except Exception as exc:
        logger.error('Error occurred: %s', exc)
        logger.error('Error type: %s', type(exc).__name__)
        logger.error('Full traceback:', exc_info=True)
        time.sleep(10)


def _print_run_header(profile_name, proxy_string, action, fingerprint_seed, fingerprint_os, os_name, user_agent, headless) -> None:
    logger.info('Starting Profile: %s', profile_name)
    logger.info('Action: %s', action)
    if proxy_string and proxy_string.lower() not in ['none', '']:
        logger.info('Using Proxy: %s', proxy_string)
    if fingerprint_seed:
        logger.info("Using fingerprint seed: %s... (OS: %s)", fingerprint_seed[:8], fingerprint_os or os_name or 'windows')
    elif user_agent:
        logger.info('Using User Agent: %s', user_agent)
    logger.info("Headless mode: %s", 'ON' if headless else 'OFF')


def _open_browser_session(profile_name, proxy_string, user_agent, headless, os_name, fingerprint_seed, fingerprint_os, display):
    logger.info('Initializing Camoufox browser...')
    return create_browser_context(
        profile_name=profile_name,
        proxy_string=proxy_string,
        user_agent=user_agent,
        headless=headless,
        block_images=False,
        os=os_name,
        fingerprint_seed=fingerprint_seed,
        fingerprint_os=fingerprint_os,
        display=display,
    )


def _run_requested_action(
    profile_name,
    action,
    duration,
    page,
    context,
    match_likes,
    match_comments,
    match_follows,
    carousel_watch_chance,
    carousel_max_slides,
    watch_stories,
    stories_max,
    feed_duration,
    reels_duration,
    reels_match_likes,
    reels_match_follows,
) -> None:
    logger.info('Camoufox initialized successfully')
    logger.info('Browser is running...')
    feed_config, reels_config = _build_scroll_configs(
        match_likes,
        match_comments,
        match_follows,
        carousel_watch_chance,
        carousel_max_slides,
        watch_stories,
        stories_max,
        reels_match_likes,
        reels_match_follows,
    )
    try:
        if action == 'scroll':
            _run_feed_session(page, profile_name, duration, feed_config)
        elif action == 'reels':
            _run_reels_session(page, profile_name, duration, reels_config)
        elif action == 'mixed':
            _run_mixed_session(page, profile_name, feed_duration, reels_duration, feed_config, reels_config)
        if action in ('scroll', 'reels', 'mixed'):
            _finish_automated_session()
        else:
            _keep_manual_session_alive(context)
    except KeyboardInterrupt:
        logger.info('Stopped scrolling - closing browser...')
        logger.info('Browser closed.')


def _build_scroll_configs(
    match_likes,
    match_comments,
    match_follows,
    carousel_watch_chance,
    carousel_max_slides,
    watch_stories,
    stories_max,
    reels_match_likes,
    reels_match_follows,
) -> tuple[dict, dict]:
    def pick(primary, fallback):
        return fallback if primary is None else primary

    feed_config = {
        'like_chance': match_likes,
        'comment_chance': match_comments,
        'follow_chance': match_follows,
        'carousel_watch_chance': carousel_watch_chance,
        'carousel_max_slides': carousel_max_slides,
        'watch_stories': watch_stories,
        'stories_max': stories_max,
    }
    reels_config = {
        'like_chance': pick(reels_match_likes, match_likes),
        'comment_chance': match_comments,
        'follow_chance': pick(reels_match_follows, match_follows),
        'carousel_watch_chance': carousel_watch_chance,
        'carousel_max_slides': carousel_max_slides,
        'watch_stories': watch_stories,
        'stories_max': stories_max,
    }
    return feed_config, reels_config


def _run_feed_session(page, profile_name: str, duration: int, feed_config: dict) -> None:
    logger.info('Starting scrolling session for %d minutes...', duration)
    logger.info('Config: %s', feed_config)
    scroll_feed(page, duration, feed_config, profile_name=profile_name)
    logger.info('Scrolling session finished.')


def _run_reels_session(page, profile_name: str, duration: int, reels_config: dict) -> None:
    logger.info('Starting REELS session for %d minutes...', duration)
    scroll_reels(page, duration, reels_config, profile_name=profile_name)
    logger.info('Reels session finished.')


def _run_mixed_session(page, profile_name: str, feed_duration: int, reels_duration: int, feed_config: dict, reels_config: dict) -> None:
    logger.info('Starting MIXED session (Feed: %dm, Reels: %dm)...', feed_duration, reels_duration)
    tasks = []
    if feed_duration > 0:
        tasks.append(('feed', feed_duration))
    if reels_duration > 0:
        tasks.append(('reels', reels_duration))
    random.shuffle(tasks)
    for idx, (task_type, task_duration) in enumerate(tasks, 1):
        if task_type == 'feed':
            logger.info('[%d/%d] Running Feed scroll for %d mins...', idx, len(tasks), task_duration)
            scroll_feed(page, task_duration, feed_config, profile_name=profile_name)
            logger.info('Feed part complete.')
        else:
            logger.info('[%d/%d] Running Reels scroll for %d mins...', idx, len(tasks), task_duration)
            scroll_reels(page, task_duration, reels_config, profile_name=profile_name)
            logger.info('Reels part complete.')
        if idx < len(tasks):
            time.sleep(random.randint(5, 10))
    logger.info('Mixed session finished.')


def _finish_automated_session() -> None:
    logger.info('Automated session complete. Closing browser session...')


def _keep_manual_session_alive(context) -> None:
    logger.info('Manual mode active. Keep window open.')
    while len(context.pages) > 0:
        time.sleep(0.5)
