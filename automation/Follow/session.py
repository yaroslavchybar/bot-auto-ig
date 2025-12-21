import random
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from camoufox import Camoufox

from automation.actions import random_delay
from automation.Follow.controls import find_follow_control, wait_for_follow_state
from automation.Follow.filter import should_skip_by_following
from automation.Follow.interactions import pre_follow_interactions
from automation.Follow.utils import (
    build_proxy_config,
    call_on_success,
    clean_usernames,
    ensure_profile_path,
)


def follow_usernames(
    profile_name: str,
    proxy_string: str,
    usernames: Iterable[str],
    log: Callable[[str], None],
    should_stop: Optional[Callable[[], bool]] = None,
    following_limit: Optional[int] = None,
    on_success: Optional[Callable[[str], None]] = None,
    on_skip: Optional[Callable[[str], None]] = None,
    interactions_config: Optional[Dict[str, Tuple[int, int]]] = None,
    page: Optional[object] = None,
    user_agent: Optional[str] = None,
):
    """Open Camoufox profile and follow each username.
    
    If `page` is provided, it uses the existing browser page and does NOT close it.
    """
    should_stop = should_stop or (lambda: False)
    interactions_config = interactions_config or {}
    highlights_range = interactions_config.get("highlights_range", (2, 4))
    likes_percentage = interactions_config.get("likes_percentage", 0)
    scroll_percentage = interactions_config.get("scroll_percentage", 0)

    clean_usernames_list: List[str] = clean_usernames(usernames)

    if not clean_usernames_list:
        log("⚠️ Нет валидных юзернеймов для подписки.")
        return

    def _run_follow_logic(current_page):
        try:
            if current_page.url == "about:blank":
                current_page.goto("https://www.instagram.com", timeout=15000)
        except Exception:
            pass

        for username in clean_usernames_list:
            if should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                break

            try:
                log(f"➡️ Открываю @{username}")
                current_page.goto(f"https://www.instagram.com/{username}/", timeout=20000, wait_until="domcontentloaded")
                random_delay(1, 2)

                if should_skip_by_following(current_page, username, following_limit, log):
                    if on_skip:
                        try:
                            on_skip(username)
                        except Exception as callback_err:
                            log(f"⚠️ Не удалось обновить статус пропуска @{username}: {callback_err}")
                    continue

                # Light interactions before follow
                pre_follow_interactions(
                    current_page,
                    log,
                    highlights_range=highlights_range,
                    likes_percentage=likes_percentage,
                    scroll_percentage=scroll_percentage,
                    should_stop=should_stop,
                )

                if should_stop():
                    log("⏹️ Остановка по запросу пользователя.")
                    break

                state, btn = find_follow_control(current_page)
                if state in ("requested", "following"):
                    log(f"ℹ️ Уже подписаны/запрошено для @{username} ({state}).")
                    call_on_success(on_success, username, log)
                    continue

                if btn:
                    log(f"➕ Нажимаю Follow на @{username}...")
                    btn.click()
                    random_delay(1, 2)
                    state_after = wait_for_follow_state(current_page, timeout_ms=8000)
                    if state_after in ("requested", "following"):
                        log(f"✅ Успешная подписка на @{username}")
                        call_on_success(on_success, username, log)
                    else:
                        log(f"⚠️ Статус не изменился после клика для @{username} ({state_after})")
                else:
                    log(f"⚠️ Не нашел кнопку Follow для @{username}")

            except Exception as e:
                log(f"❌ Ошибка при обработке @{username}: {e}")
                random_delay(2, 5)

            # Random delay between users
            random_delay(10, 20)

    if page:
        log(f"🔄 Использую существующую сессию для подписки ({len(clean_usernames_list)} чел.)")
        _run_follow_logic(page)
        return

    profile_path = ensure_profile_path(profile_name)
    proxy_config = build_proxy_config(proxy_string)
    
    log(f"🧭 Стартую Camoufox для профиля {profile_name}")

    with Camoufox(
        headless=False,
        user_data_dir=profile_path,
        persistent_context=True,
        proxy=proxy_config,
        geoip=False,
        block_images=False,
        os="windows",
        window=(1280, 800),
        humanize=True,
        user_agent=user_agent,
    ) as context:
        page = context.pages[0] if context.pages else context.new_page()
        _run_follow_logic(page)
    
    log("🏁 Сессия завершена.")
