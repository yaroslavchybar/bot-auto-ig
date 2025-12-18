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

            # 2. Find "Follow requests" section
            # Look for text "Follow requests" or similar
            # In new UI, it might be a specific section
            log("🔍 Ищу раздел с запросами на подписку...")
            
            try:
                # We look for a link/button that contains "Follow requests"
                # Often it is at the top of notifications
                req_btn = current_page.locator('span:has-text("Follow requests")').first
                if not req_btn.is_visible():
                     req_btn = current_page.locator('div:has-text("Follow requests")').first
                
                if req_btn.is_visible():
                    log("found Нашел раздел 'Follow requests'. Кликаю...")
                    req_btn.click()
                    random_delay(2, 4)
                else:
                    log("ℹ️ Разделы с запросами на подписку не найдены.")
            except Exception as e:
                log(f"⚠️ Ошибка при поиске разделов с запросами: {e}")

            random_delay(2, 3)

            # 3. Process each follow request individually
            # Find follow request containers and process them one by one
            accounts_client = InstagramAccountsClient()

            while not should_stop():
                # Find containers that have both a username span and a Confirm button, but exclude "Suggested for you" sections
                follow_request_containers = current_page.locator('div:has(span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.xyejjpt.x15dsfln.x193iq5w.xeuugli.x1fj9vlw.x13faqbe.x1vvkbs.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x1i0vuye.xvs91rp.xo1l8bm.x1roi4f4.x1tu3fi.x3x7a5m.x10wh9bi.xpm28yp.x8viiok.x1o7cslx):has(div[role="button"]:has-text("Confirm")):not(:has-text("Suggested for you"))').all()

                if not follow_request_containers:
                    log("ℹ️ Разделов с запросами на подписку больше не найдено.")
                    break

                log(f"🔢 Найдено {len(follow_request_containers)} разделов с запросами. Обрабатываю...")

                processed_count = 0

                for container in follow_request_containers:
                    if should_stop():
                        break
                    
                    try:
                        # Extract username
                        # The username is usually in the span we targeted or a child of the container
                        # Let's try to find the username text.
                        # Usually it is a link to the profile
                        username_el = container.locator('a[role="link"]').first
                        username = username_el.get_attribute("href")
                        if username:
                            username = username.strip("/").split("/")[-1]
                        else:
                            username = "unknown"

                        log(f"👤 Обработка запроса от: {username}")
                        
                        # Find Confirm button
                        confirm_btn = container.locator('div[role="button"]:has-text("Confirm")').first
                        if not confirm_btn.is_visible():
                            # Maybe "Follow Back"? No, we filter by Confirm.
                            log(f"⚠️ Кнопка Confirm не найдена для {username}")
                            continue
                        
                        confirm_btn.click()
                        processed_count += 1
                        log(f"✅ Подтверждена заявка от {username} (#{processed_count})")

                        # Update the message field in database
                        try:
                            accounts_client.update_account_message(username, True)
                            log(f"📝 Обновлено поле message для {username}")
                        except Exception as db_e:
                            log(f"⚠️ Ошибка обновления базы данных для {username}: {db_e}")

                        random_delay(1, 2)

                    except Exception as e:
                        log(f"⚠️ Ошибка при обработке запроса: {e}")
                        continue

                if processed_count == 0:
                    log("ℹ️ Не удалось обработать ни один запрос, возможно они скрыты или уже обработаны.")
                    break

                # Scroll down a bit just in case more load?
                # Usually notifications lazy load.
                current_page.mouse.wheel(0, 500)
                random_delay(2, 3)

                # If we processed some, loop again to check for new ones (lazy loaded)
                # But prevent infinite loop if nothing changes.
                # For safety, let's just do one pass or a specific limited number of scrolls.
                # Given user request "approve following requests", often it's just the visible ones.
                # We'll break for now to avoid complexity of infinite loops.
                break

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
    ) as context:
        page = context.pages[0] if context.pages else context.new_page()
        _run_approve_logic(page)
