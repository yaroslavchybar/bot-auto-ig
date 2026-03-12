from typing import Callable


def mark_account_approved(client, username: str, log: Callable[[str], None]) -> None:
    try:
        res = client.update_account_message(username, True)
        if res:
            log(f"Updated message for @{username}")
        else:
            log(f"Database update failed for @{username} (No match in DB?)")
    except Exception as e:
        log(f"API Error updating message for @{username}: {e}")

