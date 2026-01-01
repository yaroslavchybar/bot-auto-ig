import random
from typing import Callable, Dict, List

from python.automation.actions import random_delay
from python.automation.messaging.db import should_skip_by_cooldown, update_after_send
from python.automation.messaging.detection import detect_incoming_messages
from python.automation.messaging.templates import load_message_2_texts
from python.automation.messaging.ui import (
    cleanup_return_home,
    dismiss_turn_on_notifications_popup,
    ensure_instagram_open,
    find_message_box,
    find_modal_search_input,
    find_send_button,
    open_direct_inbox,
    open_new_message_search,
    recover_to_inbox,
    select_user_row,
)


def _split_message_parts(template: str) -> List[str]:
    if "|" not in template:
        return [template]
    first, second = template.split("|", 1)
    if str(second).strip():
        return [first, second]
    return [template]


def _type_template(page, msg_box, template: str) -> None:
    chunks = str(template).split("\\")
    for i, chunk in enumerate(chunks):
        if chunk:
            msg_box.type(chunk, delay=random.randint(100, 200))
        if i < len(chunks) - 1:
            page.keyboard.down("Shift")
            page.keyboard.press("Enter")
            page.keyboard.up("Shift")
            random_delay(0.2, 0.4)


def _send_current_message(page) -> None:
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
    cooldown_enabled: bool,
    cooldown_hours: int,
) -> int:
    processed_count = 0

    try:
        ensure_instagram_open(page)
        random_delay(2, 4)

        open_direct_inbox(page, log)
        random_delay(3, 5)

        dismiss_turn_on_notifications_popup(page)

        message_2_texts = load_message_2_texts()
        log(f"Загружено {len(message_2_texts)} альтернативных сообщений из базы")

        for target in targets:
            if should_stop():
                break

            username = target.get("user_name")
            account_id = target.get("id")

            if not username:
                continue

            log(f"Обработка сообщения для: {username}")

            if should_skip_by_cooldown(
                client=client,
                account_id=account_id,
                username=username,
                cooldown_enabled=cooldown_enabled,
                cooldown_hours=cooldown_hours,
                log=log,
            ):
                continue

            try:
                search_input = open_new_message_search(page, log)
                if not search_input:
                    log(f"Поле поиска не найдено, пропускаю {username}...")
                    continue

                random_delay(3, 4)

                modal_search = find_modal_search_input(page, log)
                if not modal_search or not modal_search.is_visible():
                    log(f"Поле поиска в модальном окне не найдено, пропускаю {username}...")
                    try:
                        page.keyboard.press("Escape")
                    except Exception:
                        pass
                    random_delay(1, 2)
                    continue

                modal_search.clear()
                random_delay(0.5, 1)
                modal_search.type(username, delay=random.randint(100, 200))
                log(f"Набрал имя пользователя: {username}")

                random_delay(2, 3)

                search_input.fill(username)
                random_delay(2, 3)

                if not select_user_row(page, username, log):
                    continue

                random_delay(2, 4)

                has_incoming = detect_incoming_messages(page)
                if has_incoming:
                    log(f"Обнаружены входящие сообщения от {username}, отправляю альтернативное сообщение")
                else:
                    log(f"Входящих сообщений от {username} не обнаружено, отправляю обычное сообщение")

                msg_box = find_message_box(page, log)
                if msg_box and msg_box.is_visible():
                    msg_box.click()
                    random_delay(0.5, 1)

                    if has_incoming:
                        selected_message = random.choice(message_2_texts)
                        log(f"Использую альтернативное сообщение: {selected_message[:50]}...")
                    else:
                        selected_message = random.choice(message_texts)
                        log(f"Использую обычное сообщение: {selected_message[:50]}...")

                    parts = _split_message_parts(selected_message)
                    sent_any = False
                    for pi, part in enumerate(parts):
                        msg_box.click()
                        random_delay(0.4, 0.8)
                        _type_template(page, msg_box, part)
                        log(f"Набрал сообщение {pi + 1}/{len(parts)}: {str(part)[:80]}")

                        random_delay(1, 2)

                        _send_current_message(page)
                        sent_any = True
                        random_delay(1.2, 2.2)

                    if sent_any:
                        log(f"Отправил сообщение для {username}")
                        update_after_send(
                            client=client,
                            account_id=account_id,
                            username=username,
                            has_incoming=has_incoming,
                            log=log,
                        )
                        processed_count += 1
                else:
                    log(f"Не удалось найти поле ввода сообщения для {username}")

                random_delay(3, 5)
            except Exception as e:
                log(f"Ошибка в процессе отправки для {username}: {e}")
                recover_to_inbox(page)

        log(f"Рассылка завершена. Отправлено: {processed_count}")
    except Exception as e:
        log(f"Критическая ошибка браузера: {e}")
    finally:
        cleanup_return_home(page, log)

    return processed_count
