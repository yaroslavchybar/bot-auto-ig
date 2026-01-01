import os
import random
import datetime
from typing import Callable, List, Dict, Optional

from python.automation.actions import random_delay
from python.automation.browser import create_browser_context
from python.supabase.instagram_accounts_client import InstagramAccountsClient
from python.supabase.message_templates_client import MessageTemplatesClient
from python.core.automation.selectors import (
    MESSAGE_BUTTON, 
    NOT_NOW_BUTTON, 
    SEND_MESSAGE_BUTTON
)

def load_message_2_texts() -> List[str]:
    try:
        cloud = MessageTemplatesClient().get_texts("message_2")
        if cloud:
            return cloud
    except Exception:
        pass
    return ["Hi there! Thanks for reaching out!"]


def detect_incoming_messages(page) -> bool:
    """
    Check if there are any incoming messages in the current chat.
    Returns True if incoming messages are detected.
    """
    try:
        # Look for incoming message indicators
        # Incoming messages typically have sender names that are not "You sent"
        incoming_selectors = [
            'h6:has-text("You sent")',  # This will be our sent messages
        ]

        # Count total messages and our sent messages
        total_messages = page.locator('[role="row"]').count()
        our_messages = page.locator('h6:has-text("You sent")').count()

        # If there are messages and not all are from us, there are incoming messages
        if total_messages > 0 and our_messages < total_messages:
            return True

        # Alternative check: look for messages that don't contain "You sent"
        all_sender_elements = page.locator('h6').all_text_contents()
        for sender in all_sender_elements:
            if sender and "You sent" not in sender:
                return True

        return False

    except Exception as e:
        print(f"Error detecting incoming messages: {e}")
        return False


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

    def _run_messaging_logic(page):
        try:
            if page.url == "about:blank":
                page.goto("https://www.instagram.com", timeout=15000)

            random_delay(2, 4)

            # Navigate to Direct Inbox using sidebar Messages button
            log("Перехожу в Direct Inbox через кнопку Messages...")

            # Wait for page to fully load
            page.wait_for_load_state('networkidle', timeout=15000)

            # Try to find Messages button using semantic selector
            messages_button = MESSAGE_BUTTON.find(page)
            
            # Fallback legacy strategies if SemanticSelector fails or needs augmentation
            if not messages_button:
                 # Selector 1: Direct href link
                try:
                    messages_button = page.locator('a[href="/direct/inbox/"]').first
                    if not messages_button.is_visible(timeout=3000):
                        messages_button = None
                except:
                    messages_button = None

            if not messages_button:
                 # Selector 2: Aria label containing "Direct messaging"
                try:
                    messages_button = page.locator('a[aria-label*="Direct messaging"]').first
                    if not messages_button.is_visible(timeout=3000):
                        messages_button = None
                except:
                    messages_button = None

            if not messages_button:
                 # Selector 3: SVG with Messages aria-label
                try:
                    messages_button = page.locator('svg[aria-label="Messages"]').locator('xpath=ancestor::a').first
                    if not messages_button.is_visible(timeout=3000):
                        messages_button = None
                except:
                    messages_button = None
            
            if not messages_button:
                 # Selector 4: Look for any link containing "direct" in href
                try:
                    messages_button = page.locator('a[href*="direct"]').first
                    if not messages_button.is_visible(timeout=3000):
                        messages_button = None
                except:
                    messages_button = None

            if messages_button:
                # Use cursor to click on the Messages button
                messages_button.click()
                log("Кликнул на кнопку Messages в сайдбаре")

                # Wait for navigation to complete
                page.wait_for_load_state('networkidle', timeout=10000)
                log("Переход в Direct Inbox завершен")
            else:
                raise Exception("Не удалось найти кнопку Messages в сайдбаре")

            random_delay(3, 5) # wait longer for first load

            # Handle "Turn on Notifications" popup if it appears
            try:
                not_now_btn = NOT_NOW_BUTTON.find(page)
                if not_now_btn:
                    not_now_btn.click()
                    random_delay(1, 2)
            except:
                pass

            # Load alternative messages for when users message first
            message_2_texts = load_message_2_texts()
            log(f"Загружено {len(message_2_texts)} альтернативных сообщений из базы")

            processed_count = 0

            for target in targets:
                if should_stop():
                    break
                
                username = target.get("user_name")
                account_id = target.get("id")
                
                if not username:
                    continue

                log(f"Обработка сообщения для: {username}")
                
                try:
                    last_sent_str = client.get_last_message_sent_at(account_id)
                    if last_sent_str:
                        try:
                            last_sent_dt = datetime.datetime.fromisoformat(str(last_sent_str).replace("Z", "+00:00"))
                        except Exception:
                            last_sent_dt = None
                        if last_sent_dt:
                            now = datetime.datetime.now(datetime.timezone.utc)
                            delta = now - last_sent_dt
                            if cooldown_enabled and cooldown_hours > 0 and delta.total_seconds() < cooldown_hours * 3600:
                                log(f"Пропускаю {username}: последнее сообщение {int(delta.total_seconds()//60)} мин назад")
                                continue
                except Exception as e:
                    log(f"Не удалось проверить время последней отправки для {username}: {e}")

                try:
                    # 1. Click on the search input field to start a new conversation
                    # The search field opens the user selection modal

                    # Find and click the search input in Direct inbox
                    search_input = page.locator('input[name="searchInput"]').first
                    if not search_input.is_visible():
                        # Fallback: try to find by placeholder
                        search_input = page.locator('input[placeholder="Search"]').first

                    if not search_input.is_visible():
                        # Another fallback: find the label containing the search input
                        search_input = page.locator('label input[placeholder="Search"]').first

                    if search_input.is_visible():
                        search_input.click()
                        log("Кликнул на поле поиска для начала нового сообщения")
                    else:
                        log(f"Поле поиска не найдено, пропускаю {username}...")
                        continue

                    # Wait for modal to open
                    random_delay(3, 4)

                    # 2. Now search for user in the opened modal
                    # Try multiple selectors for the modal search input
                    modal_search = None

                    # Try common selectors for modal search input
                    selectors_to_try = [
                        'input[name="queryBox"]',
                        'input[placeholder="Search..."]',
                        'input[placeholder*="Search"]',
                        'input[aria-label*="Search"]',
                        'input[type="text"]',
                        'input[role="textbox"]'
                    ]

                    for selector in selectors_to_try:
                        try:
                            modal_search = page.locator(selector).first
                            if modal_search.is_visible(timeout=2000):
                                log(f"Найдено поле поиска в модале: {selector}")
                                break
                        except:
                            continue

                    if not modal_search or not modal_search.is_visible():
                        log(f"Поле поиска в модальном окне не найдено, пропускаю {username}...")
                        # Try to close modal by pressing Escape
                        page.keyboard.press("Escape")
                        random_delay(1, 2)
                        continue

                    # Clear and type the username
                    modal_search.clear()
                    random_delay(0.5, 1)
                    modal_search.type(username, delay=random.randint(100, 200))
                    log(f"Набрал имя пользователя: {username}")

                    random_delay(2, 3)
                        
                    search_input.fill(username)
                    random_delay(2, 3)
                    
                    # 3. Select user from results
                    # The result usually has the username text or checks a radio button
                    # Wait for results
                    try:
                        # Find the specific user row. It usually contains the text username.
                        # We want to click the row that matches exactly if poss, or the first valid one.
                        # Let's find a div that contains the text
                        user_row = page.locator(f'div[role="button"]:has-text("{username}")').first

                        # Sometimes it's a checkbox (circle)
                        if user_row.is_visible(timeout=5000):
                            user_row.click()
                            log(f"Выбрал пользователя: {username}")
                            random_delay(2, 4) # Wait for chat to open

                            # Check for incoming messages before sending
                            has_incoming = detect_incoming_messages(page)
                            if has_incoming:
                                log(f"Обнаружены входящие сообщения от {username}, отправляю альтернативное сообщение")
                            else:
                                log(f"Входящих сообщений от {username} не обнаружено, отправляю обычное сообщение")

                            # 4. Type and Send Message
                            # In Instagram Direct, after selecting user, chat opens immediately
                            # Find the message input area
                            msg_box = None

                            # Try multiple selectors for the message input
                            msg_selectors = [
                                'div[role="textbox"][contenteditable="true"]',
                                'div[aria-label="Message"][contenteditable="true"]',
                                'div[aria-placeholder="Message..."][contenteditable="true"]',
                                '[data-lexical-editor="true"]'
                            ]

                            for selector in msg_selectors:
                                try:
                                    msg_box = page.locator(selector).first
                                    if msg_box.is_visible(timeout=3000):
                                        log(f"Найдено поле ввода сообщения: {selector}")
                                        break
                                except:
                                    continue

                            if msg_box and msg_box.is_visible():
                                # Click on the message box to focus it
                                msg_box.click()
                                random_delay(0.5, 1)

                                # Select message based on whether incoming messages were detected
                                if has_incoming:
                                    selected_message = random.choice(message_2_texts)
                                    log(f"Использую альтернативное сообщение: {selected_message[:50]}...")
                                else:
                                    selected_message = random.choice(message_texts)
                                    log(f"Использую обычное сообщение: {selected_message[:50]}...")

                                # Type the message with human-like delays
                                msg_box.type(selected_message, delay=random.randint(100, 200))
                                log(f"Набрал сообщение: {selected_message}")

                                random_delay(1, 2)

                                # Find and click the Send button
                                send_btn = page.locator('div[role="button"]:has-text("Send")').first
                                if not send_btn.is_visible():
                                    # Try alternative selector
                                    send_btn = page.locator('button:has-text("Send")').first

                                if send_btn.is_visible():
                                    try:
                                        send_btn.click(timeout=3000)
                                    except:
                                        random_delay(5, 5)
                                        page.keyboard.press("Enter")
                                    log(f"Отправил сообщение для {username}")

                                    # Update DB based on message type
                                    try:
                                        if has_incoming:
                                            client.update_account_link_sent(username, "done")
                                            log(f"{username}: link_sent -> done (альтернативное сообщение отправлено)")
                                        else:
                                            client.update_account_link_sent(username, "needed to send")
                                            log(f"{username}: link_sent -> needed to send")
                                        client.set_last_message_sent_now(account_id)
                                        log(f"{username}: обновлено время последней отправки")
                                    except Exception as db_e:
                                        log(f"Ошибка БД для {username}: {db_e}")

                                    processed_count += 1
                                else:
                                    log(f"Кнопка Send не найдена для {username}")
                            else:
                                log(f"Не удалось найти поле ввода сообщения для {username}")

                        else:
                            log(f"Пользователь {username} не найден в поиске.")
                            # Close modal by pressing Escape
                            page.keyboard.press("Escape")

                    except Exception as e:
                         log(f"Ошибка при выборе пользователя {username}: {e}")
                         # Close modal by pressing Escape
                         page.keyboard.press("Escape")

                    random_delay(3, 5) # Delay between messages

                except Exception as e:
                    log(f"Ошибка в процессе отправки для {username}: {e}")
                    # Try to recover navigation
                    try:
                        page.goto("https://www.instagram.com/direct/inbox/", timeout=10000)
                    except:
                        pass
            
            log(f"Рассылка завершена. Отправлено: {processed_count}")

        except Exception as e:
            log(f"Критическая ошибка браузера: {e}")
        
        try:
            log("Messages: возвращаюсь домой")
            try:
                svg = page.query_selector('svg[aria-label="Home"]')
                if svg:
                    btn = svg.query_selector('xpath=ancestor-or-self::*[@role="link"][1]') or svg.query_selector('xpath=ancestor-or-self::*[@role="button"][1]')
                    (btn or svg).click()
                else:
                    link = page.query_selector('a[role="link"][href="/"]')
                    if link:
                        link.click()
                    else:
                        page.goto("https://www.instagram.com/", timeout=20000)
            except Exception:
                page.goto("https://www.instagram.com/", timeout=20000)
            random_delay(1.0, 2.0)
            try:
                close_svg = page.query_selector('svg[aria-label="Close"]')
                if close_svg:
                    close_btn = close_svg.query_selector('xpath=ancestor-or-self::*[self::button or @role="button"][1]') or close_svg.query_selector('xpath=ancestor-or-self::*[self::div][1]')
                    (close_btn or close_svg).click()
                    log("Messages: закрыл всплывающее окно")
                else:
                    page.keyboard.press("Escape")
            except Exception:
                try:
                    page.keyboard.press("Escape")
                except Exception:
                    pass
            random_delay(0.6, 1.2)
        except Exception as e:
            log(f"Messages: ошибка очистки: {e}")

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
