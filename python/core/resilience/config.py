from dataclasses import dataclass

@dataclass
class ResilienceConfig:
    # Supervisor
    MAX_RETRIES: int = 5
    BACKOFF_BASE: float = 2.0
    
    # Memory watchdog
    MEMORY_LIMIT_MB: int = 2048
    MEMORY_CHECK_INTERVAL: int = 30
    
    # Traffic monitor
    TRAFFIC_ERROR_THRESHOLD: int = 5
    TRAFFIC_WINDOW_SECS: int = 30
    COOLDOWN_DURATION: int = 120
    
    # Proxy health
    PROXY_FAILURE_THRESHOLD: int = 3
    PROXY_TAINT_DURATION: int = 1800  # 30 min
    
    # Circuit breaker
    CIRCUIT_THRESHOLD: int = 5
    CIRCUIT_RECOVERY_TIMEOUT: int = 60

config = ResilienceConfig()
