import os
import random
from typing import List, Optional, Tuple
from PyQt6.QtCore import QThread, pyqtSignal

from camoufox import Camoufox
from automation.browser import parse_proxy_string
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
                 count_range: Optional[Tuple[int, int]] = None,
                 do_unfollow: bool = True,
                 do_approve: bool = True,
                 do_message: bool = False,
                 filter_list_ids: Optional[List[str]] = None):
        super().__init__()
        self.delay_range = delay_range
        self.count_range = count_range
        self.do_unfollow = do_unfollow
        self.do_approve = do_approve
        self.do_message = do_message
        self.running = True
        self.client = InstagramAccountsClient()
        self.filter_list_ids = filter_list_ids

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

            # Get profiles based on what operations we need to perform
            profiles = []

            if self.do_unfollow:
                # For unfollow, we need profiles with unsubscribed accounts
                unsub_profiles = self.client.get_profiles_with_assigned_accounts(status="unsubscribed")
                profiles.extend(unsub_profiles)

            if self.do_approve:
                # For approve, we need profiles with any assigned accounts (not just unsubscribed)
                # Get profiles with assigned accounts regardless of status
                all_assigned_profiles = self.client.get_profiles_with_assigned_accounts(status=None)
                for profile in all_assigned_profiles:
                    if profile not in profiles:  # Avoid duplicates
                        profiles.append(profile)

            if self.do_message:
                # For messaging, we need profiles that have accounts with message=true
                # For now, we'll use the same logic as approve - profiles with assigned accounts
                message_profiles = self.client.get_profiles_with_assigned_accounts(status=None)
                for profile in message_profiles:
                    if profile not in profiles:  # Avoid duplicates
                        profiles.append(profile)

        except InstagramAccountsError as err:
            self.log_signal.emit(f"❌ Ошибка Supabase: {err}")
            self.finished_signal.emit()
            return

        if not profiles:
            self.log_signal.emit("ℹ️ Нет профилей с назначенными аккаунтами.")
            self.finished_signal.emit()
            return
        
        if self.filter_list_ids:
            ids_set = set(self.filter_list_ids)
            profiles = [p for p in profiles if p.get("list_id") in ids_set]

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
            user_agent = profile.get("user_agent")
            
            self.log_signal.emit(f"👤 Processing profile: {profile_name}")
            
            # Prepare profile path
            base_dir = os.getcwd()
            profile_path = os.path.join(base_dir, "profiles", profile_name)
            os.makedirs(profile_path, exist_ok=True)
            
            # Parse Proxy
            proxy_config = None
            if proxy and proxy.lower() not in ["none", ""]:
                proxy_config = parse_proxy_string(proxy)

            try:
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
                    if len(context.pages) > 0:
                        page = context.pages[0]
                    else:
                        page = context.new_page()

                    if page.url == "about:blank":
                        page.goto("https://www.instagram.com", timeout=15000)

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
                                should_stop=lambda: not self.running,
                                page=page
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

                            # Apply per-session limit
                            try:
                                if self.count_range and isinstance(self.count_range, tuple):
                                    cmin, cmax = self.count_range
                                    try:
                                        cmin = int(cmin)
                                        cmax = int(cmax)
                                    except Exception:
                                        cmin, cmax = 0, 0
                                    if cmin > cmax:
                                        cmin, cmax = cmax, cmin
                                    if cmax > 0:
                                        count = random.randint(max(0, cmin), cmax)
                                        if count <= 0:
                                            usernames = []
                                        else:
                                            random.shuffle(usernames)
                                            usernames = usernames[:count]
                                        self.log_signal.emit(f"🔢 Лимит на сессию: {len(usernames)}")
                            except Exception:
                                pass

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
                                    on_success=on_unfollow_success,
                                    page=page
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
                                    should_stop=lambda: not self.running,
                                    page=page
                                )
                            else:
                                self.log_signal.emit(f"ℹ️ Нет 'message=true' аккаунтов для {profile_name}.")
                                
                        except Exception as e:
                            self.log_signal.emit(f"❌ Ошибка рассылки для {profile_name}: {e}")

            except Exception as e:
                self.log_signal.emit(f"❌ Критическая ошибка браузера для {profile_name}: {e}")

        self.finished_signal.emit()

    def stop(self):
        self.running = False
