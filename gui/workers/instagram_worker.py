import sys
import os
import random
import signal
import time
import subprocess
from typing import List
from PyQt6.QtCore import QThread, pyqtSignal
from core.models import ScrollingConfig, ThreadsAccount

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
    """Worker thread for automated scrolling"""
    
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()
    
    def __init__(self, config: ScrollingConfig, accounts: List[ThreadsAccount], profile_names: List[str]):
        super().__init__()
        self.config = config
        self.accounts = accounts
        self.profile_names = profile_names
        self.running = True
        self.current_process = None
        
    def run(self):
        """Main worker loop"""
        self.log("🚀 Starting scrolling automation...")
        
        while self.running:
            try:
                # Scroll for each account
                for account in self.accounts:
                    if not self.running:
                        break
                        
                    self.scroll_for_account(account)
                    
                    # Random delay between accounts
                    if self.running:
                        delay = random.randint(10, 30)
                        self.log(f"⏳ Waiting {delay}s before next account...")
                        time.sleep(delay)
                
                # Wait for cycle interval
                if self.running:
                    minutes = self.config.cycle_interval_minutes
                    self.log(f"⌛ Cycle complete. Waiting {minutes} minutes...")
                    
                    # Sleep in small increments
                    for _ in range(minutes * 60):
                        if not self.running:
                            break
                        time.sleep(1)
                        
            except Exception as e:
                self.log(f"❌ Error in scrolling worker: {e}")
                time.sleep(30)
        
        self.log("⏹️ Scrolling automation stopped")
        self.finished_signal.emit()

    def scroll_for_account(self, account: ThreadsAccount):
        """Scroll and engage for a specific account"""
        try:
            # 2. Determine action parameters and calculate durations
            action_args = {}
            target_action = "scroll" # default

            if self.config.enable_feed and self.config.enable_reels:
                # Both enabled: Mixed mode
                feed_duration = random.randint(self.config.feed_min_time_minutes, self.config.feed_max_time_minutes)
                reels_duration = random.randint(self.config.reels_min_time_minutes, self.config.reels_max_time_minutes)

                target_action = "mixed"
                action_args = {
                    "feed_duration": feed_duration,
                    "reels_duration": reels_duration
                }
                self.log(f"📋 Mixed Mode: Feed {feed_duration}m + Reels {reels_duration}m")

            elif self.config.enable_feed:
                feed_duration = random.randint(self.config.feed_min_time_minutes, self.config.feed_max_time_minutes)
                target_action = "scroll"
                action_args = {"duration": feed_duration}
                self.log(f"⏱️ Feed session time for @{account.username}: {feed_duration} min")

            elif self.config.enable_reels:
                reels_duration = random.randint(self.config.reels_min_time_minutes, self.config.reels_max_time_minutes)
                target_action = "reels"
                action_args = {"duration": reels_duration}
                self.log(f"⏱️ Reels session time for @{account.username}: {reels_duration} min")
            
            # 3. Execute action
            if self.running:
                self.log(f"▶️ Starting {target_action} session for @{account.username}...")
                
                # Prepare arguments for launcher.py
                profile_name = account.username
                proxy_str = account.proxy or "None"
                feed_like = self.config.like_chance
                feed_follow = self.config.follow_chance
                reels_like = getattr(self.config, "reels_like_chance", feed_like)
                reels_follow = getattr(self.config, "reels_follow_chance", feed_follow)

                action_like = reels_like if target_action == "reels" else feed_like
                action_follow = reels_follow if target_action == "reels" else feed_follow
                
                cmd = [
                    sys.executable, "launcher.py", 
                    "--name", profile_name,
                    "--proxy", proxy_str,
                    "--action", target_action,
                    "--match-likes", str(action_like),
                    "--match-comments", str(self.config.comment_chance),
                    "--match-follows", str(action_follow),
                    "--carousel-watch-chance", str(getattr(self.config, "carousel_watch_chance", 0)),
                    "--carousel-max-slides", str(getattr(self.config, "carousel_max_slides", 3)),
                    "--watch-stories", str(int(getattr(self.config, "watch_stories", True))),
                    "--stories-max", str(getattr(self.config, "stories_max", 3)),
                    "--reels-match-likes", str(reels_like),
                    "--reels-match-follows", str(reels_follow),
                ]
                
                # Add duration args based on action
                if target_action == "mixed":
                    cmd.extend(["--feed-duration", str(action_args["feed_duration"])])
                    cmd.extend(["--reels-duration", str(action_args["reels_duration"])])
                else:
                    cmd.extend(["--duration", str(action_args["duration"])])
                
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 5  # SW_SHOW

                self.current_process = subprocess.Popen(
                    cmd,
                    startupinfo=startupinfo,
                    creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
                self.log(f"🚀 Browser launched for {target_action}")
                
                self.current_process.wait()
                self.current_process = None
                
                self.log(f"✅ Session finished for @{account.username}")
            
            self.log(f"🏁 Session complete for @{account.username}")
            
        except Exception as e:
            self.log(f"❌ Error scrolling for @{account.username}: {e}")
    
    def stop(self):
        """Stop the worker"""
        self.running = False
        self.log("🛑 Stopping scrolling automation...")
        
        # Kill current browser process if running
        if self.current_process and self.current_process.poll() is None:
            self.log("🛑 Terminating browser process...")
            _kill_process_tree(self.current_process, self.log)
            self.current_process = None
    
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
