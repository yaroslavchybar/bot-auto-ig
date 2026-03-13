import random
import signal
import sys
import time
import traceback
from typing import Optional

from python.browser.compat import compat as compat_module


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
    _register_signal_handlers()
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
        print('[*] Stopped.')
    except Exception as exc:
        print(f'[!] Error occurred: {exc}')
        print(f'[!] Error type: {type(exc).__name__}')
        print('[!] Full traceback:')
        traceback.print_exc()
        time.sleep(10)


def _print_run_header(profile_name, proxy_string, action, fingerprint_seed, fingerprint_os, os_name, user_agent, headless) -> None:
    print(f'[*] Starting Profile: {profile_name}')
    print(f'[*] Action: {action}')
    if proxy_string and proxy_string.lower() not in ['none', '']:
        print(f'[*] Using Proxy: {proxy_string}')
    if fingerprint_seed:
        print(f"[*] Using fingerprint seed: {fingerprint_seed[:8]}... (OS: {fingerprint_os or os_name or 'windows'})")
    elif user_agent:
        print(f'[*] Using User Agent: {user_agent}')
    print(f"[*] Headless mode: {'ON' if headless else 'OFF'}")


def _register_signal_handlers() -> None:
    def _handle_signal(_sig, _frame):
        raise SystemExit(0)

    if hasattr(signal, 'SIGINT'):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, 'SIGTERM'):
        signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, _handle_signal)


def _open_browser_session(profile_name, proxy_string, user_agent, headless, os_name, fingerprint_seed, fingerprint_os, display):
    compat = compat_module()
    print('[*] Initializing Camoufox browser...')
    return compat.create_browser_context(
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
    compat = compat_module()
    print('[*] Camoufox initialized successfully')
    print('[*] Browser is running...')
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
            _run_feed_session(compat, page, profile_name, duration, feed_config)
        elif action == 'reels':
            _run_reels_session(compat, page, profile_name, duration, reels_config)
        elif action == 'mixed':
            _run_mixed_session(compat, page, profile_name, feed_duration, reels_duration, feed_config, reels_config)
        if action in ('scroll', 'reels', 'mixed'):
            _finish_automated_session(context)
        else:
            _keep_manual_session_alive(context)
    except KeyboardInterrupt:
        print('[*] Stopped scrolling - closing browser...')
        try:
            context.close()
        except Exception:
            pass
        print('Browser closed.')


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


def _run_feed_session(compat, page, profile_name: str, duration: int, feed_config: dict) -> None:
    print(f'[*] Starting scrolling session for {duration} minutes...')
    print(f'[*] Config: {feed_config}')
    compat.scroll_feed(page, duration, feed_config, profile_name=profile_name)
    print('[*] Scrolling session finished.')


def _run_reels_session(compat, page, profile_name: str, duration: int, reels_config: dict) -> None:
    print(f'[*] Starting REELS session for {duration} minutes...')
    compat.scroll_reels(page, duration, reels_config, profile_name=profile_name)
    print('[*] Reels session finished.')


def _run_mixed_session(compat, page, profile_name: str, feed_duration: int, reels_duration: int, feed_config: dict, reels_config: dict) -> None:
    print(f'[*] Starting MIXED session (Feed: {feed_duration}m, Reels: {reels_duration}m)...')
    tasks = []
    if feed_duration > 0:
        tasks.append(('feed', feed_duration))
    if reels_duration > 0:
        tasks.append(('reels', reels_duration))
    random.shuffle(tasks)
    for idx, (task_type, task_duration) in enumerate(tasks, 1):
        if task_type == 'feed':
            print(f'[*] [{idx}/{len(tasks)}] Running Feed scroll for {task_duration} mins...')
            compat.scroll_feed(page, task_duration, feed_config, profile_name=profile_name)
            print('Feed part complete.')
        else:
            print(f'[*] [{idx}/{len(tasks)}] Running Reels scroll for {task_duration} mins...')
            compat.scroll_reels(page, task_duration, reels_config, profile_name=profile_name)
            print('Reels part complete.')
        if idx < len(tasks):
            time.sleep(random.randint(5, 10))
    print('[*] Mixed session finished.')


def _finish_automated_session(context) -> None:
    print('[*] Automated session complete. Force closing browser to proceed...')
    try:
        context.close()
    except Exception:
        pass
    sys.exit(0)


def _keep_manual_session_alive(context) -> None:
    print('[*] Manual mode active. Keep window open.')
    while len(context.pages) > 0:
        time.sleep(0.5)
