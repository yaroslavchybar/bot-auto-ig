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
):
    """
    Open Camoufox, navigate to notifications/activity, and approve follow requests.
    """
    should_stop = should_stop or (lambda: False)

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

        try:
            if page.url == "about:blank":
                page.goto("https://www.instagram.com", timeout=15000)
            
            random_delay(2, 4)

            # 1. Navigate to "Accounts Activity" / Notifications
            # Click the notification button on the sidebar
            log("🔔 Перехожу в уведомления...")

            try:
                # Click the notification button using aria-label
                page.locator('svg[aria-label="Notifications"]').click()
                log("✅ Кнопка уведомлений нажата.")
            except Exception as e:
                log(f"⚠️ Ошибка при клике на кнопку уведомлений: {e}")
                # Fallback: try direct navigation
                try:
                    page.goto("https://www.instagram.com/accounts/activity/", timeout=10000)
                    log("✅ Переход по прямой ссылке выполнен.")
                except Exception:
                    log("❌ Не удалось перейти в уведомления.")
                    return

            page.wait_for_load_state("domcontentloaded")
            random_delay(3, 5)

            # 2. Expand "Follow request" sections first
            # The follow requests are initially collapsed under headers that need to be clicked
            log("🔍 Ищу разделы с запросами на подписку...")
            try:
                follow_request_sections = page.locator('span:has-text("Follow request")').all()
                if follow_request_sections:
                    log(f"📂 Найдено {len(follow_request_sections)} разделов с запросами на подписку. Разворачиваю...")
                    for section in follow_request_sections:
                        try:
                            section.click()
                            random_delay(0.5, 1)
                        except Exception as e:
                            log(f"⚠️ Ошибка при клике на раздел: {e}")
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
                follow_request_containers = page.locator('div:has(span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.xyejjpt.x15dsfln.x193iq5w.xeuugli.x1fj9vlw.x13faqbe.x1vvkbs.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x1i0vuye.xvs91rp.xo1l8bm.x1roi4f4.x1tu3fi.x3x7a5m.x10wh9bi.xpm28yp.x8viiok.x1o7cslx):has(div[role="button"]:has-text("Confirm")):not(:has-text("Suggested for you"))').all()

                if not follow_request_containers:
                    log("ℹ️ Разделов с запросами на подписку больше не найдено.")
                    break

                log(f"🔢 Найдено {len(follow_request_containers)} разделов с запросами. Обрабатываю...")

                processed_count = 0

                for container in follow_request_containers:
                    if should_stop():
                        break

                    try:
                        # Check if this container is within a "Suggested for you" section
                        # Look for any ancestor that contains "Suggested for you" text
                        suggested_section = container.locator('xpath=ancestor-or-self::*[contains(text(), "Suggested for you")]').first
                        if suggested_section.count() > 0:
                            log("🚫 Пропускаю аккаунт из раздела 'Suggested for you'")
                            continue

                        # Extract username from the container
                        # Look for all text spans and find the one that looks like a username
                        all_spans = container.locator('span').all()
                        username = None

                        for span in all_spans:
                            text = span.text_content().strip()
                            # Username is typically shorter, no spaces, might start with @, or be lowercase
                            if text and len(text) < 30 and (' ' not in text or text.startswith('@')):
                                # Skip if it contains numbers and looks like a display name
                                if ' ' in text and any(char.isdigit() for char in text):
                                    continue
                                # Prefer text that starts with @ or looks like username (lowercase, no spaces)
                                if text.startswith('@') or (text.islower() and ' ' not in text):
                                    username = text.lstrip('@')  # Remove @ if present
                                    break

                        if not username:
                            # Fallback to the original selector if we can't find a good username
                            username_element = container.locator('span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.xyejjpt.x15dsfln.x193iq5w.xeuugli.x1fj9vlw.x13faqbe.x1vvkbs.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.x1i0vuye.xvs91rp.xo1l8bm.x1roi4f4.x1tu3fi.x3x7a5m.x10wh9bi.xpm28yp.x8viiok.x1o7cslx').first
                            username = username_element.text_content().strip()
                        if not username:
                            log("⚠️ Не удалось извлечь имя пользователя, пропускаю...")
                            continue

                        log(f"👤 Обрабатываю запрос от: {username}")

                        # Find and click the Confirm button within this container
                        confirm_btn = container.locator('div[role="button"]:has-text("Confirm")').first

                        if not confirm_btn.is_visible():
                            log(f"⚠️ Кнопка подтверждения для {username} не видна, пропускаю...")
                            continue

                        # Click Confirm
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
                page.mouse.wheel(0, 500)
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
