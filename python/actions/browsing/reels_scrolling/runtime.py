import logging
import random
import time

from python.actions.common import random_delay, safe_mouse_move
from python.core.storage.state_persistence import save_state

from .likes import perform_like

logger = logging.getLogger(__name__)

NEXT_REEL_BUTTON_XPATH = (
    "//div[@role='button' and "
    "(contains(@aria-label, 'next Reel') or contains(@aria-label, 'Next Reel'))]"
)
PREVIOUS_REEL_BUTTON_XPATH = (
    "//div[@role='button' and "
    "(contains(@aria-label, 'previous Reel') or contains(@aria-label, 'Previous Reel'))]"
)


def _find_reels_navigation_button(page, button_xpath: str):
    button = page.locator(f'xpath={button_xpath}').first
    if button.count() == 0 or not button.is_visible():
        return None
    return button


def _go_to_next_reel(page) -> bool:
    try:
        next_btn = _find_reels_navigation_button(page, NEXT_REEL_BUTTON_XPATH)
        if not next_btn:
            logger.warning("Semantic 'Next Reel' button not found.")
            return False
        box = next_btn.bounding_box()
        if not box:
            return False
        center_x = box['x'] + box['width'] / 2
        center_y = box['y'] + box['height'] / 2
        safe_mouse_move(page, center_x, center_y, steps=5)
        random_delay(0.2, 0.5)
        page.mouse.click(center_x, center_y)
        logger.info("Clicked 'Next Reel' arrow")
        return True
    except Exception as exc:
        logger.error(f'Error navigating to next reel: {exc}')
        return False


def _navigate_reels(page):
    if 'instagram.com/reels' in page.url:
        return
    logger.info('Navigating to Reels tab via UI...')
    try:
        reels_link = page.query_selector('a[href="/reels/"]')
        if reels_link:
            _click_reels_link(page, reels_link)
            return
        logger.warning('Reels link not found in sidebar')
    except Exception as exc:
        logger.error(f'Navigation error, fallback to URL: {exc}')
    page.goto('https://www.instagram.com/reels/', timeout=30000)
    random_delay(3, 5)


def _click_reels_link(page, reels_link) -> None:
    box = reels_link.bounding_box()
    if not box:
        logger.warning('Reels link visible but no bounding box')
        page.goto('https://www.instagram.com/reels/', timeout=30000)
        return
    target_x = box['x'] + (box['width'] / 2)
    target_y = box['y'] + (box['height'] / 2)
    safe_mouse_move(page, target_x, target_y, steps=4)
    random_delay(0.2, 0.4)
    page.mouse.click(target_x, target_y)
    page.wait_for_url('**/reels/**', timeout=15000)
    random_delay(1, 2)


def _perform_follow(page) -> bool:
    try:
        btn_handle = page.evaluate_handle(
            """
            () => {
                const candidates = Array.from(document.querySelectorAll('button, div[role="button"]'));
                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;
                let best = null;
                let bestDistance = Infinity;
                for (const candidate of candidates) {
                    if (candidate.closest('[role="dialog"]')) continue;
                    const text = (candidate.textContent || '').trim();
                    if (text !== 'Follow') continue;
                    const rect = candidate.getBoundingClientRect();
                    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
                    if (rect.top < 0 || rect.bottom > viewportHeight) continue;
                    if (rect.left < 0 || rect.right > viewportWidth) continue;
                    const centerY = rect.top + rect.height / 2;
                    const distance = Math.abs(centerY - viewportHeight / 2);
                    if (distance < bestDistance) {
                        best = candidate;
                        bestDistance = distance;
                    }
                }
                return best;
            }
            """
        )
        target = btn_handle.as_element()
        if not target:
            logger.debug('No visible Follow button found for current reel')
            return False
        box = target.bounding_box()
        if not box:
            return False
        center_x = box['x'] + box['width'] / 2
        center_y = box['y'] + box['height'] / 2
        safe_mouse_move(page, center_x, center_y, steps=random.randint(4, 8))
        random_delay(0.15, 0.35)
        page.mouse.click(center_x, center_y, delay=random.randint(20, 60))
        logger.info('Followed user from reel')
        return True
    except Exception as exc:
        logger.error(f'Error following from reel: {exc}')
        return False


def _chance_hit(chance: float) -> bool:
    safe_chance = max(0.0, min(100.0, float(chance)))
    return random.random() < (safe_chance / 100.0)


def _queue_actions(page, actions_config):
    actions_to_perform = []
    if _chance_hit(actions_config.get('like_chance', 0)):
        actions_to_perform.append(('like', lambda: perform_like(page)))
    if _chance_hit(actions_config.get('follow_chance', 0)):
        actions_to_perform.append(('follow', lambda: _perform_follow(page)))
    random.shuffle(actions_to_perform)
    return actions_to_perform


def scroll_reels(page, duration_minutes: int, actions_config: dict, should_stop=None, profile_name: str = 'unknown') -> dict:
    stats = {'likes': 0, 'follows': 0}
    clock = _session_clock(duration_minutes)
    try:
        _navigate_reels(page)
        logger.info(f'Starting {duration_minutes} minute REELS session...')
        while _session_active(clock, should_stop):
            _log_time_remaining(clock['end'])
            _save_session_progress(profile_name, clock['start'], duration_minutes)
            if _reload_stalled_page(page, clock):
                continue
            watched_reel = _watch_reel(page, actions_config, should_stop)
            clock['last_action'] = time.time()
            if not watched_reel:
                logger.info('Stop signal received during reel watch. Ending reels session.')
                break
            if should_stop and should_stop():
                logger.info('Stop signal received. Ending reels session.')
                break
            _execute_reel_actions(page, actions_config, should_stop, stats)
            if should_stop and should_stop():
                logger.info('Stop signal received. Ending reels session.')
                break
            if not _go_to_next_reel(page):
                break
            random_delay(*_advance_delay(actions_config))
    except Exception as exc:
        logger.error(f'Error during reels scrolling: {exc}')
    logger.info(f'Reels session complete: {stats}')
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


def _session_active(clock: dict, should_stop) -> bool:
    current_time = time.time()
    if current_time >= clock['hard_timeout']:
        logger.error('HARD TIMEOUT REACHED. Playwright may have hung. Force breaking.')
        return False
    if current_time >= clock['end']:
        logger.info('Expected duration reached. Ending reels session.')
        return False
    if should_stop and should_stop():
        logger.info('Stop signal received. Ending reels session.')
        return False
    return True


def _log_time_remaining(end_time: float) -> None:
    minutes_left = (end_time - time.time()) / 60
    logger.info(f'Time remaining in session: {minutes_left:.1f} minutes')


def _save_session_progress(profile_name: str, start_time: float, duration_minutes: int) -> None:
    elapsed = time.time() - start_time
    total_duration = duration_minutes * 60
    progress = int((elapsed / total_duration) * 100) if total_duration > 0 else 0
    save_state(profile_name, 'scroll_reels', min(progress, 99))


def _reload_stalled_page(page, clock: dict) -> bool:
    if time.time() - clock['last_action'] < 180:
        return False
    logger.warning('No reels processed in the last 3 minutes. Auto-reloading page...')
    try:
        page.reload(timeout=15000)
    except Exception as exc:
        logger.error(f'Failed to reload page: {exc}')
    clock['last_action'] = time.time()
    random_delay(3, 6)
    return True


def _watch_reel(page, actions_config: dict, should_stop) -> bool:
    watch_time = _watch_time(actions_config)
    start_sleep = time.time()
    while time.time() - start_sleep < watch_time:
        if should_stop and should_stop():
            return False
        time.sleep(0.5)
    return True


def _watch_time(actions_config: dict) -> float:
    skip_min, skip_max = _normalized_range(
        actions_config.get('reels_skip_min_time', 0.8),
        actions_config.get('reels_skip_max_time', 2.0),
    )
    normal_min, normal_max = _normalized_range(
        actions_config.get('reels_normal_min_time', 5.0),
        actions_config.get('reels_normal_max_time', 20.0),
    )
    if _chance_hit(actions_config.get('reels_skip_chance', 30)):
        watch_time = random.uniform(skip_min, skip_max)
        logger.info(f'Short watch (skip): {watch_time:.2f}s')
        return watch_time
    watch_time = random.uniform(normal_min, normal_max)
    logger.info(f'Normal watch: {watch_time:.2f}s')
    return watch_time


def _normalized_range(start_value: float, end_value: float) -> tuple[float, float]:
    start = float(start_value)
    end = float(end_value)
    return (end, start) if end < start else (start, end)


def _execute_reel_actions(page, actions_config: dict, should_stop, stats: dict) -> None:
    for action_name, action_func in _queue_actions(page, actions_config):
        if should_stop and should_stop():
            break
        try:
            if action_func():
                stats[action_name + 's'] += 1
                random_delay(1, 2)
        except Exception as exc:
            logger.error(f'Error executing {action_name} action on reel: {exc}')


def _advance_delay(actions_config: dict) -> tuple[float, float]:
    return _normalized_range(
        actions_config.get('reels_advance_min_seconds', 1.5),
        actions_config.get('reels_advance_max_seconds', 3.0),
    )
