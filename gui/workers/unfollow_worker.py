from typing import List, Optional, Tuple
from PyQt6.QtCore import QThread, pyqtSignal

from automation.unfollow.session import unfollow_usernames
from supabase.instagram_accounts_client import (
    InstagramAccountsClient,
    InstagramAccountsError,
)


class UnfollowWorker(QThread):
    """Worker that handles the unfollow process for accounts with status 'unsubscribed'."""

    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()

    def __init__(self, delay_range: Tuple[int, int] = (10, 30)):
        super().__init__()
        self.delay_range = delay_range
        self.running = True
        self.client = InstagramAccountsClient()

    def run(self):
        try:
            # 1. Get profiles that have accounts assigned with status 'unsubscribed'
            profiles = self.client.get_profiles_with_assigned_accounts(status="unsubscribed")
        except InstagramAccountsError as err:
            self.log_signal.emit(f"❌ Ошибка Supabase: {err}")
            self.finished_signal.emit()
            return

        if not profiles:
            self.log_signal.emit("ℹ️ Нет профилей с назначенными аккаунтами.")
            self.finished_signal.emit()
            return

        for profile in profiles:
            if not self.running:
                break

            profile_id = profile.get("profile_id")
            profile_name = profile.get("name") or "profile"
            proxy = profile.get("proxy") or "None"

            # 2. Get accounts for this profile with status 'unsubscribed'
            try:
                # Assuming get_accounts_for_profile can filter by status
                # If the existing method is rigid, we might need to fetch all and filter, 
                # or the method allows a status param.
                # Checking existing code: get_accounts_for_profile(self, profile_id: str, status: str = "assigned")
                # So we can pass status="unsubscribed".
                accounts = self.client.get_accounts_for_profile(profile_id, status="unsubscribed")
            except InstagramAccountsError as err:
                self.log_signal.emit(f"❌ Ошибка получения аккаунтов для {profile_name}: {err}")
                continue

            if not accounts:
                self.log_signal.emit(f"ℹ️ У профиля {profile_name} нет аккаунтов со статусом 'unsubscribed'.")
                continue

            usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
            account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}

            self.log_signal.emit(f"▶️ Профиль {profile_name}: Найдено {len(usernames)} для отписки.")

            # Callback to update status to 'done'
            def on_unfollow_success(username: str):
                account_id = account_map.get(username)
                if not account_id:
                    return
                try:
                    # Update to 'done' and remove assignment (optional, but 'done' implies finished)
                    # The update_account_status method allows status and assigned_to
                    self.client.update_account_status(account_id, status="done", assigned_to=None)
                    self.log_signal.emit(f"💾 Статус {username} обновлен на 'done'.")
                except InstagramAccountsError as db_err:
                    self.log_signal.emit(f"⚠️ Ошибка обновления БД для {username}: {db_err}")

            # 3. Execute Automation
            try:
                unfollow_usernames(
                    profile_name=profile_name,
                    proxy_string=proxy,
                    usernames=usernames,
                    log=self.log_signal.emit,
                    should_stop=lambda: not self.running,
                    delay_range=self.delay_range,
                    on_success=on_unfollow_success
                )
            except Exception as e:
                self.log_signal.emit(f"❌ Ошибка в процессе отписки для {profile_name}: {e}")

        self.finished_signal.emit()

    def stop(self):
        self.running = False
