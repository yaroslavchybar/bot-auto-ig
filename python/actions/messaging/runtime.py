import random
from typing import Callable, Dict, List

from python.actions.common import random_delay
from python.actions.messaging.db import mark_sent
from python.actions.messaging.ui import (
    click_follow_button,
    click_message_button,
    ensure_instagram_open,
    find_message_box,
    find_send_button,
    navigate_to_profile,
)


def _normalize_float_range(
    min_value: float,
    max_value: float,
    fallback: tuple[float, float],
) -> tuple[float, float]:
    try:
        start = float(min_value)
        end = float(max_value)
    except Exception:
        start, end = fallback
    if end < start:
        start, end = end, start
    return start, end


def _normalize_int_range(
    min_value: int,
    max_value: int,
    fallback: tuple[int, int],
) -> tuple[int, int]:
    try:
        start = int(min_value)
        end = int(max_value)
    except Exception:
        start, end = fallback
    if end < start:
        start, end = end, start
    return start, end


def _type_message(page, msg_box, text: str, target: Dict, typing_delay_range_ms: tuple[int, int]) -> None:
    final_text = text
    macros = {
        '{userName}': target.get('user_name', ''),
        '{fullName}': target.get('full_name', ''),
        '{matchedName}': target.get('matched_name', ''),
    }
    for macro, value in macros.items():
        final_text = final_text.replace(macro, str(value) if value else '')
    delay_min_ms, delay_max_ms = typing_delay_range_ms
    msg_box.type(final_text, delay=random.randint(delay_min_ms, delay_max_ms))


def _send_current_message(page) -> None:
    send_btn = find_send_button(page)
    if send_btn:
        try:
            send_btn.click(timeout=3000)
            return
        except Exception:
            pass
    random_delay(0.8, 1.2)
    page.keyboard.press('Enter')


def run_messaging_flow(
    page,
    targets: List[Dict],
    message_texts: List[str],
    log: Callable[[str], None],
    should_stop: Callable[[], bool],
    client,
    behavior_config: Dict | None = None,
) -> int:
    processed_count = 0
    behavior = _behavior_config(behavior_config or {})
    if not message_texts:
        log('No message texts for sending.')
        return 0
    try:
        ensure_instagram_open(page)
        random_delay(2, 4)
        for target in targets:
            if should_stop():
                break
            if _process_target(page, target, message_texts, log, client, behavior):
                processed_count += 1
        log(f'Messaging completed. Sent: {processed_count}')
    except Exception as exc:
        log(f'Critical browser error: {exc}')
    _close_message_popup(page, log)
    return processed_count


def _behavior_config(behavior_config: Dict) -> Dict:
    direct_message_success_status = str(
        behavior_config.get('direct_message_success_status') or ''
    ).strip()
    return {
        'navigation_delay_range': _normalize_float_range(
            behavior_config.get('navigation_delay_min_seconds', 2.0),
            behavior_config.get('navigation_delay_max_seconds', 3.0),
            (2.0, 3.0),
        ),
        'composer_delay_range': _normalize_float_range(
            behavior_config.get('composer_delay_min_seconds', 1.0),
            behavior_config.get('composer_delay_max_seconds', 2.0),
            (1.0, 2.0),
        ),
        'between_targets_delay_range': _normalize_float_range(
            behavior_config.get('between_targets_min_seconds', 3.0),
            behavior_config.get('between_targets_max_seconds', 5.0),
            (3.0, 5.0),
        ),
        'typing_delay_range_ms': _normalize_int_range(
            behavior_config.get('typing_delay_min_ms', 100),
            behavior_config.get('typing_delay_max_ms', 200),
            (100, 200),
        ),
        'follow_if_missing': bool(behavior_config.get('follow_if_no_message_button', True)),
        'direct_message_success_status': direct_message_success_status or None,
    }


def _process_target(page, target: Dict, message_texts: List[str], log, client, behavior: Dict) -> bool:
    username = target.get('user_name')
    if not username:
        return False
    log(f'Processing message for: {username}')
    try:
        if not navigate_to_profile(page, username, log):
            return False
        random_delay(*behavior['navigation_delay_range'])
        composer_ready, followed_target = _ensure_message_composer(page, target, log, client, behavior)
        if not composer_ready:
            log(f'Could not find Message button for {username}, skipping')
            return False
        random_delay(*behavior['composer_delay_range'])
        sent = _compose_and_send(page, target, message_texts, log, client, behavior)
        if sent and not followed_target:
            _mark_direct_message_target(client, target, log, behavior)
        random_delay(*behavior['between_targets_delay_range'])
        return sent
    except Exception as exc:
        log(f'Error during send for {username}: {exc}')
        return False


def _ensure_message_composer(page, target: Dict, log, client, behavior: Dict) -> tuple[bool, bool]:
    if click_message_button(page, log):
        return True, False
    if not behavior['follow_if_missing']:
        return False, False
    username = target.get('user_name')
    log(f'Message button not found for {username}, trying Follow...')
    if not click_follow_button(page, log):
        return False, False
    _mark_followed_target(client, target, log)
    random_delay(*behavior['navigation_delay_range'])
    return click_message_button(page, log), True


def _mark_followed_target(client, target: Dict, log) -> None:
    account_id = target.get('id')
    username = target.get('user_name')
    if not account_id:
        return
    try:
        client.update_account_status(account_id, status='subscribed')
        log(f'{username}: status updated to subscribed')
    except Exception as exc:
        log(f'Error updating status for {username}: {exc}')


def _mark_direct_message_target(client, target: Dict, log, behavior: Dict) -> None:
    status = behavior.get('direct_message_success_status')
    if not status:
        return
    account_id = target.get('id')
    username = target.get('user_name')
    if not account_id:
        return
    try:
        client.update_account_status(account_id, status=status)
        log(f'{username}: status updated to {status}')
    except Exception as exc:
        log(f'Error updating status for {username}: {exc}')


def _compose_and_send(page, target: Dict, message_texts: List[str], log, client, behavior: Dict) -> bool:
    username = target.get('user_name')
    try:
        msg_box = find_message_box(page, log)
        if not msg_box:
            log(f'Could not find message input field for {username}')
            return False
        msg_box.click()
        random_delay(0.5, 1)
        if not message_texts:
            log('No message texts for sending.')
            return False
        selected_message = random.choice(message_texts)
        log(f'Typing message: {str(selected_message)[:80]}')
        _type_message(page, msg_box, selected_message, target, behavior['typing_delay_range_ms'])
        random_delay(*behavior['composer_delay_range'])
        _send_current_message(page)
        log(f'Sent message for {username}')
        mark_sent(client, username, log)
        return True
    except Exception as exc:
        log(f'Failed to send message to {username}: {str(exc)[:50]}')
        return False


def _close_message_popup(page, log) -> None:
    try:
        close_svg = page.locator('svg[aria-label="Close"]')
        if close_svg.count() > 0:
            first_close = close_svg.first
            btn_loc = first_close.locator('xpath=ancestor-or-self::*[self::button or @role="button"][1]')
            div_loc = first_close.locator('xpath=ancestor-or-self::*[self::div][1]')
            close_target = btn_loc.first if btn_loc.count() > 0 else (
                div_loc.first if div_loc.count() > 0 else first_close
            )
            close_target.click()
            log('Closed message window')
        else:
            page.keyboard.press('Escape')
        random_delay(0.5, 1.0)
    except Exception:
        try:
            page.keyboard.press('Escape')
        except Exception:
            pass
