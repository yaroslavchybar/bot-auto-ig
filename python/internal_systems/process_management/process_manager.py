import subprocess
import sys
import os
import psutil
import threading
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class MemoryWatchdog(threading.Thread):
    def __init__(self, process_manager, limit_mb=2048, check_interval=30):
        super().__init__(daemon=True)
        self.pm = process_manager
        self.limit_mb = limit_mb
        self.check_interval = check_interval
        self._stop_event = threading.Event()
    
    def run(self):
        while not self._stop_event.wait(self.check_interval):
            exceeding = self.pm.check_memory_limits(self.limit_mb)
            for name in exceeding:
                logger.warning(f"Memory limit exceeded for {name}. Restarting...")
                self.pm.stop_profile(name)
    
    def stop(self):
        self._stop_event.set()

class ProcessManager:
    SIGNATURE_PATTERNS = ["camoufox", "firefox"]

    def __init__(self):
        self.running_processes = {}

    def cleanup_orphaned_processes(self) -> int:
        """Kill processes matching our signatures but not tracked by us.
        Returns count of terminated processes."""
        cleaned = 0
        current_pid = os.getpid()
        tracked_pids = {p.pid for p in self.running_processes.values()}
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        profiles_dir = os.path.normcase(os.path.join(project_root, "python", "data", "profiles"))
        
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                if proc.pid in tracked_pids or proc.pid == current_pid:
                    continue
                cmdline_list = proc.info.get('cmdline') or []
                cmdline = " ".join(cmdline_list)
                cmdline_lower = cmdline.lower()

                should_terminate = False
                if "camoufox" in cmdline_lower:
                    should_terminate = True
                elif "firefox" in cmdline_lower:
                    if profiles_dir and profiles_dir in os.path.normcase(cmdline):
                        should_terminate = True

                if should_terminate:
                    proc.terminate()
                    cleaned += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
        return cleaned

    def get_memory_usage(self, name: str) -> Optional[int]:
        """Get memory usage in MB for a tracked process."""
        if name not in self.running_processes:
            return None
        try:
            proc = psutil.Process(self.running_processes[name].pid)
            return proc.memory_info().rss // (1024 * 1024)
        except psutil.NoSuchProcess:
            return None

    def check_memory_limits(self, limit_mb: int = 2048) -> list[str]:
        """Return names of processes exceeding memory limit."""
        exceeding = []
        for name in list(self.running_processes.keys()):
            usage = self.get_memory_usage(name)
            if usage and usage > limit_mb:
                exceeding.append(name)
        return exceeding

    def start_profile(self, name, proxy, action="manual", **kwargs):
        if name in self.running_processes:
            return False, "Profile already running"

        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        launcher_path = os.path.join(project_root, "python", "launcher.py")
        cmd = [sys.executable, launcher_path, "--name", name, "--proxy", proxy, "--action", action]
        
        # Add kwargs as arguments
        for key, value in kwargs.items():
            if value is None:
                continue
            # Convert key from snake_case to kebab-case (e.g. match_likes -> --match-likes)
            arg_key = key.replace('_', '-')
            cmd.extend([f"--{arg_key}", str(value)])
        
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        
        # If manual, we might hide console or show? 
        # Usually for automation we want to see it or hide it.
        # Let's keep existing behavior: manual = hidden console (but browser window shows)
        if action == "manual":
            startupinfo.wShowWindow = subprocess.SW_HIDE
            creationflags = subprocess.CREATE_NO_WINDOW
        else:
            # Automation tasks
            startupinfo.wShowWindow = subprocess.SW_SHOW # Show console for logs?
            # Or SW_HIDE if we redirect output. 
            # User previously had SW_SHOW for automation to see browser opening.
            # Camoufox opens browser window regardless of console visibility unless headless.
            # Let's hide console to be cleaner, but ensure browser opens.
            startupinfo.wShowWindow = subprocess.SW_HIDE
            creationflags = subprocess.CREATE_NO_WINDOW

        try:
            process = subprocess.Popen(
                cmd,
                cwd=project_root,
                startupinfo=startupinfo,
                creationflags=creationflags,
            )
            self.running_processes[name] = process
            return True, "Started"
        except Exception as e:
            return False, str(e)

    def stop_profile(self, name):
        if name not in self.running_processes:
            return False
        
        process = self.running_processes[name]
        try:
            process.terminate()
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
        except Exception:
            pass
        
        del self.running_processes[name]
        return True
    
    def is_running(self, name):
        if name in self.running_processes:
            if self.running_processes[name].poll() is None:
                return True
            else:
                del self.running_processes[name]
        return False
