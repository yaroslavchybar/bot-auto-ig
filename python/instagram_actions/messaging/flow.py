import random
from typing import Callable, Dict, List

from python.instagram_actions.actions import random_delay
from python.instagram_actions.messaging.db import mark_sent
from python.instagram_actions.messaging.ui import (
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


def _type_message(
    page,
    msg_box,
    text: str,
    target: Dict,
    typing_delay_range_ms: tuple[int, int],
) -> None:
    """Type a message character by character with human-like delays, replacing macros."""
    # Replace macros with target data
    final_text = text
    
    # Define mapping from macro to target field
    macros = {
        "{userName}": target.get("user_name", ""),
        "{fullName}": target.get("full_name", ""),
        "{matchedName}": target.get("matched_name", "")
    }
    
    for macro, value in macros.items():
        # If value is None or empty, we replace it with empty string
        final_text = final_text.replace(macro, str(value) if value else "")
        
    delay_min_ms, delay_max_ms = typing_delay_range_ms
    msg_box.type(final_text, delay=random.randint(delay_min_ms, delay_max_ms))


def _send_current_message(page) -> None:
    """Click Send button or press Enter to send the message."""
    send_btn = find_send_button(page)
    if send_btn:
        try:
            send_btn.click(timeout=3000)
            return
        except Exception:
            pass
    random_delay(0.8, 1.2)
    page.keyboard.press("Enter")


def run_messaging_flow(
    page,
    targets: List[Dict],
    message_texts: List[str],
    log: Callable[[str], None],
    should_stop: Callable[[], bool],
    client,
    behavior_config: Dict | None = None,
) -> int:
    """
    Simplified messaging flow:
    1. Navigate to user's profile
    2. Click Message button (follow first if needed)
    3. Type and send the message
    4. Mark as sent (message -> false)
    """
    processed_count = 0
    behavior_config = behavior_config or {}
    navigation_delay_range = _normalize_float_range(
        behavior_config.get("navigation_delay_min_seconds", 2.0),
        behavior_config.get("navigation_delay_max_seconds", 3.0),
        (2.0, 3.0),
    )
    composer_delay_range = _normalize_float_range(
        behavior_config.get("composer_delay_min_seconds", 1.0),
        behavior_config.get("composer_delay_max_seconds", 2.0),
        (1.0, 2.0),
    )
    between_targets_delay_range = _normalize_float_range(
        behavior_config.get("between_targets_min_seconds", 3.0),
        behavior_config.get("between_targets_max_seconds", 5.0),
        (3.0, 5.0),
    )
    typing_delay_range_ms = _normalize_int_range(
        behavior_config.get("typing_delay_min_ms", 100),
        behavior_config.get("typing_delay_max_ms", 200),
        (100, 200),
    )
    follow_if_missing = bool(
        behavior_config.get("follow_if_no_message_button", True)
    )

    try:
        ensure_instagram_open(page)
        random_delay(2, 4)

        for target in targets:
            if should_stop():
                break

            username = target.get("user_name")
            if not username:
                continue

            log(f"Обработка сообщения для: {username}")

            try:
                if not navigate_to_profile(page, username, log):
                    continue

                random_delay(*navigation_delay_range)

                # Try to click Message button
                message_clicked = click_message_button(page, log)

                if not message_clicked and follow_if_missing:
                    # No Message button — try to Follow first
                    log(f"Кнопка Message не найдена для {username}, пробую Follow...")
                    followed = click_follow_button(page, log)
                    if followed:
                        # Update status to subscribed in DB
                        account_id = target.get("id")
                        if account_id:
                            try:
                                client.update_account_status(account_id, status="subscribed")
                                log(f"{username}: статус обновлён на subscribed")
                            except Exception as e:
                                log(f"Ошибка обновления статуса {username}: {e}")
                        random_delay(*navigation_delay_range)
                        # After following, try Message again
                        message_clicked = click_message_button(page, log)

                if not message_clicked:
                    log(f"Не удалось найти кнопку Message для {username}, пропускаю")
                    continue

                random_delay(*composer_delay_range)

                # Find message input box and type message
                try:
                    msg_box = find_message_box(page, log)
                    msg_box.click()
                    random_delay(0.5, 1)

                    selected_message = random.choice(message_texts)
                    log(f"Набираю сообщение: {str(selected_message)[:80]}")

                    _type_message(
                        page,
                        msg_box,
                        selected_message,
                        target,
                        typing_delay_range_ms,
                    )
                    random_delay(*composer_delay_range)

                    _send_current_message(page)
                    log(f"Отправил сообщение для {username}")

                    mark_sent(client, username, log)
                    processed_count += 1
                except Exception as e:
                    log(f"Не удалось отправить сообщение {username}: {str(e)[:50]}")

                random_delay(*between_targets_delay_range)
            except Exception as e:
                log(f"Ошибка в процессе отправки для {username}: {e}")

        log(f"Рассылка завершена. Отправлено: {processed_count}")
    except Exception as e:
        log(f"Критическая ошибка браузера: {e}")

    # Close any open DM popup
    try:
        from python.instagram_actions.actions import random_delay as _rd
        close_svg = page.query_selector('svg[aria-label="Close"]')
        if close_svg:
            close_btn = close_svg.query_selector(
                'xpath=ancestor-or-self::*[self::button or @role="button"][1]'
            ) or close_svg.query_selector('xpath=ancestor-or-self::*[self::div][1]')
            (close_btn or close_svg).click()
            log("Закрыл окно сообщений")
        else:
            page.keyboard.press("Escape")
        _rd(0.5, 1.0)
    except Exception:
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass

    return processed_count
