import random
import time
from typing import Callable, Iterable, List, Optional, Tuple

from python.instagram_actions.actions import random_delay
from python.browser_control.browser_setup import create_browser_context

def unfollow_usernames(
    profile_name: str,
    proxy_string: str,
    usernames: Iterable[str],
    log: Callable[[str], None],
    should_stop: Optional[Callable[[], bool]] = None,
    delay_range: Tuple[int, int] = (10, 30),
    on_success: Optional[Callable[[str], None]] = None,
    page: Optional[object] = None,
    user_agent: Optional[str] = None,
):
    """
    Open Camoufox profile, navigate to own profile -> Following -> Search & Unfollow.
    
    If `page` is provided, it uses the existing browser page and does NOT close it.
    """
    should_stop = should_stop or (lambda: False)
    min_delay, max_delay = delay_range

    # Filter out empty usernames
    target_usernames = [u.strip() for u in usernames if u.strip()]
    if not target_usernames:
        log("Нет юзернеймов для отписки.")
        return

    def _run_unfollow_logic(current_page):
        try:
            if current_page.url == "about:blank":
                current_page.goto("https://www.instagram.com", timeout=15000)
            
            # 1. Go to own profile
            log("Ищу ссылку на свой профиль...")
            try:
                # Target the image inside the "Profile" link (sidebar).
                # We filter by text "Profile" to distinguish from Stories avatars.
                # The text might be hidden, but Playwright's text filter finds it in the DOM.
                profile_pic = current_page.locator('a[role="link"]').filter(has_text="Profile").locator('img').first
                
                # Wait for it to be ready
                profile_pic.wait_for(state="visible", timeout=10000)
                
                # Manual mouse movement to the element
                box = profile_pic.bounding_box()
                if box:
                    log("Двигаю курсор к аватару...")
                    x = box["x"] + box["width"] / 2
                    y = box["y"] + box["height"] / 2
                    current_page.mouse.move(x, y)
                    random_delay(0.5, 1.5)
                
                log(f"Кликаю на аватар...")
                # Force click to bypass 'not enabled' checks if it's acting up
                profile_pic.click(force=True)
                
                # Wait for navigation
                current_page.wait_for_load_state("domcontentloaded")

            except Exception as e:
                log(f"Не смог найти ссылку через аватар ({e}). Пробую запасной вариант...")
                try:
                    # Fallback: Try clicking standard "Profile" text even if hidden (force=True)
                    current_page.locator('a[role="link"] >> text=Profile').click(force=True, timeout=5000)
                except Exception as e2:
                    log(f"Не удалось перейти в профиль: {e2}")
                    return

            random_delay(3, 5)

            # 2. Click "Following"
            log("list Открываю список подписок...")
            # Typically a link with text "following" inside a ul/li
            try:
                current_page.click('a[href*="/following/"]', timeout=5000)
            except:
                log("Не нашел кнопку 'Following'.")
                return
            
            random_delay(2, 4)

            # 3. Wait for modal
            # The modal usually has role="dialog" and a title "Following"
            try:
                modal = current_page.wait_for_selector('div[role="dialog"]', timeout=5000)
                if not modal:
                    log("Модальное окно не появилось.")
                    return
            except:
                log("Ошибка ожидания модального окна.")
                return

            # 4. Search and Unfollow Loop
            search_input_selector = 'input[placeholder="Search"]'
            
            for username in target_usernames:
                if should_stop():
                    log("Остановка...")
                    break
                
                log(f"Ищу {username}...")
                
                # Clear previous search if any
                try:
                    current_page.fill(search_input_selector, "")
                    random_delay(0.5, 1.0)
                    current_page.type(search_input_selector, username, delay=100)
                except:
                    log("Не нашел поле поиска.")
                    break

                random_delay(2, 4) # wait for results

                # Find the user row. 
                # We expect a row that contains the username and a button.
                # Simplest verification: look for the username text in the dialog.
                # Also ensure it's not "No results found".
                
                try:
                    # Strategy: Get the container for the specific user.
                    # We look for a div that contains BOTH the username and the "Following" button text.
                    # .last helps us get the most specific container (the row) rather than the whole dialog.
                    user_row = current_page.locator('div[role="dialog"] >> div').filter(has_text=username).filter(has_text="Following").last
                    
                    # Inside this row, find the button that says "Following".
                    unfollow_btn = user_row.locator('button').filter(has_text="Following").first
                    
                    if unfollow_btn.count() > 0:
                        log(f"found Нашел кнопку Following для {username}. Кликаю...")
                        unfollow_btn.click()
                        
                        random_delay(1, 2)
                        
                        # Handle Confirmation Dialog ("Unfollow @username?")
                        try:
                            # Wait specifically for the confirmation button to appear.
                            # We use a filter to find the button with exact text "Unfollow"
                            # This avoids the invalid syntax error from before.
                            confirm_btn = current_page.locator('button').filter(has_text="Unfollow").last
                            confirm_btn.wait_for(state="visible", timeout=5000)
                            
                            log(f"Подтверждаю отписку...")
                            confirm_btn.click()
                            
                            log(f"Отписался от {username}")
                            if on_success:
                                on_success(username)
                        except Exception:
                            # Maybe no confirmation needed, or we missed it.
                            # Check if we are still following?
                            # For now, just log warning.
                            log(f"Подтверждение не появилось или ошибка клика для {username}")
                    
                    else:
                        log(f"Не нашел кнопку 'Following' для {username}. Возможно уже отписан.")

                except Exception as e:
                    log(f"Ошибка при обработке {username}: {e}")

                # Clear search
                try:
                    current_page.fill(search_input_selector, "")
                except:
                    pass

                # Delay before next
                wait_time = random.randint(min_delay, max_delay)
                log(f"Жду {wait_time}сек...")
                random_delay(wait_time, wait_time)

            # 5. Close the "Following" modal
            log("Closing 'Following' modal...")
            try:
                # Look for button containing the Close SVG
                # We use the SVG selector as requested by the user
                close_btn = current_page.locator('button').filter(has=current_page.locator('svg[aria-label="Close"]')).last
                if close_btn.count() > 0:
                        close_btn.click()
                        log("Closed modal.")
                else:
                        log("Close button not visible.")
            except Exception as e:
                log(f"Failed to close modal: {e}")

        except Exception as e:
            log(f"Критическая ошибка сессии: {e}")

    if page:
        log(f"Использую существующую сессию для отписки...")
        _run_unfollow_logic(page)
        return
    
    log(f"Запуск браузера для профиля: {profile_name}")

    with create_browser_context(
        profile_name=profile_name,
        proxy_string=proxy_string,
        user_agent=user_agent,
    ) as (_context, page):
        _run_unfollow_logic(page)

    log("Сессия завершена.")
