from typing import Callable

from python.instagram_actions.actions import random_delay

from python.instagram_actions.engagement.approve_follow_requests.db import mark_account_approved
from python.instagram_actions.engagement.approve_follow_requests.extract import extract_username_from_confirm_button
from python.instagram_actions.engagement.approve_follow_requests.ui import (
    close_notifications,
    ensure_instagram_open,
    find_confirm_buttons,
    open_follow_requests_list,
    open_notifications,
)


def run_approve_follow_requests(
    page,
    client,
    log: Callable[[str], None],
    should_stop: Callable[[], bool],
) -> None:
    try:
        ensure_instagram_open(page, log)

        opened = open_notifications(page, log)
        if not opened:
            return

        opened_panel = open_follow_requests_list(page, log)
        if not opened_panel:
            log("Не удалось открыть список заявок, продолжаю поиск Confirm.")

        confirm_buttons = find_confirm_buttons(page)
        if confirm_buttons:
            log(f"Найдено {len(confirm_buttons)} кнопок Confirm. Подтверждаю...")
            for btn in confirm_buttons:
                if should_stop():
                    break

                try:
                    if not btn.is_visible():
                        continue

                    username = extract_username_from_confirm_button(btn, log)
                    if username:
                        log(f"Found username: {username}")

                    btn.click()
                    if username:
                        mark_account_approved(client, username, log)

                    log("Подтверждена заявка")
                    random_delay(1, 2)
                except Exception as e:
                    log(f"Ошибка при подтверждении: {e}")
        else:
            log("Кнопки Confirm не найдены.")

        close_notifications(page, log)

        log("Ожидание 3 секунды перед закрытием сессии...")
        random_delay(3, 3)

        log("Обработка уведомлений завершена.")
    except Exception as e:
        log(f"Ошибка в процессе подтверждения: {e}")
