import time
import random
import requests
import logging
from typing import Optional, Any
from requests.exceptions import RequestException, HTTPError, Timeout, ConnectionError
from python.core.resilience.retry import retry_with_backoff, calculate_sleep_time

# Configure logging
logger = logging.getLogger(__name__)

class CircuitBreakerOpenError(Exception):
    """Raised when the circuit breaker is open."""
    pass

class CircuitBreaker:
    def __init__(self, threshold: int = 5, recovery_timeout: int = 60):
        self.threshold = threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = 0
        self.is_open = False

    def record_success(self):
        """Reset failure count on success."""
        if self.is_open:
            logger.info("Circuit breaker recovering - closing circuit.")
        self.failure_count = 0
        self.is_open = False

    def record_failure(self):
        """Record a failure and potentially open the circuit."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.failure_count >= self.threshold:
            if not self.is_open:
                logger.warning(f"Circuit breaker tripped! Open for {self.recovery_timeout}s.")
            self.is_open = True

    def check_state(self):
        """Check if request is allowed to proceed."""
        if self.is_open:
            elapsed = time.time() - self.last_failure_time
            if elapsed > self.recovery_timeout:
                # Half-open state: allow one request to try
                logger.info("Circuit breaker recovery timeout passed - attempting probe.")
                return
            raise CircuitBreakerOpenError(f"Circuit is open. Retry in {int(self.recovery_timeout - elapsed)}s")

class ResilientHttpClient:
    """
    HTTP client with retry, exponential backoff, jitter, and circuit breaker.
    """
    
    def __init__(
        self, 
        max_retries: int = 3, 
        circuit_threshold: int = 5, 
        circuit_timeout: int = 60,
        backoff_factor: float = 1.0
    ):
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.circuit_breaker = CircuitBreaker(threshold=circuit_threshold, recovery_timeout=circuit_timeout)
        self._session = requests.Session() # We manage our own session or could use shared one

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        """
        Execute HTTP request with resilience patterns.
        """
        # 1. Check Circuit Breaker
        self.circuit_breaker.check_state()

        last_exception = None
        
        for attempt in range(self.max_retries + 1):
            try:
                # Calculate timeout if not provided
                if 'timeout' not in kwargs:
                    kwargs['timeout'] = (10, 30) # (connect, read)

                response = self._session.request(method, url, **kwargs)
                
                # Check for 5xx errors or 429 (Rate Limit) to treat as failures for retry
                if response.status_code >= 500 or response.status_code == 429:
                    response.raise_for_status()

                # Success!
                self.circuit_breaker.record_success()
                return response

            except (RequestException, ConnectionError, Timeout, HTTPError) as e:
                last_exception = e
                logger.warning(f"Request failed (attempt {attempt + 1}/{self.max_retries + 1}): {e}")
                
                # If it's the last attempt, don't sleep, just record failure
                if attempt == self.max_retries:
                    break
                
                # Exponential backoff with jitter
                sleep_time = calculate_sleep_time(attempt, self.backoff_factor)
                time.sleep(sleep_time)
        
        # If we get here, all retries failed
        self.circuit_breaker.record_failure()
        raise last_exception

    def get(self, url: str, **kwargs) -> requests.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> requests.Response:
        return self.request("POST", url, **kwargs)

    def patch(self, url: str, **kwargs) -> requests.Response:
        return self.request("PATCH", url, **kwargs)

    def delete(self, url: str, **kwargs) -> requests.Response:
        return self.request("DELETE", url, **kwargs)

    def put(self, url: str, **kwargs) -> requests.Response:
        return self.request("PUT", url, **kwargs)
