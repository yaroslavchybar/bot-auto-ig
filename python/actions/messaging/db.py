from typing import Callable

from python.database.accounts import InstagramAccountsClient


def mark_sent(client: InstagramAccountsClient, username: str, log: Callable[[str], None]) -> None:
    """Mark account as messaged by setting message=true."""
    try:
        client.update_account_message(username, message=True)
        log(f"{username}: отмечен как отправленный (message -> true)")
    except Exception as e:
        log(f"Ошибка БД для {username}: {e}")
