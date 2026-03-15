import time
import requests
import logging
from enum import Enum
from typing import Optional, Any
from requests.exceptions import RequestException, HTTPError, Timeout, ConnectionError
from python.core.errors.retry import calculate_sleep_time

logger = logging.getLogger(__name__)


class CircuitBreakerOpenError(Exception):
    """Raised when the circuit breaker is open."""
    pass


class CircuitState(Enum):
    """Explicit states for the circuit breaker."""
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """
    Circuit breaker with three states: closed, open, half-open.

    - CLOSED: requests flow normally; consecutive failures are counted.
    - OPEN: all requests fail-fast with CircuitBreakerOpenError.
    - HALF_OPEN: one probe request is allowed after recovery_timeout;
      success closes the circuit, failure re-opens it immediately.
    """

    def __init__(self, threshold: int = 5, recovery_timeout: int = 60):
        self.threshold = threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time: float = 0
        self._state = CircuitState.CLOSED

    @property
    def state(self) -> CircuitState:
        return self._state

    @property
    def is_open(self) -> bool:
        """Backward-compatible property: True when state is OPEN."""
        return self._state == CircuitState.OPEN

    @is_open.setter
    def is_open(self, value: bool) -> None:
        """Backward-compatible setter for legacy test setup."""
        if value:
            self._state = CircuitState.OPEN
        else:
            self._state = CircuitState.CLOSED

    def record_success(self) -> None:
        """Reset failure count and close the circuit."""
        if self._state != CircuitState.CLOSED:
            logger.info("Circuit breaker recovering - closing circuit.")
        self.failure_count = 0
        self._state = CircuitState.CLOSED

    def record_failure(self) -> None:
        """Record a failure and potentially open the circuit."""
        self.failure_count += 1
        self.last_failure_time = time.time()

        if self._state == CircuitState.HALF_OPEN:
            # Probe failed — immediately re-open the circuit
            logger.warning(
                f"Circuit breaker probe failed. Re-opening for {self.recovery_timeout}s."
            )
            self._state = CircuitState.OPEN
        elif self.failure_count >= self.threshold:
            if self._state != CircuitState.OPEN:
                logger.warning(
                    f"Circuit breaker tripped after {self.failure_count} failures! "
                    f"Open for {self.recovery_timeout}s."
                )
            self._state = CircuitState.OPEN

    def check_state(self) -> None:
        """Check if request is allowed to proceed.

        Raises CircuitBreakerOpenError if the circuit is open and
        recovery_timeout has not elapsed.  Transitions to HALF_OPEN
        when the timeout passes so that exactly one probe is allowed.
        """
        if self._state == CircuitState.CLOSED:
            return

        if self._state == CircuitState.HALF_OPEN:
            # Already in half-open — only one probe allowed at a time.
            # Subsequent callers must wait until the probe resolves.
            raise CircuitBreakerOpenError(
                "Circuit is half-open. A probe request is already in progress."
            )

        # State is OPEN
        elapsed = time.time() - self.last_failure_time
        if elapsed > self.recovery_timeout:
            logger.info("Circuit breaker recovery timeout passed - entering half-open state.")
            self._state = CircuitState.HALF_OPEN
            return

        raise CircuitBreakerOpenError(
            f"Circuit is open. Retry in {int(self.recovery_timeout - elapsed)}s"
        )

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
