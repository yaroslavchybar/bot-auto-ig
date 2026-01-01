import random
import re
from typing import Callable, Optional

from python.automation.actions import random_delay
from python.automation.browser import create_browser_context
from python.supabase.instagram_accounts_client import InstagramAccountsClient

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
        try:
            if current_page.url == "about:blank":
                current_page.goto("https://www.instagram.com", timeout=15000)
            
            random_delay(2, 4)

            # 1. Navigate to "Accounts Activity" / Notifications
            # Click the notification button on the sidebar
            log("Перехожу в уведомления...")

            try:
                # Click the notification button using aria-label
                current_page.locator('svg[aria-label="Notifications"]').click()
                random_delay(3, 5)
            except Exception as e:
                log(f"Не нашел кнопку уведомлений: {e}")
                try:
                    current_page.goto("https://www.instagram.com/accounts/activity/", timeout=15000)
                    random_delay(2, 4)
                except Exception:
                    return

            log("Ищу 'Follow request' и открываю список заявок...")
            opened_panel = False
            try:
                el = current_page.locator('text=Follow request').first
                if el and el.is_visible():
                    el.click()
                    random_delay(2, 3)
                    opened_panel = True
            except Exception:
                pass
            if not opened_panel:
                try:
                    el2 = current_page.locator('span:has-text("Follow request")').first
                    if el2 and el2.is_visible():
                        el2.click()
                        random_delay(2, 3)
                        opened_panel = True
                except Exception:
                    pass
            if not opened_panel:
                log("Не удалось открыть список заявок, продолжаю поиск Confirm.")
            
            confirm_buttons = current_page.locator('div[role="button"]:has-text("Confirm")').all()

            if confirm_buttons:
                log(f"Найдено {len(confirm_buttons)} кнопок Confirm. Подтверждаю...")
                for btn in confirm_buttons:
                    if should_stop():
                        break
                    try:
                        if btn.is_visible():
                            username = None
                            try:
                                row = btn.locator(
                                    'xpath=ancestor::*[.//div[@role="button" and normalize-space()="Delete"] and .//a[@role="link" and starts-with(@href, "/")]][1]'
                                ).first

                                if not row.is_visible():
                                    log("Skipping row without Delete button (Suggested for you?)")
                                    continue

                                link = row.locator('xpath=.//a[@role="link" and starts-with(@href, "/")][1]').first
                                href = link.get_attribute('href') if link.is_visible() else None
                                if href:
                                    href = href.strip()
                                    parts = [p for p in href.split("/") if p]
                                    if parts:
                                        username = parts[0]
                            except Exception as e:
                                log(f"Extraction error: {e}")
                                username = None

                            if username:
                                log(f"Found username: {username}")

                            btn.click()
                            if username:
                                try:
                                    res = client.update_account_message(username, True)
                                    if res:
                                        log(f"Updated message for @{username}")
                                    else:
                                        log(f"Database update failed for @{username} (No match in DB?)")
                                except Exception as e:
                                    log(f"API Error updating message for @{username}: {e}")
                            log("Подтверждена заявка")
                            random_delay(1, 2)
                    except Exception as e:
                        log(f"Ошибка при подтверждении: {e}")
            else:
                log("Кнопки Confirm не найдены.")

            # Always try to close the popup after processing
            log("Закрываю окно уведомлений...")
            close_btn = current_page.locator('div[aria-label="Close"][role="button"]').first
            if close_btn.is_visible():
                close_btn.click()
            else:
                log("Кнопка закрытия не найдена, кликаю уведомления для закрытия...")
                try:
                    current_page.locator('svg[aria-label="Notifications"]').click()
                    random_delay(1, 2)
                except Exception as e:
                    log(f"Не удалось закрыть уведомления кликом: {e}")
            
            log("Ожидание 3 секунды перед закрытием сессии...")
            random_delay(3, 3)

            log("Обработка уведомлений завершена.")

        except Exception as e:
            log(f"Ошибка в процессе подтверждения: {e}")

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
