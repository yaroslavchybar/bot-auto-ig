from typing import Callable, Dict, List, Optional

from python.browser_control.browser_setup import create_browser_context
from python.database_sync.accounts_client import InstagramAccountsClient

from python.instagram_actions.messaging.flow import run_messaging_flow


def send_messages(
    profile_name: str,
    proxy_string: str,
    targets: List[Dict],
    message_texts: List[str],
    log: Callable[[str], None],
    should_stop: Optional[Callable[[], bool]] = None,
    page: Optional[object] = None,
    user_agent: Optional[str] = None,
    cooldown_enabled: bool = True,
    cooldown_hours: int = 2,
):
    """
    Send messages to a list of target users.
    targets: List of dicts with 'user_name' and 'id'.
    message_texts: List of message variations to randomly select from.
    
    If `page` is provided, it uses the existing browser page and does NOT close it.
    """
    should_stop = should_stop or (lambda: False)
    
    if not targets:
        log("Нет пользователей для рассылки сообщений.")
        return
    client = InstagramAccountsClient()

    def _run_messaging_logic(current_page):
        run_messaging_flow(
            page=current_page,
            targets=targets,
            message_texts=message_texts,
            log=log,
            should_stop=should_stop,
            client=client,
            cooldown_enabled=cooldown_enabled,
            cooldown_hours=cooldown_hours,
        )

    if page:
        log(f"Использую существующую сессию для рассылки сообщений.")
        _run_messaging_logic(page)
        return

    log(f"[Messages] Запуск браузера для профиля: {profile_name}")

    with create_browser_context(
        profile_name=profile_name,
        proxy_string=proxy_string,
        user_agent=user_agent,
    ) as (_context, page):
        _run_messaging_logic(page)
