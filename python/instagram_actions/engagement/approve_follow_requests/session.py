from typing import Callable, Optional

from python.browser_control.browser_setup import create_browser_context
from python.database_sync.accounts_client import InstagramAccountsClient

from python.instagram_actions.engagement.approve_follow_requests.flow import run_approve_follow_requests

def approve_follow_requests(
    profile_name: str,
    proxy_string: str,
    log: Callable[[str], None],
    should_stop: Optional[Callable[[], bool]] = None,
    page: Optional[object] = None,
    user_agent: Optional[str] = None,
):
    """
    Open Camoufox, navigate to notifications/activity, and approve follow requests.
    
    If `page` is provided, it uses the existing browser page and does NOT close it.
    """
    should_stop = should_stop or (lambda: False)
    client = InstagramAccountsClient()

    def _run_approve_logic(current_page):
        run_approve_follow_requests(
            page=current_page,
            client=client,
            log=log,
            should_stop=should_stop,
        )

    if page:
        log(f"Использую существующую сессию для подтверждения заявок.")
        _run_approve_logic(page)
        return

    log(f"[Approve] Запуск браузера для профиля: {profile_name}")

    with create_browser_context(
        profile_name=profile_name,
        proxy_string=proxy_string,
        user_agent=user_agent,
    ) as (_context, page):
        _run_approve_logic(page)
