import datetime
from typing import Callable


def should_skip_by_cooldown(
    client,
    account_id,
    username: str,
    cooldown_enabled: bool,
    cooldown_hours: int,
    log: Callable[[str], None],
) -> bool:
    try:
        last_sent_str = client.get_last_message_sent_at(account_id)
        if not last_sent_str:
            return False

        try:
            last_sent_dt = datetime.datetime.fromisoformat(str(last_sent_str).replace("Z", "+00:00"))
        except Exception:
            last_sent_dt = None

        if not last_sent_dt:
            return False

        now = datetime.datetime.now(datetime.timezone.utc)
        delta = now - last_sent_dt
        if cooldown_enabled and cooldown_hours > 0 and delta.total_seconds() < cooldown_hours * 3600:
            log(f"Пропускаю {username}: последнее сообщение {int(delta.total_seconds()//60)} мин назад")
            return True

        return False
    except Exception as e:
        log(f"Не удалось проверить время последней отправки для {username}: {e}")
        return False


def update_after_send(
    client,
    account_id,
    username: str,
    has_incoming: bool,
    log: Callable[[str], None],
) -> None:
    try:
        if has_incoming:
            client.update_account_link_sent(username, "done")
            log(f"{username}: link_sent -> done (альтернативное сообщение отправлено)")
        else:
            client.update_account_link_sent(username, "needed to send")
            log(f"{username}: link_sent -> needed to send")

        client.set_last_message_sent_now(account_id)
        log(f"{username}: обновлено время последней отправки")
    except Exception as db_e:
        log(f"Ошибка БД для {username}: {db_e}")

