from typing import Callable

from python.actions.common import random_delay

from python.actions.engagement.approve.db import mark_account_approved
from python.actions.engagement.approve.extract import extract_username_from_confirm_button
from python.actions.engagement.approve.ui import (
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
    approve_delay_range=(1.0, 2.0),
    finish_delay_seconds: float = 3.0,
) -> None:
    try:
        ensure_instagram_open(page, log)
        delay_min, delay_max = approve_delay_range
        if delay_max < delay_min:
            delay_min, delay_max = delay_max, delay_min

        opened = open_notifications(page, log)
        if not opened:
            return

        opened_panel = open_follow_requests_list(page, log)
        if not opened_panel:
            log("Could not open requests list, continuing search for Confirm.")

        confirm_buttons = find_confirm_buttons(page)
        if confirm_buttons:
            log(f"Found {len(confirm_buttons)} Confirm buttons. Approving...")
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

                    log("Request approved")
                    random_delay(delay_min, delay_max)
                except Exception as e:
                    log(f"Error during approval: {e}")
        else:
            log("No Confirm buttons found.")

        close_notifications(page, log)

        log(f"Waiting {finish_delay_seconds} seconds before closing session...")
        random_delay(finish_delay_seconds, finish_delay_seconds)

        log("Notification processing complete.")
    except Exception as e:
        log(f"Error during approval process: {e}")
