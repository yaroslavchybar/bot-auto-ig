import os
import random
import time

from playwright.sync_api import Error as PlaywrightError

from python.actions.browsing.utils import human_scroll, scroll_to_element
from python.actions.common import random_delay
from python.actions.stories import watch_stories
from python.core.errors.exceptions import BotException
from python.core.errors.retry import jitter
from python.core.selectors import HOME_BUTTON
from python.core.storage.state_persistence import save_state

from .carousel import watch_carousel
from .following import perform_follow
from .likes import perform_like

_FEED_DEBUG_MOUSE = os.getenv('FEED_DEBUG_MOUSE', '1').strip().lower() in {'1', 'true', 'yes', 'on'}


def _debug_mouse(message: str) -> None:
    if _FEED_DEBUG_MOUSE:
        print(f'[feed-scroll-debug] {message}')


def _navigate_home(page):
    try:
        if page.url.rstrip('/') == 'https://www.instagram.com':
            return
        print('[*] Navigating to Home feed...')
        if _click_home_button(page):
            random_delay(jitter(3000) / 1000, jitter(5000) / 1000)
            _dismiss_notifications_modal(page)
            return
        page.goto('https://www.instagram.com/', timeout=jitter(30000))
    except (PlaywrightError, BotException) as exc:
        print(f'[!] Navigation error: {type(exc).__name__} - {exc}')
        _goto_home_fallback(page)
    except Exception as exc:
        print(f'[!] Unexpected navigation error: {type(exc).__name__} - {exc}')
        _goto_home_fallback(page)


def _click_home_button(page) -> bool:
    element = HOME_BUTTON.find(page)
    if not element:
        return False
    try:
        _home_click_target(element).click()
        return True
    except (PlaywrightError, BotException) as exc:
        print(f'[!] Home selector click failed: {type(exc).__name__}')
        return False


def _home_click_target(element):
    try:
        if not element.evaluate("el => el.tagName.toLowerCase() === 'svg'"):
            return element
        clickable = element
        for _ in range(4):
            parent = clickable.query_selector('xpath=..')
            if not parent:
                return element
            clickable = parent
        if _is_clickable_home_target(clickable):
            return clickable
    except Exception:
        pass
    return element


def _is_clickable_home_target(element) -> bool:
    try:
        return bool(
            element.evaluate(
                """
                (el) => {
                    const tag = (el.tagName || '').toLowerCase();
                    const role = (el.getAttribute('role') || '').toLowerCase();
                    return tag === 'a' || tag === 'button' || role === 'link' || role === 'button';
                }
                """
            )
        )
    except Exception:
        return False


def _dismiss_notifications_modal(page) -> None:
    try:
        not_now = page.query_selector('button:has-text("Not Now")')
        if not_now:
            not_now.click()
            random_delay(1, 2)
    except Exception:
        pass


def _goto_home_fallback(page) -> None:
    try:
        page.goto('https://www.instagram.com/', timeout=jitter(30000))
    except Exception:
        pass


def _get_next_post(page, posts, skip_count: int = 0):
    viewport_h = _viewport_h(page) or 900
    threshold_y = viewport_h * 0.52
    candidates = []
    for post in posts:
        try:
            box = post.bounding_box()
            if not box:
                continue
            center_y = box['y'] + (box['height'] / 2)
            if center_y > threshold_y:
                candidates.append((box['y'], post))
        except Exception:
            continue
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    index = min(max(0, int(skip_count)), len(candidates) - 1)
    return candidates[index][1]


def _format_box(box) -> str:
    if not box:
        return 'None'
    return f"({box['x']:.1f},{box['y']:.1f},{box['width']:.1f},{box['height']:.1f})"


def _viewport_h(page) -> int:
    try:
        return int(page.evaluate('() => window.innerHeight') or 0)
    except Exception:
        return 0


def _normalize_range(min_value, max_value, fallback):
    try:
        start = float(min_value)
        end = float(max_value)
    except Exception:
        start, end = fallback
    if end < start:
        start, end = end, start
    return start, end


def _chance_hit(chance: float) -> bool:
    safe_chance = max(0.0, min(100.0, float(chance)))
    return random.random() < (safe_chance / 100.0)


def scroll_feed(page, duration_minutes: int, actions_config: dict, should_stop=None, profile_name: str = 'unknown') -> dict:
    stats = {'likes': 0, 'follows': 0}
    clock = _session_clock(duration_minutes)
    try:
        _navigate_home(page)
        if _should_end_session(clock, should_stop):
            return stats
        _watch_stories_if_enabled(page, actions_config, should_stop)
        print(f'[*] Starting {duration_minutes} minute scroll session on Instagram...')
        while _session_active(clock, should_stop):
            _report_time_remaining(clock['end'])
            _save_session_progress(profile_name, clock['start'], duration_minutes)
            if _reload_stalled_page(page, clock):
                continue
            if not _process_feed_iteration(page, actions_config, stats, should_stop):
                continue
            clock['last_action'] = time.time()
        print(f'Scroll session complete: {stats}')
        return stats
    except (PlaywrightError, BotException) as exc:
        print(f'[!] Error during scrolling: {type(exc).__name__} - {exc}')
        return stats
    except Exception as exc:
        print(f'[!] Unexpected error during scrolling: {type(exc).__name__} - {exc}')
        return stats


def _session_clock(duration_minutes: int) -> dict:
    start_time = time.time()
    end_time = start_time + (duration_minutes * 60)
    return {
        'start': start_time,
        'end': end_time,
        'hard_timeout': end_time + 120,
        'last_action': start_time,
    }


def _watch_stories_if_enabled(page, actions_config: dict, should_stop) -> None:
    if not actions_config.get('watch_stories', True):
        return
    if should_stop and should_stop():
        return
    try:
        story_view_min, story_view_max = _normalize_range(
            actions_config.get('stories_min_view_seconds', 2.0),
            actions_config.get('stories_max_view_seconds', 5.0),
            (2.0, 5.0),
        )
        watch_stories(
            page,
            max_stories=actions_config.get('stories_max', 3),
            min_view_s=story_view_min,
            max_view_s=story_view_max,
        )
    except (PlaywrightError, BotException) as exc:
        print(f'[!] Story watch skipped: {type(exc).__name__} - {exc}')
    except Exception as exc:
        print(f'[!] Story watch skipped (unexpected): {type(exc).__name__} - {exc}')


def _session_active(clock: dict, should_stop) -> bool:
    now = time.time()
    if should_stop and should_stop():
        print('[!] Stop signal received. Ending feed session.')
        return False
    if now >= clock['hard_timeout']:
        print('[!] HARD TIMEOUT REACHED. Playwright may have hung. Force breaking.')
        return False
    if now >= clock['end']:
        print(f"[*] Expected duration reached. Ending feed session.")
        return False
    return True


def _should_end_session(clock: dict, should_stop) -> bool:
    return (should_stop and should_stop()) or time.time() >= clock['end']


def _report_time_remaining(end_time: float) -> None:
    minutes_left = (end_time - time.time()) / 60
    print(f'[*] Time remaining in session: {minutes_left:.1f} minutes')


def _save_session_progress(profile_name: str, start_time: float, duration_minutes: int) -> None:
    elapsed = time.time() - start_time
    total_duration = duration_minutes * 60
    progress = int((elapsed / total_duration) * 100) if total_duration > 0 else 0
    save_state(profile_name, 'scroll_feed', min(progress, 99))


def _reload_stalled_page(page, clock: dict) -> bool:
    if time.time() - clock['last_action'] < 180:
        return False
    print('[!] No actions or posts processed in the last 3 minutes. Auto-reloading page...')
    try:
        page.reload(timeout=15000)
    except Exception as exc:
        print(f'[!] Failed to reload page: {exc}')
    clock['last_action'] = time.time()
    random_delay(3, 6)
    return True


def _process_feed_iteration(page, actions_config: dict, stats: dict, should_stop) -> bool:
    posts = page.query_selector_all('article')
    if not posts:
        human_scroll(page, should_stop=should_stop)
        return False
    target_post = _select_target_post(page, posts, actions_config)
    if not target_post:
        human_scroll(page, should_stop=should_stop)
        return False
    if not _focus_target_post(page, target_post, should_stop):
        human_scroll(page, should_stop=should_stop)
        return False
    _view_post(actions_config)
    if should_stop and should_stop():
        return True
    _handle_carousel(page, target_post, actions_config)
    _handle_like(page, target_post, actions_config, stats)
    _handle_follow(page, target_post, actions_config, stats)
    return True


def _select_target_post(page, posts, actions_config: dict):
    skip_count = 0
    if _chance_hit(actions_config.get('skip_post_chance', 30)):
        skip_count = random.randint(1, actions_config.get('skip_post_max', 2))
    return _get_next_post(page, posts, skip_count=skip_count)


def _focus_target_post(page, target_post, should_stop) -> bool:
    target_y_ratio = random.uniform(0.45, 0.55)
    pre_box = _safe_box(target_post)
    _debug_mouse(
        f'target selected: target_y_ratio={target_y_ratio:.3f} '
        f'pre_scroll_box={_format_box(pre_box)} viewport_h={_viewport_h(page)}'
    )
    if not scroll_to_element(
        page,
        target_post,
        target_y_ratio=target_y_ratio,
        ensure_full_visible=False,
        should_stop=should_stop,
    ):
        return False
    _debug_post_box(page, target_post)
    return True


def _safe_box(target_post):
    try:
        return target_post.bounding_box()
    except Exception:
        return None


def _debug_post_box(page, target_post) -> None:
    try:
        post_box = target_post.bounding_box()
        vp_h = _viewport_h(page)
        post_bottom = (post_box['y'] + post_box['height']) if post_box else -1
        post_bottom_gap = (vp_h - post_bottom) if vp_h > 0 and post_box else -1
        _debug_mouse(
            f'after scroll_to_element: post_box={_format_box(post_box)} '
            f'viewport_h={vp_h} post_bottom_gap={post_bottom_gap:.1f}'
        )
    except Exception:
        _debug_mouse('after scroll_to_element: failed to read post bounding box')


def _view_post(actions_config: dict) -> None:
    post_view_min, post_view_max = _normalize_range(
        actions_config.get('post_view_min_seconds', 2.0),
        actions_config.get('post_view_max_seconds', 5.0),
        (2.0, 5.0),
    )
    view_time = random.uniform(post_view_min, post_view_max)
    print(f'[*] Viewing feed post for {view_time:.1f}s')
    time.sleep(view_time)


def _handle_carousel(page, target_post, actions_config: dict) -> None:
    carousel_chance = actions_config.get('carousel_watch_chance', 0)
    if carousel_chance <= 0 or not _chance_hit(carousel_chance):
        return
    watch_carousel(page, target_post, max_slides=actions_config.get('carousel_max_slides', 3))


def _handle_like(page, target_post, actions_config: dict, stats: dict) -> None:
    like_chance = actions_config.get('like_chance', 0)
    like_roll = random.random() * 100.0
    _debug_mouse(f'like decision: roll={like_roll} chance={like_chance}')
    if like_roll >= max(0.0, min(100.0, float(like_chance))):
        return
    _debug_like_button(page, target_post)
    if perform_like(page, target_post):
        stats['likes'] += 1


def _debug_like_button(page, target_post) -> None:
    try:
        like_area = target_post.query_selector('svg[aria-label="Like"]')
        like_box = like_area.bounding_box() if like_area else None
        vp_h = _viewport_h(page)
        like_bottom = (like_box['y'] + like_box['height']) if like_box else -1
        like_bottom_gap = (vp_h - like_bottom) if vp_h > 0 and like_box else -1
        _debug_mouse(
            f'before perform_like: like_box={_format_box(like_box)} '
            f'viewport_h={vp_h} like_bottom_gap={like_bottom_gap:.1f}'
        )
    except Exception:
        _debug_mouse('before perform_like: failed to read like button bounding box')


def _handle_follow(page, target_post, actions_config: dict, stats: dict) -> None:
    follow_chance = actions_config.get('follow_chance', 0)
    if not _chance_hit(follow_chance):
        return
    if perform_follow(page, target_post):
        stats['follows'] += 1
