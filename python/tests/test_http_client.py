import unittest
from unittest.mock import Mock, patch
import time
from requests.exceptions import ConnectionError, Timeout
from python.core.errors.http_client import (
    ResilientHttpClient,
    CircuitBreaker,
    CircuitBreakerOpenError,
    CircuitState,
)


class TestCircuitBreakerStates(unittest.TestCase):
    """Test CircuitBreaker state machine: closed → open → half-open → closed/open."""

    def setUp(self):
        self.cb = CircuitBreaker(threshold=3, recovery_timeout=1)

    # -- Closed state ---------------------------------------------------

    def test_initial_state_is_closed(self):
        self.assertEqual(self.cb.state, CircuitState.CLOSED)
        self.assertFalse(self.cb.is_open)
        self.assertEqual(self.cb.failure_count, 0)

    def test_check_state_allows_request_when_closed(self):
        """No exception raised in closed state."""
        self.cb.check_state()  # should not raise

    def test_record_success_keeps_closed(self):
        self.cb.record_success()
        self.assertEqual(self.cb.state, CircuitState.CLOSED)

    def test_failures_below_threshold_stay_closed(self):
        for _ in range(2):
            self.cb.record_failure()
        self.assertEqual(self.cb.state, CircuitState.CLOSED)
        self.assertEqual(self.cb.failure_count, 2)

    # -- Closed → Open transition (threshold reached) ------------------

    def test_failures_at_threshold_open_circuit(self):
        for _ in range(3):
            self.cb.record_failure()
        self.assertEqual(self.cb.state, CircuitState.OPEN)
        self.assertTrue(self.cb.is_open)
        self.assertEqual(self.cb.failure_count, 3)

    def test_open_circuit_raises_on_check(self):
        for _ in range(3):
            self.cb.record_failure()
        with self.assertRaises(CircuitBreakerOpenError):
            self.cb.check_state()

    def test_additional_failures_in_open_state_stay_open(self):
        for _ in range(5):
            self.cb.record_failure()
        self.assertEqual(self.cb.state, CircuitState.OPEN)

    # -- Open → Half-Open transition (recovery timeout) ----------------

    def test_half_open_after_recovery_timeout(self):
        """After recovery_timeout, check_state transitions to HALF_OPEN."""
        for _ in range(3):
            self.cb.record_failure()
        self.assertEqual(self.cb.state, CircuitState.OPEN)

        # Simulate timeout passing
        self.cb.last_failure_time = time.time() - 2

        self.cb.check_state()  # should NOT raise — enters half-open
        self.assertEqual(self.cb.state, CircuitState.HALF_OPEN)

    def test_half_open_blocks_second_caller(self):
        """Once in HALF_OPEN, a second check_state raises (only one probe)."""
        for _ in range(3):
            self.cb.record_failure()
        self.cb.last_failure_time = time.time() - 2

        self.cb.check_state()  # first caller enters half-open
        self.assertEqual(self.cb.state, CircuitState.HALF_OPEN)

        with self.assertRaises(CircuitBreakerOpenError):
            self.cb.check_state()  # second caller blocked

    # -- Half-Open → Closed (probe success) ----------------------------

    def test_probe_success_closes_circuit(self):
        """A successful probe in half-open resets to closed."""
        for _ in range(3):
            self.cb.record_failure()
        self.cb.last_failure_time = time.time() - 2
        self.cb.check_state()  # enter half-open

        self.cb.record_success()
        self.assertEqual(self.cb.state, CircuitState.CLOSED)
        self.assertEqual(self.cb.failure_count, 0)

    # -- Half-Open → Open (probe failure) ------------------------------

    def test_probe_failure_reopens_circuit(self):
        """A failed probe in half-open immediately re-opens the circuit."""
        for _ in range(3):
            self.cb.record_failure()
        self.cb.last_failure_time = time.time() - 2
        self.cb.check_state()  # enter half-open

        self.cb.record_failure()  # probe fails
        self.assertEqual(self.cb.state, CircuitState.OPEN)

    def test_probe_failure_reopen_blocks_next_call(self):
        """After re-opening from half-open, check_state raises immediately."""
        for _ in range(3):
            self.cb.record_failure()
        self.cb.last_failure_time = time.time() - 2
        self.cb.check_state()  # enter half-open

        self.cb.record_failure()  # probe fails → re-open

        with self.assertRaises(CircuitBreakerOpenError):
            self.cb.check_state()

    # -- Full lifecycle: closed → open → half-open → closed ------------

    def test_full_lifecycle(self):
        """Exercise the complete state machine loop."""
        # 1. Start CLOSED
        self.assertEqual(self.cb.state, CircuitState.CLOSED)

        # 2. Accumulate failures → OPEN
        for _ in range(3):
            self.cb.record_failure()
        self.assertEqual(self.cb.state, CircuitState.OPEN)

        # 3. Wait for timeout → HALF_OPEN
        self.cb.last_failure_time = time.time() - 2
        self.cb.check_state()
        self.assertEqual(self.cb.state, CircuitState.HALF_OPEN)

        # 4. Probe succeeds → CLOSED
        self.cb.record_success()
        self.assertEqual(self.cb.state, CircuitState.CLOSED)
        self.assertEqual(self.cb.failure_count, 0)

    def test_full_lifecycle_with_probe_failure(self):
        """Lifecycle with a failed probe that re-opens, then eventually closes."""
        # 1. CLOSED → OPEN
        for _ in range(3):
            self.cb.record_failure()
        self.assertEqual(self.cb.state, CircuitState.OPEN)

        # 2. OPEN → HALF_OPEN
        self.cb.last_failure_time = time.time() - 2
        self.cb.check_state()
        self.assertEqual(self.cb.state, CircuitState.HALF_OPEN)

        # 3. Probe fails → back to OPEN
        self.cb.record_failure()
        self.assertEqual(self.cb.state, CircuitState.OPEN)

        # 4. Wait again → HALF_OPEN
        self.cb.last_failure_time = time.time() - 2
        self.cb.check_state()
        self.assertEqual(self.cb.state, CircuitState.HALF_OPEN)

        # 5. Probe succeeds → CLOSED
        self.cb.record_success()
        self.assertEqual(self.cb.state, CircuitState.CLOSED)

    # -- Backward-compatible is_open setter ----------------------------

    def test_is_open_setter_true(self):
        self.cb.is_open = True
        self.assertEqual(self.cb.state, CircuitState.OPEN)

    def test_is_open_setter_false(self):
        self.cb.is_open = True
        self.cb.is_open = False
        self.assertEqual(self.cb.state, CircuitState.CLOSED)

    # -- Default threshold and timeout ---------------------------------

    def test_default_threshold_is_five(self):
        cb = CircuitBreaker()
        self.assertEqual(cb.threshold, 5)

    def test_default_recovery_timeout_is_sixty(self):
        cb = CircuitBreaker()
        self.assertEqual(cb.recovery_timeout, 60)


class TestResilientHttpClient(unittest.TestCase):
    """Integration tests: ResilientHttpClient with its CircuitBreaker."""

    def setUp(self):
        self.client = ResilientHttpClient(
            max_retries=2,
            circuit_threshold=3,
            circuit_timeout=1,  # Short timeout for testing
            backoff_factor=0.01,  # Fast retries
        )
        self.client._session = Mock()

    def test_successful_request(self):
        """Normal successful request resets circuit breaker."""
        mock_response = Mock()
        mock_response.status_code = 200
        self.client._session.request.return_value = mock_response

        response = self.client.get("http://example.com")

        self.assertEqual(response, mock_response)
        self.assertEqual(self.client._session.request.call_count, 1)
        self.assertEqual(self.client.circuit_breaker.failure_count, 0)
        self.assertEqual(self.client.circuit_breaker.state, CircuitState.CLOSED)

    def test_retry_on_failure_then_success(self):
        """Client retries and records success on eventual good response."""
        self.client._session.request.side_effect = [
            ConnectionError("Fail 1"),
            ConnectionError("Fail 2"),
            Mock(status_code=200),
        ]

        response = self.client.get("http://example.com")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client._session.request.call_count, 3)
        self.assertEqual(self.client.circuit_breaker.failure_count, 0)

    def test_circuit_breaker_trips_after_repeated_failures(self):
        """Circuit opens after threshold consecutive all-retries-exhausted calls."""
        self.client._session.request.side_effect = ConnectionError("Fail")

        # Each call exhausts retries (3 attempts) and records 1 failure
        for i in range(3):
            with self.assertRaises(ConnectionError):
                self.client.get("http://example.com")

        self.assertTrue(self.client.circuit_breaker.is_open)
        self.assertEqual(self.client.circuit_breaker.state, CircuitState.OPEN)

        # Next call should short-circuit without hitting the session
        self.client._session.request.reset_mock()
        with self.assertRaises(CircuitBreakerOpenError):
            self.client.get("http://example.com")
        self.client._session.request.assert_not_called()

    def test_circuit_breaker_recovery_on_probe_success(self):
        """Half-open probe success closes the circuit."""
        self.client.circuit_breaker.is_open = True
        self.client.circuit_breaker.last_failure_time = time.time() - 2

        mock_response = Mock()
        mock_response.status_code = 200
        self.client._session.request.return_value = mock_response

        response = self.client.get("http://example.com")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.client.circuit_breaker.is_open)
        self.assertEqual(self.client.circuit_breaker.state, CircuitState.CLOSED)
        self.assertEqual(self.client.circuit_breaker.failure_count, 0)

    def test_circuit_breaker_probe_failure_reopens(self):
        """Half-open probe failure re-opens the circuit."""
        self.client.circuit_breaker.is_open = True
        self.client.circuit_breaker.last_failure_time = time.time() - 2

        self.client._session.request.side_effect = ConnectionError("Probe fail")

        with self.assertRaises(ConnectionError):
            self.client.get("http://example.com")

        self.assertEqual(self.client.circuit_breaker.state, CircuitState.OPEN)

    def test_convenience_methods(self):
        """All HTTP verb helpers delegate to request correctly."""
        mock_response = Mock(status_code=200)
        self.client._session.request.return_value = mock_response

        for method_name in ("get", "post", "put", "patch", "delete"):
            method = getattr(self.client, method_name)
            resp = method("http://example.com")
            self.assertEqual(resp.status_code, 200)

    def test_5xx_treated_as_retryable(self):
        """Server errors trigger retries and eventual circuit breaker failure."""
        mock_response = Mock()
        mock_response.status_code = 503
        mock_response.raise_for_status = Mock(
            side_effect=ConnectionError("503 Server Error")
        )
        self.client._session.request.return_value = mock_response

        with self.assertRaises(ConnectionError):
            self.client.get("http://example.com")

        # 3 attempts (1 + 2 retries)
        self.assertEqual(self.client._session.request.call_count, 3)
        self.assertEqual(self.client.circuit_breaker.failure_count, 1)

    def test_429_treated_as_retryable(self):
        """Rate limit responses trigger retries."""
        mock_response = Mock()
        mock_response.status_code = 429
        mock_response.raise_for_status = Mock(
            side_effect=ConnectionError("429 Too Many Requests")
        )
        self.client._session.request.return_value = mock_response

        with self.assertRaises(ConnectionError):
            self.client.get("http://example.com")

        self.assertEqual(self.client._session.request.call_count, 3)


if __name__ == "__main__":
    unittest.main()
