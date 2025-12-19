import random
from typing import Callable, Optional

from camoufox import Camoufox
from automation.actions import random_delay
from automation.Follow.utils import (
    build_proxy_config,
    ensure_profile_path,
)
from supabase.instagram_accounts_client import InstagramAccountsClient

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

    def _run_approve_logic(current_page):
        try:
            if current_page.url == "about:blank":
                current_page.goto("https://www.instagram.com", timeout=15000)
            
            random_delay(2, 4)

            # 1. Navigate to "Accounts Activity" / Notifications
            # Click the notification button on the sidebar
            log("🔔 Перехожу в уведомления...")

            try:
                # Click the notification button using aria-label
                current_page.locator('svg[aria-label="Notifications"]').click()
                random_delay(3, 5)
            except Exception as e:
                log(f"⚠️ Не нашел кнопку уведомлений: {e}")
                # Try direct URL fallback?
                # current_page.goto("https://www.instagram.com/accounts/activity/")
                return

            # 2. Process requests directly in popup
            log("🔍 Ищу запросы на подписку в уведомлениях...")
            
            confirm_buttons = current_page.locator('div[role="button"]:has-text("Confirm")').all()

            if confirm_buttons:
                log(f"🔢 Найдено {len(confirm_buttons)} кнопок Confirm. Подтверждаю...")
                for btn in confirm_buttons:
                    if should_stop():
                        break
                    try:
                        if btn.is_visible():
                            btn.click()
                            log("✅ Подтверждена заявка")
                            random_delay(1, 2)
                    except Exception as e:
                        log(f"⚠️ Ошибка при подтверждении: {e}")
            else:
                log("ℹ️ Кнопки Confirm не найдены.")

            # Always try to close the popup after processing
            log("🔒 Закрываю окно уведомлений...")
            close_btn = current_page.locator('div[aria-label="Close"][role="button"]').first
            if close_btn.is_visible():
                close_btn.click()
            
            log("⏳ Ожидание 3 секунды перед закрытием сессии...")
            random_delay(3, 3)

            log("✅ Обработка уведомлений завершена.")

        except Exception as e:
            log(f"❌ Ошибка в процессе подтверждения: {e}")

    if page:
        log(f"🔄 Использую существующую сессию для подтверждения заявок.")
        _run_approve_logic(page)
        return

    profile_path = ensure_profile_path(profile_name)
    proxy_config = build_proxy_config(proxy_string)

    log(f"🧭 [Approve] Запуск браузера для профиля: {profile_name}")

    with Camoufox(
        headless=False,
        user_data_dir=profile_path,
        persistent_context=True,
        proxy=proxy_config,
        geoip=False,
        block_images=False, # Need images/icons to identify buttons sometimes
        os="windows",
        window=(1280, 800),
        humanize=True,
        user_agent=user_agent,
    ) as context:
        page = context.pages[0] if context.pages else context.new_page()
        _run_approve_logic(page)
