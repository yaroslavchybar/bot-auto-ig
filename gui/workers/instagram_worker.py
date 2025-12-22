import sys
import os
import random
import time
import subprocess
from typing import List, Optional, Tuple
from pathlib import Path
from PyQt6.QtCore import QThread, pyqtSignal

from core.models import ScrollingConfig, ThreadsAccount
from automation.scrolling import scroll_feed, scroll_reels
from automation.stories import watch_stories
from automation.Follow.session import follow_usernames
from automation.unfollow.session import unfollow_usernames
from automation.approvefollow.session import approve_follow_requests
from automation.messaging.session import send_messages
from supabase.instagram_accounts_client import InstagramAccountsClient, InstagramAccountsError
from supabase.profiles_client import SupabaseProfilesClient

from gui.workers.worker_utils import (
    kill_process_tree,
    create_browser_context,
    normalize_range,
    apply_count_limit,
    create_status_callback,
    get_action_enabled_map,
    build_action_order,
)


class BaseInstagramWorker(QThread):
    """Base class for all Instagram worker threads with common signals and methods."""
    
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()
    
    def __init__(self):
        super().__init__()
        self.running = True
        self.client = InstagramAccountsClient()
    
    def stop(self):
        """Stop the worker gracefully."""
        self.running = False
        self.log("🛑 Stopping automation...")
    
    def log(self, message: str):
        """Send log message to UI."""
        self.log_signal.emit(message)


class InstagramScrollingWorker(BaseInstagramWorker):
    """Worker thread for automated actions (Scrolling, Follow, Unfollow, etc.)"""
    
    def __init__(self, config: ScrollingConfig, accounts: List[ThreadsAccount], profile_names: List[str]):
        super().__init__()
        self.config = config
        self.accounts = accounts
        self.profile_names = profile_names
        self.profiles_client = SupabaseProfilesClient()
        self.current_context = None
        
    def run(self):
        """Main worker loop"""
        while self.running:
            try:
                for account in self.accounts:
                    if not self.running:
                        break
                    self.process_account(account)
                    if self.running:
                        time.sleep(random.randint(10, 30))
                
                if self.running:
                    for _ in range(self.config.cycle_interval_minutes * 60):
                        if not self.running:
                            break
                        time.sleep(1)
            except Exception as e:
                self.log(f"❌ Error in automation worker: {e}")
                time.sleep(30)
        
        self.finished_signal.emit()

    def process_account(self, account: ThreadsAccount):
        """Execute all enabled actions for a specific account using a single browser session"""
        profile_name = account.username
        proxy_str = account.proxy or "None"
        
        # Get User Agent from database
        user_agent = None
        try:
            profile_data = self.profiles_client.get_profile_by_name(profile_name)
            if profile_data:
                user_agent = profile_data.get('user_agent')
        except Exception as e:
            self.log(f"⚠️ Failed to fetch user agent: {e}")

        try:
            self.log(f"🚀 Launching browser for @{profile_name}...")
            
            with create_browser_context(profile_name, proxy_str, user_agent) as (context, page):
                self.current_context = context
                
                # Build action execution map
                actions_map = {
                    "Feed Scroll": lambda: self._run_scrolling(page, account, mode="feed"),
                    "Reels Scroll": lambda: self._run_scrolling(page, account, mode="reels"),
                    "Watch Stories": lambda: self._run_stories(page, account),
                    "Follow": lambda: self._run_follow(page, account),
                    "Unfollow": lambda: self._run_unfollow_only(page, account),
                    "Approve Requests": lambda: self._run_approve_only(page, account),
                    "Send Messages": lambda: self._run_message_only(page, account)
                }
                
                # Get action order and enabled map
                order = build_action_order(self.config)
                enabled_map = get_action_enabled_map(self.config)
                
                for action_name in order:
                    if not self.running:
                        break
                    
                    if action_name in actions_map and enabled_map.get(action_name, False):
                        actions_map[action_name]()
                        if self.running:
                            time.sleep(random.randint(3, 7))

                if self.running:
                    self.log(f"✅ All tasks finished for @{profile_name}")
                self.current_context = None

        except Exception as e:
            self.log(f"❌ Error processing @{profile_name}: {e}")

    def _run_scrolling(self, page, account, mode="feed"):
        """Execute scrolling logic reusing the page"""
        try:
            duration = 0
            if mode == "feed" and self.config.enable_feed:
                duration = random.randint(self.config.feed_min_time_minutes, self.config.feed_max_time_minutes)
            elif mode == "reels" and self.config.enable_reels:
                duration = random.randint(self.config.reels_min_time_minutes, self.config.reels_max_time_minutes)
            
            if duration <= 0:
                return

            config = {
                'like_chance': self.config.like_chance if mode == "feed" else self.config.reels_like_chance,
                'comment_chance': self.config.comment_chance,
                'follow_chance': self.config.follow_chance if mode == "feed" else self.config.reels_follow_chance,
                'reels_skip_chance': self.config.reels_skip_chance,
                'reels_skip_min_time': self.config.reels_skip_min_time,
                'reels_skip_max_time': self.config.reels_skip_max_time,
                'reels_normal_min_time': self.config.reels_normal_min_time,
                'reels_normal_max_time': self.config.reels_normal_max_time,
                'carousel_watch_chance': self.config.carousel_watch_chance,
                'carousel_max_slides': self.config.carousel_max_slides,
                'watch_stories': self.config.watch_stories,
                'stories_max': self.config.stories_max,
            }

            if mode == 'feed':
                scroll_feed(page, duration, config, should_stop=lambda: not self.running)
            elif mode == 'reels':
                scroll_reels(page, duration, config, should_stop=lambda: not self.running)
                
        except Exception as e:
            self.log(f"⚠️ Scrolling error: {e}")

    def _run_stories(self, page, account):
        try:
            max_stories = self.config.stories_max if isinstance(self.config.stories_max, int) else 3
            self.log(f"📺 Watching Stories (max {max_stories})...")
            watch_stories(page, max_stories=max_stories, log=self.log)
        except Exception as e:
            self.log(f"⚠️ Stories error: {e}")

    def _run_follow(self, page, account):
        try:
            self.log("➕ Running Follow...")
            all_profiles = self.client.get_profiles_with_assigned_accounts()
            profile_data = next((p for p in all_profiles if p.get("name") == account.username), None)
            
            if not profile_data:
                self.log("⚠️ Could not find profile data.")
                return

            profile_id = profile_data.get("profile_id")
            accounts = self.client.get_accounts_for_profile(profile_id)
            usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
            account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}
            
            if not usernames:
                self.log("ℹ️ No usernames to follow.")
                return

            # Apply per-session follow limit
            usernames = apply_count_limit(usernames, self.config.follow_count_range)
            if self.config.follow_count_range:
                self.log(f"🔢 Follow session limit: {len(usernames)}")

            interactions_config = {
                "highlights_range": self.config.highlights_range,
                "likes_percentage": self.config.likes_percentage,
                "scroll_percentage": self.config.scroll_percentage
            }

            on_follow_success = create_status_callback(
                self.client, account_map, self.log, "sunscribed",
                success_message="💾 Статус @{username} обновлен на 'sunscribed'."
            )
            on_follow_skip = create_status_callback(
                self.client, account_map, self.log, "skiped", clear_assigned=True,
                success_message="💾 Пропуск @{username}: статус 'skiped', снято назначение."
            )

            follow_usernames(
                profile_name=account.username,
                proxy_string=account.proxy or "",
                usernames=usernames,
                log=self.log,
                should_stop=lambda: not self.running,
                page=page,
                interactions_config=interactions_config,
                following_limit=self.config.following_limit,
                on_success=on_follow_success,
                on_skip=on_follow_skip,
            )
        except Exception as e:
            self.log(f"⚠️ Follow error: {e}")

    def _run_unfollow_only(self, page, account):
        try:
            self.log("🔪 Running Unfollow...")
            delay_range = self.config.unfollow_delay_range or (10, 30)
            unfollow_usernames(
                profile_name=account.username,
                proxy_string=account.proxy or "",
                usernames=[],
                log=self.log,
                should_stop=lambda: not self.running,
                delay_range=delay_range,
                page=page
            )
        except Exception as e:
            self.log(f"⚠️ Unfollow error: {e}")

    def _run_approve_only(self, page, account):
        try:
            self.log("✅ Running Approve Requests...")
            approve_follow_requests(
                profile_name=account.username,
                proxy_string=account.proxy or "",
                log=self.log,
                should_stop=lambda: not self.running,
                page=page
            )
        except Exception as e:
            self.log(f"⚠️ Approve error: {e}")

    def _run_message_only(self, page, account):
        try:
            self.log("✉️ Running Messaging...")
            all_profiles = self.client.get_profiles_with_assigned_accounts()
            profile_data = next((p for p in all_profiles if p.get("name") == account.username), None)
            
            if profile_data:
                profile_id = profile_data.get("profile_id")
                targets = self.client.get_accounts_to_message(profile_id)
                
                if targets:
                    message_texts = self.config.message_texts or ["Hi!"]
                    send_messages(
                        profile_name=account.username,
                        proxy_string=account.proxy or "",
                        targets=targets,
                        message_texts=message_texts,
                        log=self.log,
                        should_stop=lambda: not self.running,
                        page=page
                    )
                else:
                    self.log("ℹ️ No targets for messaging.")
            else:
                self.log("⚠️ Could not find profile for messaging.")
        except Exception as e:
            self.log(f"⚠️ Messaging error: {e}")


class OnboardingWorker(BaseInstagramWorker):
    """Worker thread for account onboarding"""
    
    def __init__(self, accounts: List[ThreadsAccount], parallel_count: int = 1):
        super().__init__()
        self.accounts = accounts
        self.parallel_count = parallel_count
        self.current_process = None
        self.profiles_client = SupabaseProfilesClient()
        
    def stop(self):
        self.running = False
        if self.current_process and self.current_process.poll() is None:
            kill_process_tree(self.current_process, self.log)
            self.current_process = None
        
    def run(self):
        """Onboard accounts"""
        self.log(f"🎯 Starting onboarding for {len(self.accounts)} accounts...")

        try:
            for i, account in enumerate(self.accounts, 1):
                if not self.running:
                    break
                    
                self.log(f"[{i}/{len(self.accounts)}] Onboarding @{account.username}...")
                
                profile_name = account.username
                proxy_str = account.proxy or "None"
                
                # Fetch UA
                user_agent = None
                try:
                    p_data = self.profiles_client.get_profile_by_name(profile_name)
                    if p_data:
                        user_agent = p_data.get('user_agent')
                except Exception:
                    pass

                cmd = [
                    sys.executable, "launcher.py", 
                    "--name", profile_name, 
                    "--proxy", proxy_str,
                    "--action", "onboard"
                ]
                
                if user_agent:
                    cmd.extend(["--user-agent", user_agent])
                
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 5

                self.current_process = subprocess.Popen(
                    cmd,
                    startupinfo=startupinfo,
                    creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
                self.log(f"🚀 Browser launched for onboarding @{account.username}")
                
                self.current_process.wait()
                self.current_process = None
                
                self.log(f"✅ @{account.username} onboarded successfully")
                
            self.log("🎉 All accounts onboarded!")
            
        except Exception as e:
            self.log(f"❌ Onboarding error: {e}")
            
        self.finished_signal.emit()


class FollowWorker(BaseInstagramWorker):
    """Worker that follows a list of usernames using a specific profile."""

    def __init__(self, profile_name: str, proxy: str, usernames: List[str]):
        super().__init__()
        self.profile_name = profile_name
        self.proxy = proxy
        self.usernames = usernames

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


class AutoFollowWorker(BaseInstagramWorker):
    """Worker that loops through all profiles with assigned accounts."""

    def __init__(
        self,
        highlights_range: Optional[Tuple[int, int]] = None,
        likes_percentage: int = 0,
        scroll_percentage: int = 0,
        following_limit: Optional[int] = None,
        count_range: Optional[Tuple[int, int]] = None,
        filter_list_ids: Optional[List[str]] = None,
    ):
        super().__init__()
        self.highlights_range = normalize_range(highlights_range, (2, 4))
        self.likes_percentage = likes_percentage
        self.scroll_percentage = scroll_percentage
        try:
            self.following_limit = int(following_limit) if following_limit is not None else None
        except Exception:
            self.following_limit = None
        self.filter_list_ids = filter_list_ids
        self.count_range = count_range

    def run(self):
        try:
            profiles = self.client.get_profiles_with_assigned_accounts()
        except InstagramAccountsError as err:
            self.log(f"❌ Ошибка Supabase (profiles): {err}")
            self.finished_signal.emit()
            return

        if self.filter_list_ids:
            profiles = [p for p in profiles if p.get("list_id") in set(self.filter_list_ids)]

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

            usernames = apply_count_limit(usernames, self.count_range)

            self.log(f"▶️ Профиль {profile_name}: подписка на {len(usernames)} аккаунтов.")

            on_follow_success = create_status_callback(
                self.client, account_map, self.log, "sunscribed"
            )
            on_follow_skip = create_status_callback(
                self.client, account_map, self.log, "skiped", clear_assigned=True
            )

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
                        "likes_percentage": self.likes_percentage,
                        "scroll_percentage": self.scroll_percentage,
                    },
                    on_success=on_follow_success,
                    on_skip=on_follow_skip,
                    user_agent=user_agent,
                )
            except Exception as err:
                self.log(f"❌ Ошибка сессии для профиля {profile_name}: {err}")

            if not self.running:
                break

            try:
                self.client.wait_for_profile_idle(
                    profile_id,
                    log=self.log,
                    should_stop=lambda: not self.running,
                )
            except InstagramAccountsError as err:
                self.log(f"⚠️ Не удалось дождаться idle для профиля {profile_name}: {err}")

        self.finished_signal.emit()


class UnfollowWorker(BaseInstagramWorker):
    """Worker that handles the unfollow process and follow requests approval."""

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
        self.filter_list_ids = filter_list_ids

    def run(self):
        try:
            profiles = []
            if self.do_unfollow:
                profiles.extend(self.client.get_profiles_with_assigned_accounts(status="unsubscribed"))
            if self.do_approve:
                for profile in self.client.get_profiles_with_assigned_accounts(status=None):
                    if profile not in profiles:
                        profiles.append(profile)
            if self.do_message:
                for profile in self.client.get_profiles_with_assigned_accounts(status=None):
                    if profile not in profiles:
                        profiles.append(profile)
        except InstagramAccountsError as err:
            self.log(f"❌ Ошибка Supabase: {err}")
            self.finished_signal.emit()
            return

        if not profiles:
            self.log("ℹ️ Нет профилей с назначенными аккаунтами.")
            self.finished_signal.emit()
            return
        
        if self.filter_list_ids:
            profiles = [p for p in profiles if p.get("list_id") in set(self.filter_list_ids)]

        # Load message texts if messaging is enabled
        message_texts = []
        if self.do_message:
            try:
                msg_path = Path("message.txt")
                if msg_path.exists():
                    content = msg_path.read_text(encoding="utf-8").strip()
                    if content:
                        message_texts = [line.strip() for line in content.split('\n') if line.strip()]
                    else:
                        self.log("⚠️ Файл message.txt пуст! Рассылка пропущена.")
                        self.do_message = False
                if not message_texts:
                    self.log("⚠️ В файле message.txt нет валидных сообщений! Рассылка пропущена.")
                    self.do_message = False
            except Exception as e:
                self.log(f"⚠️ Ошибка чтения message.txt: {e}")
                self.do_message = False

        for profile in profiles:
            if not self.running:
                break

            profile_id = profile.get("profile_id")
            profile_name = profile.get("name") or "profile"
            proxy = profile.get("proxy") or "None"
            user_agent = profile.get("user_agent")

            # Check database for unfollow accounts
            unfollow_accounts = []
            if self.do_unfollow:
                try:
                    unfollow_accounts = self.client.get_accounts_for_profile(profile_id, status="unsubscribed")
                except InstagramAccountsError as err:
                    self.log(f"❌ Ошибка получения аккаунтов для {profile_name}: {err}")

            # Check database for messaging targets
            message_targets = []
            if self.do_message:
                try:
                    message_targets = self.client.get_accounts_to_message(profile_id)
                except Exception as e:
                    self.log(f"❌ Ошибка получения целей для рассылки {profile_name}: {e}")

            # Skip browser launch if nothing to do
            if not self.do_approve and not unfollow_accounts and not message_targets:
                self.log(f"ℹ️ Нет задач для {profile_name}, пропускаю.")
                continue

            try:
                with create_browser_context(profile_name, proxy, user_agent) as (context, page):
                    # Approve requests
                    if self.do_approve:
                        self.log(f"🚀 [Approve] Начинаю подтверждение заявок для {profile_name}...")
                        try:
                            approve_follow_requests(
                                profile_name=profile_name,
                                proxy_string=proxy,
                                log=self.log,
                                should_stop=lambda: not self.running,
                                page=page
                            )
                        except Exception as e:
                            self.log(f"❌ Ошибка подтверждения заявок для {profile_name}: {e}")

                    if not self.running:
                        break

                    # Unfollow
                    if self.do_unfollow and unfollow_accounts:
                        self.log(f"🚀 [Unfollow] Начинаю отписку для {profile_name}...")
                        usernames = [acc.get("user_name") for acc in unfollow_accounts if acc.get("user_name")]
                        account_map = {acc["user_name"]: acc["id"] for acc in unfollow_accounts if acc.get("id") and acc.get("user_name")}

                        self.log(f"▶️ Профиль {profile_name}: Найдено {len(usernames)} для отписки.")

                        usernames = apply_count_limit(usernames, self.count_range)
                        if self.count_range:
                            self.log(f"🔢 Лимит на сессию: {len(usernames)}")

                        on_unfollow_success = create_status_callback(
                            self.client, account_map, self.log, "done", clear_assigned=True,
                            success_message="💾 Статус {username} обновлен на 'done'."
                        )

                        try:
                            unfollow_usernames(
                                profile_name=profile_name,
                                proxy_string=proxy,
                                usernames=usernames,
                                log=self.log,
                                should_stop=lambda: not self.running,
                                delay_range=self.delay_range,
                                on_success=on_unfollow_success,
                                page=page
                            )
                        except Exception as e:
                            self.log(f"❌ Ошибка в процессе отписки для {profile_name}: {e}")
                    
                    if not self.running:
                        break
                        
                    # Messaging
                    if self.do_message and message_targets:
                        self.log(f"🚀 [Messaging] Найдено {len(message_targets)} пользователей для рассылки.")
                        try:
                            send_messages(
                                profile_name=profile_name,
                                proxy_string=proxy,
                                targets=message_targets,
                                message_texts=message_texts,
                                log=self.log,
                                should_stop=lambda: not self.running,
                                page=page
                            )
                        except Exception as e:
                            self.log(f"❌ Ошибка рассылки для {profile_name}: {e}")

            except Exception as e:
                self.log(f"❌ Критическая ошибка браузера для {profile_name}: {e}")

        self.finished_signal.emit()
