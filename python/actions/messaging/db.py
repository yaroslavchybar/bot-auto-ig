from typing import Callable

from python.core.clients import InstagramAccountsClient


def mark_sent(client: InstagramAccountsClient, username: str, log: Callable[[str], None]) -> None:
    """Mark account as messaged by setting message=true."""
    try:
        client.update_account_message(username, message=True)
        log(f"{username}: marked as sent (message -> true)")
    except Exception as e:
        log(f"DB error for {username}: {e}")
