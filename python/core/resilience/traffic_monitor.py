from collections import deque
import time
from python.core.resilience.config import config

class TrafficMonitor:
    def __init__(self, window_secs=None, error_threshold=None):
        self.errors = deque()
        self.window_secs = window_secs or config.TRAFFIC_WINDOW_SECS
        self.error_threshold = error_threshold or config.TRAFFIC_ERROR_THRESHOLD
        self.cooldown_until = 0
    
    def on_response(self, response):
        try:
            if response.status in (429, 500, 502, 503, 504):
                self._record_error(response.status)
        except Exception:
            # Prevent monitoring logic from crashing the page
            pass
    
    def _record_error(self, status):
        now = time.time()
        self.errors.append(now)
        # Prune old errors
        while self.errors and now - self.errors[0] > self.window_secs:
            self.errors.popleft()
        
        if len(self.errors) >= self.error_threshold:
            self.cooldown_until = now + config.COOLDOWN_DURATION  # 2-minute cooldown
    
    def should_pause(self) -> bool:
        return time.time() < self.cooldown_until
