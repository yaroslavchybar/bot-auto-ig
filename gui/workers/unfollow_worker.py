from typing import List, Optional, Tuple
from PyQt6.QtCore import QThread, pyqtSignal

from automation.unfollow.session import unfollow_usernames
from supabase.instagram_accounts_client import (
    InstagramAccountsClient,
    InstagramAccountsError,
)


class UnfollowWorker(QThread):
    """Worker that handles the unfollow process and follow requests approval."""

    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()

    def __init__(self, 
                 delay_range: Tuple[int, int] = (10, 30),
                 do_unfollow: bool = True,
                 do_approve: bool = True):
        super().__init__()
        self.delay_range = delay_range
        self.do_unfollow = do_unfollow
        self.do_approve = do_approve
        self.running = True
        self.client = InstagramAccountsClient()

    def run(self):
        try:
            # 1. Get profiles that have accounts assigned with status 'unsubscribed'
            # Note: Approving logic might ideally run on 'active' accounts too?
            # But adhering to the context, we will fetch 'unsubscribed' for now as per current architecture
            # or we fetch profiles for context.
            # Assuming we use the same pool of profiles.
            profiles = self.client.get_profiles_with_assigned_accounts(status="unsubscribed")
        except InstagramAccountsError as err:
            self.log_signal.emit(f"❌ Ошибка Supabase: {err}")
            self.finished_signal.emit()
            return

        if not profiles:
            self.log_signal.emit("ℹ️ Нет профилей с назначенными аккаунтами (status='unsubscribed').")
            self.finished_signal.emit()
            return

        for profile in profiles:
            if not self.running:
                break

            profile_id = profile.get("profile_id")
            profile_name = profile.get("name") or "profile"
            proxy = profile.get("proxy") or "None"

            # === TASK A: APPROVE REQUESTS ===
            if self.do_approve:
                self.log_signal.emit(f"🚀 [Approve] Начинаю подтверждение заявок для {profile_name}...")
                try:
                    # Lazy import to avoid circular dependency issues if any
                    from automation.approvefollow.session import approve_follow_requests
                    approve_follow_requests(
                        profile_name=profile_name,
                        proxy_string=proxy,
                        log=self.log_signal.emit,
                        should_stop=lambda: not self.running
                    )
                except Exception as e:
                    self.log_signal.emit(f"❌ Ошибка подтверждения заявок для {profile_name}: {e}")

            if not self.running:
                break

            # === TASK B: UNFOLLOW ===
            if self.do_unfollow:
                self.log_signal.emit(f"🚀 [Unfollow] Начинаю отписку для {profile_name}...")
                
                try:
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
                        self.client.update_account_status(account_id, status="done", assigned_to=None)
                        self.log_signal.emit(f"💾 Статус {username} обновлен на 'done'.")
                    except InstagramAccountsError as db_err:
                        self.log_signal.emit(f"⚠️ Ошибка обновления БД для {username}: {db_err}")

                # Execute Unfollow Automation
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
