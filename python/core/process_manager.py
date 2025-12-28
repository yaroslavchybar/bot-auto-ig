import subprocess
import sys
import os

class ProcessManager:
    def __init__(self):
        self.running_processes = {}

    def start_profile(self, name, proxy, action="manual", **kwargs):
        if name in self.running_processes:
            return False, "Profile already running"

        cmd = [sys.executable, "launcher.py", "--name", name, "--proxy", proxy, "--action", action]
        
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
            process = subprocess.Popen(cmd, startupinfo=startupinfo, creationflags=creationflags)
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
