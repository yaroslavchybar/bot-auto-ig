import random
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from camoufox import Camoufox

from automation.actions import random_delay
from automation.Follow.controls import find_follow_control
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
):
    """Open Camoufox profile and follow each username."""
    should_stop = should_stop or (lambda: False)
    interactions_config = interactions_config or {}
    highlights_range = interactions_config.get("highlights_range", (2, 4))
    likes_range = interactions_config.get("likes_range", (1, 1))

    profile_path = ensure_profile_path(profile_name)
    proxy_config = build_proxy_config(proxy_string)
    clean_usernames_list: List[str] = clean_usernames(usernames)

    if not clean_usernames_list:
        log("⚠️ Нет валидных юзернеймов для подписки.")
        return

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
    ) as context:
        page = context.pages[0] if context.pages else context.new_page()

        try:
            if page.url == "about:blank":
                page.goto("https://www.instagram.com", timeout=15000)
        except Exception:
            pass

        for username in clean_usernames_list:
            if should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                break

            try:
                log(f"➡️ Открываю @{username}")
                page.goto(f"https://www.instagram.com/{username}/", timeout=20000, wait_until="domcontentloaded")
                random_delay(1, 2)

                if should_skip_by_following(page, username, following_limit, log):
                    if on_skip:
                        try:
                            on_skip(username)
                        except Exception as callback_err:
                            log(f"⚠️ Не удалось обновить статус пропуска @{username}: {callback_err}")
                    continue

                # Light interactions before follow
                pre_follow_interactions(
                    page,
                    log,
                    highlights_range=highlights_range,
                    likes_range=likes_range,
                )

                state, btn = find_follow_control(page)
                if state in ("requested", "following"):
                    log(f"ℹ️ Уже подписаны/запрошено для @{username} ({state}).")
                    call_on_success(on_success, username, log)
                    continue

                if state == "follow" and btn:
                    try:
                        btn.click(force=True)
                        log(f"✅ Подписался на @{username}")
                        call_on_success(on_success, username, log)
                    except Exception as click_err:
                        log(f"❌ Ошибка клика для @{username}: {click_err}")
                else:
                    log(f"ℹ️ Не нашел кнопку Follow для @{username} (возможно уже подписаны)")
            except Exception as err:
                log(f"❌ Ошибка для @{username}: {err}")

            if should_stop():
                log("⏹️ Остановка по запросу пользователя.")
                break

            random_delay(1, 3)
            time_pause = random.uniform(1.5, 3.0)
            random_delay(time_pause, time_pause + 1.5)

    log("🏁 Сессия завершена.")

