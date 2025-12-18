import sys
import os
import random
import signal
import time
import subprocess
from typing import List, Optional, Tuple
from pathlib import Path
from PyQt6.QtCore import QThread, pyqtSignal

from camoufox import Camoufox
from core.models import ScrollingConfig, ThreadsAccount
from automation.browser import parse_proxy_string
from automation.scrolling import scroll_feed, scroll_reels
from automation.Follow.session import follow_usernames
from automation.unfollow.session import unfollow_usernames
from automation.approvefollow.session import approve_follow_requests
from automation.messaging.session import send_messages
from supabase.instagram_accounts_client import InstagramAccountsClient, InstagramAccountsError

CTRL_BREAK = getattr(signal, "CTRL_BREAK_EVENT", None)
IS_WINDOWS = os.name == "nt"


def _kill_process_tree(proc, log):
    """Best-effort kill for subprocess and its children on Windows."""
    if proc is None or proc.poll() is not None:
        return

    if IS_WINDOWS:
        if CTRL_BREAK is not None:
            try:
                proc.send_signal(CTRL_BREAK)
                proc.wait(timeout=5)
            except Exception as err:
                log(f"⚠️ CTRL_BREAK to child failed: {err}")

        if proc.poll() is None:
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                proc.wait(timeout=3)
            except Exception as err:
                log(f"⚠️ taskkill failed: {err}")
    else:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception as err:
            log(f"⚠️ terminate failed: {err}")

    if proc.poll() is None:
        try:
            proc.kill()
        except Exception:
            pass

class InstagramScrollingWorker(QThread):
    """Worker thread for automated actions (Scrolling, Follow, Unfollow, etc.)"""
    
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()
    
    def __init__(self, config: ScrollingConfig, accounts: List[ThreadsAccount], profile_names: List[str]):
        super().__init__()
        self.config = config
        self.accounts = accounts
        self.profile_names = profile_names
        self.running = True
        self.client = InstagramAccountsClient()
        self.current_context = None # Keep track of browser context to close it properly
        
    def run(self):
        """Main worker loop"""
        self.log("🚀 Starting automation worker...")
        
        while self.running:
            try:
                # Process each account
                for account in self.accounts:
                    if not self.running:
                        break
                        
                    self.process_account(account)
                    
                    # Random delay between accounts
                    if self.running:
                        delay = random.randint(10, 30)
                        self.log(f"⏳ Waiting {delay}s before next account...")
                        time.sleep(delay)
                
                # Wait for cycle interval if scrolling is enabled or we want to loop
                # Only loop if we have scrolling enabled OR if the user expects continuous operation
                # For now, we respect the cycle interval.
                if self.running:
                    minutes = self.config.cycle_interval_minutes
                    self.log(f"⌛ Cycle complete. Waiting {minutes} minutes...")
                    
                    # Sleep in small increments
                    for _ in range(minutes * 60):
                        if not self.running:
                            break
                        time.sleep(1)
                        
            except Exception as e:
                self.log(f"❌ Error in automation worker: {e}")
                time.sleep(30)
        
        self.log("⏹️ Automation stopped")
        self.finished_signal.emit()

    def process_account(self, account: ThreadsAccount):
        """Execute all enabled actions for a specific account using a single browser session"""
        profile_name = account.username
        proxy_str = account.proxy or "None"
        
        self.log(f"👤 Processing account: @{profile_name}")
        
        # Prepare profile path
        base_dir = os.getcwd()
        profile_path = os.path.join(base_dir, "profiles", profile_name)
        os.makedirs(profile_path, exist_ok=True)
        
        # Parse Proxy
        proxy_config = None
        if proxy_str and proxy_str.lower() not in ["none", ""]:
            proxy_config = parse_proxy_string(proxy_str)

        try:
            self.log(f"🚀 Launching browser for @{profile_name}...")
            
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
                self.current_context = context
                if len(context.pages) > 0:
                    page = context.pages[0]
                else:
                    page = context.new_page()

                # Navigate to Instagram
                if page.url == "about:blank":
                    page.goto("https://www.instagram.com", timeout=15000)
                
                # Define Actions Map
                actions_map = {
                    "Feed Scroll": lambda: self._run_scrolling(page, account, mode="feed"),
                    "Reels Scroll": lambda: self._run_scrolling(page, account, mode="reels"),
                    "Follow": lambda: self._run_follow(page, account),
                    "Unfollow": lambda: self._run_unfollow_only(page, account),
                    "Approve Requests": lambda: self._run_approve_only(page, account),
                    "Send Messages": lambda: self._run_message_only(page, account)
                }
                
                # Use provided order or default fallback
                # Default order: Feed, Follow, Unfollow, Approve, Message
                order = self.config.action_order
                if not order:
                    order = []
                    if self.config.enable_feed: order.append("Feed Scroll")
                    if self.config.enable_reels: order.append("Reels Scroll")
                    if self.config.enable_follow: order.append("Follow")
                    if self.config.enable_unfollow: order.append("Unfollow")
                    if self.config.enable_approve: order.append("Approve Requests")
                    if self.config.enable_message: order.append("Send Messages")
                
                self.log(f"📋 Execution Order: {', '.join(order)}")
                
                for action_name in order:
                    if not self.running: break
                    
                    if action_name in actions_map:
                        # Check enablement again just in case, though order usually comes from enabled items
                        # But user might have dragged disabled items in UI? 
                        # We'll assume the list passed in `config.action_order` ONLY contains enabled items.
                        # But let's double check config flags for safety.
                        should_run = False
                        if action_name == "Feed Scroll" and self.config.enable_feed: should_run = True
                        elif action_name == "Reels Scroll" and self.config.enable_reels: should_run = True
                        elif action_name == "Follow" and self.config.enable_follow: should_run = True
                        elif action_name == "Unfollow" and self.config.enable_unfollow: should_run = True
                        elif action_name == "Approve Requests" and self.config.enable_approve: should_run = True
                        elif action_name == "Send Messages" and self.config.enable_message: should_run = True
                        
                        if should_run:
                            # self.log(f"▶️ Starting task: {action_name}")
                            actions_map[action_name]()
                            
                            if self.running:
                                delay = random.randint(3, 7)
                                # self.log(f"⏳ Short pause {delay}s...")
                                time.sleep(delay)

                self.log(f"✅ All tasks finished for @{profile_name}")
                self.current_context = None

        except Exception as e:
            self.log(f"❌ Error processing @{profile_name}: {e}")
            # traceback.print_exc() 

    def _run_scrolling(self, page, account, mode="feed"):
        """Execute scrolling logic reusing the page"""
        try:
            duration = 0
            if mode == "feed" and self.config.enable_feed:
                duration = random.randint(self.config.feed_min_time_minutes, self.config.feed_max_time_minutes)
            elif mode == "reels" and self.config.enable_reels:
                duration = random.randint(self.config.reels_min_time_minutes, self.config.reels_max_time_minutes)
            
            if duration <= 0: return

            self.log(f"📜 Starting {mode.capitalize()} Scroll ({duration}m)...")

            config = {
                'like_chance': self.config.like_chance if mode == "feed" else self.config.reels_like_chance,
                'comment_chance': self.config.comment_chance,
                'follow_chance': self.config.follow_chance if mode == "feed" else self.config.reels_follow_chance,
                'carousel_watch_chance': self.config.carousel_watch_chance,
                'carousel_max_slides': self.config.carousel_max_slides,
                'watch_stories': self.config.watch_stories,
                'stories_max': self.config.stories_max,
            }

            if mode == 'feed':
                scroll_feed(page, duration, config)
            elif mode == 'reels':
                scroll_reels(page, duration, config)
                
        except Exception as e:
            self.log(f"⚠️ Scrolling error: {e}")

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

    # Legacy method kept for safety if needed, but refactored logic is above
    def _run_unfollow_group(self, page, account):
        pass
    
    def stop(self):
        """Stop the worker"""
        self.running = False
        self.log("🛑 Stopping automation...")
        # Since we run in-process, we can't easily 'kill' the thread safely if it's blocked in a C extension or sleep.
        # But we check `self.running` frequently.
        # We can also close the context if it exists.
        # But closing context from another thread might be unsafe if not thread-safe.
        # Camoufox/Playwright context.close() might be callable.
        # But usually we wait for the loop to exit.
    
    def log(self, message: str):
        """Send log message to UI"""
        self.log_signal.emit(message)


class OnboardingWorker(QThread):
    """Worker thread for account onboarding"""
    
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()
    
    def __init__(self, accounts: List[ThreadsAccount], parallel_count: int = 1):
        super().__init__()
        self.accounts = accounts
        self.parallel_count = parallel_count
        self.current_process = None
        self.running = True
        
    def stop(self):
        self.running = False
        if self.current_process and self.current_process.poll() is None:
            _kill_process_tree(self.current_process, self.log)
            self.current_process = None
        
    def run(self):
        """Onboard accounts"""
        self.log(f"🎯 Starting onboarding for {len(self.accounts)} accounts...")
        
        try:
            for i, account in enumerate(self.accounts, 1):
                if not self.running:
                    break
                    
                self.log(f"[{i}/{len(self.accounts)}] Onboarding @{account.username}...")
                
                # Launch browser for onboarding
                profile_name = account.username
                proxy_str = account.proxy or "None"
                
                cmd = [
                    sys.executable, "launcher.py", 
                    "--name", profile_name, 
                    "--proxy", proxy_str,
                    "--action", "onboard"
                ]
                
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
    
    def log(self, message: str):
        self.log_signal.emit(message)
