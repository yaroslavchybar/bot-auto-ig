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
                 do_approve: bool = True,
                 do_message: bool = False):
        super().__init__()
        self.delay_range = delay_range
        self.do_unfollow = do_unfollow
        self.do_approve = do_approve
        self.do_message = do_message
        self.running = True
        self.client = InstagramAccountsClient()

    def run(self):
        try:
            # 1. Get profiles that have accounts assigned with status 'unsubscribed' or 'message=true'
            # To be simple: we iterate ALL profiles that have ANY relevant work.
            # But get_profiles_with_assigned_accounts filters by status.
            # Let's get profiles with 'unsubscribed' assigned, AND potentially just get all working profiles?
            # Or assume the user wants to run on 'unsubscribed' context mostly.
            # For messaging, we need profiles that have 'message=True' accounts.
            # Let's just use the strict fetching:
            
            # Helper to get unique profile IDs relevant for our active flags
            active_profile_ids = set()
            
            if self.do_unfollow or self.do_approve:
                 profs_unsub = self.client.get_profiles_with_assigned_accounts(status="unsubscribed")
                 for p in profs_unsub:
                     active_profile_ids.add(p['profile_id'])
            
            if self.do_message:
                # We need a way to find profiles that have accounts with message=true
                # Current API helper 'get_profiles_with_assigned_accounts' is status based.
                # We might need to iterate all profiles or fetch differently.
                # For efficiency, let's just re-use the unsubscribed list + any profiles with message=true if possible.
                # BUT, since we don't have a direct helper for "profiles with message=true accounts",
                # let's assume we work on the SAME profiles that are returned for unfollow task.
                # OR, iterate all available profiles?
                # Let's Stick to the profiles returned by 'unsubscribed' for now to fit current flow,
                # UNLESS do_unfollow is False. If do_unfollow is False, we might miss profiles.
                
                # Let's simple fetch all profiles involved in 'unsubscribed' status for now.
                # If a user ONLY wants to message, they might need to ensure those profiles 
                # also have some 'unsubscribed' accounts OR we improve the fetching logic.
                # Let's improve fetching logic by fetching all valid profiles for now.
                pass

            # Since we can't easily query "profiles having sub-accounts with message=true" without new index/helper,
            # Let's just fetch profiles with 'unsubscribed' status for broad coverage.
            profiles = self.client.get_profiles_with_assigned_accounts(status="unsubscribed")
            
        except InstagramAccountsError as err:
            self.log_signal.emit(f"❌ Ошибка Supabase: {err}")
            self.finished_signal.emit()
            return

        if not profiles:
            self.log_signal.emit("ℹ️ Нет профилей с назначенными аккаунтами (status='unsubscribed').")
            self.finished_signal.emit()
            return

        # Pre-load message texts if needed
        message_texts = []
        if self.do_message:
            try:
                from pathlib import Path
                msg_path = Path("message.txt")
                if msg_path.exists():
                    content = msg_path.read_text(encoding="utf-8").strip()
                    if content:
                        # Split by lines and filter out empty lines
                        message_texts = [line.strip() for line in content.split('\n') if line.strip()]
                    else:
                        self.log_signal.emit("⚠️ Файл message.txt пуст! Рассылка пропущена.")
                        self.do_message = False
                if not message_texts:
                    self.log_signal.emit("⚠️ В файле message.txt нет валидных сообщений! Рассылка пропущена.")
                    self.do_message = False
            except Exception as e:
                self.log_signal.emit(f"⚠️ Ошибка чтения message.txt: {e}")
                self.do_message = False

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
                    accounts = [] # Continue to next task

                if accounts:
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
            
            if not self.running:
                break
                
            # === TASK C: MESSAGING ===
            if self.do_message:
                self.log_signal.emit(f"🚀 [Messaging] Проверка сообщений для {profile_name}...")
                try:
                    targets = self.client.get_accounts_to_message(profile_id)
                    if targets:
                        self.log_signal.emit(f"✉️ Найдено {len(targets)} пользователей для рассылки.")
                        from automation.messaging.session import send_messages
                        send_messages(
                            profile_name=profile_name,
                            proxy_string=proxy,
                            targets=targets,
                            message_texts=message_texts,
                            log=self.log_signal.emit,
                            should_stop=lambda: not self.running
                        )
                    else:
                        self.log_signal.emit(f"ℹ️ Нет 'message=true' аккаунтов для {profile_name}.")
                        
                except Exception as e:
                    self.log_signal.emit(f"❌ Ошибка рассылки для {profile_name}: {e}")

        self.finished_signal.emit()

    def stop(self):
        self.running = False
