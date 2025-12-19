from typing import List, Optional, Tuple
from PyQt6.QtCore import QThread, pyqtSignal

from automation.Follow.session import follow_usernames
from supabase.instagram_accounts_client import (
    InstagramAccountsClient,
    InstagramAccountsError,
)


class FollowWorker(QThread):
    """Worker that follows a list of usernames using a specific profile."""

    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()

    def __init__(self, profile_name: str, proxy: str, usernames: List[str]):
        super().__init__()
        self.profile_name = profile_name
        self.proxy = proxy
        self.usernames = usernames
        self.running = True

    def run(self):
        try:
            follow_usernames(
                profile_name=self.profile_name,
                proxy_string=self.proxy,
                usernames=self.usernames,
                log=self.log,
                should_stop=lambda: not self.running,
            )
        except Exception as err:
            self.log(f"❌ Ошибка: {err}")
        finally:
            self.finished_signal.emit()

    def stop(self):
        self.running = False

    def log(self, message: str):
        self.log_signal.emit(message)


class AutoFollowWorker(QThread):
    """Worker that loops through all profiles with assigned accounts."""

    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()

    def __init__(
        self,
        highlights_range: Optional[Tuple[int, int]] = None,
        likes_range: Optional[Tuple[int, int]] = None,
        following_limit: Optional[int] = None,
    ):
        super().__init__()
        self.running = True
        self.client = InstagramAccountsClient()
        self.highlights_range = self._normalize_range(highlights_range, (2, 4))
        self.likes_range = self._normalize_range(likes_range, (1, 1))
        try:
            self.following_limit = int(following_limit) if following_limit is not None else None
        except Exception:
            self.following_limit = None

    def run(self):
        try:
            profiles = self.client.get_profiles_with_assigned_accounts()
        except InstagramAccountsError as err:
            self.log(f"❌ Ошибка Supabase (profiles): {err}")
            self.finished_signal.emit()
            return

        if not profiles:
            self.log("ℹ️ Нет профилей с назначенными аккаунтами для подписки.")
            self.finished_signal.emit()
            return

        for profile in profiles:
            if not self.running:
                break

            profile_id = profile.get("profile_id")
            profile_name = profile.get("name") or "profile"
            proxy = profile.get("proxy") or "None"
            user_agent = profile.get("user_agent")
            
            if not profile_id:
                self.log("⚠️ Пропускаю профиль без profile_id")
                continue

            # Skip if profile is busy (scrolling or already running)
            try:
                if self.client.is_profile_busy(profile_id):
                    self.log(f"⏭️ Профиль {profile_name} занят (scrolling), пропускаю.")
                    continue
            except InstagramAccountsError as err:
                self.log(f"❌ Ошибка проверки статуса профиля {profile_name}: {err}")
                continue

            try:
                accounts = self.client.get_accounts_for_profile(profile_id)
            except InstagramAccountsError as err:
                self.log(f"❌ Ошибка загрузки аккаунтов для {profile_name}: {err}")
                continue

            if not accounts:
                self.log(f"ℹ️ Нет назначенных аккаунтов для профиля {profile_name}.")
                continue

            usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
            account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}

            self.log(f"▶️ Профиль {profile_name}: подписка на {len(usernames)} аккаунтов.")

            def on_follow_success(username: str):
                account_id = account_map.get(username)
                if not account_id:
                    return
                try:
                    self.client.update_account_status(account_id, status="sunscribed")
                except InstagramAccountsError as err:
                    self.log(f"⚠️ Не удалось обновить статус для @{username}: {err}")

            def on_follow_skip(username: str):
                account_id = account_map.get(username)
                if not account_id:
                    return
                try:
                    self.client.update_account_status(account_id, status="skiped", assigned_to=None)
                except InstagramAccountsError as err:
                    self.log(f"⚠️ Не удалось обновить статус пропуска @{username}: {err}")

            try:
                follow_usernames(
                    profile_name=profile_name,
                    proxy_string=proxy,
                    usernames=usernames,
                    log=self.log,
                    should_stop=lambda: not self.running,
                    following_limit=self.following_limit,
                    interactions_config={
                        "highlights_range": self.highlights_range,
                        "likes_range": self.likes_range,
                    },
                    on_success=on_follow_success,
                    on_skip=on_follow_skip,
                    user_agent=user_agent,
                )
            except Exception as err:
                self.log(f"❌ Ошибка сессии для профиля {profile_name}: {err}")

            if not self.running:
                break

            # After follow session, wait if profile became busy again (scrolling)
            try:
                self.client.wait_for_profile_idle(
                    profile_id,
                    log=self.log,
                    should_stop=lambda: not self.running,
                )
            except InstagramAccountsError as err:
                self.log(f"⚠️ Не удалось дождаться idle для профиля {profile_name}: {err}")

        self.finished_signal.emit()

    def stop(self):
        self.running = False

    def log(self, message: str):
        self.log_signal.emit(message)

    @staticmethod
    def _normalize_range(range_values, default):
        """Ensure we always have an ordered, non-negative (min, max) tuple."""
        try:
            low, high = range_values
            low = max(0, int(low))
            high = max(0, int(high))
            if low > high:
                low, high = high, low
            return low, high
        except Exception:
            return default

