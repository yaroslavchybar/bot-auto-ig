import unittest
from unittest.mock import Mock, patch
import time
from requests.exceptions import ConnectionError, Timeout
from python.internal_systems.error_handling.http_client import ResilientHttpClient, CircuitBreakerOpenError

class TestResilientHttpClient(unittest.TestCase):
    def setUp(self):
        self.client = ResilientHttpClient(
            max_retries=2, 
            circuit_threshold=3, 
            circuit_timeout=1, # Short timeout for testing
            backoff_factor=0.01 # Fast retries
        )
        # Mock the internal session
        self.client._session = Mock()

    def test_successful_request(self):
        """Test a normal successful request."""
        mock_response = Mock()
        mock_response.status_code = 200
        self.client._session.request.return_value = mock_response

        response = self.client.get("http://example.com")
        
        self.assertEqual(response, mock_response)
        self.assertEqual(self.client._session.request.call_count, 1)
        self.assertEqual(self.client.circuit_breaker.failure_count, 0)

    def test_retry_on_failure(self):
        """Test that client retries on connection error."""
        self.client._session.request.side_effect = [
            ConnectionError("Fail 1"),
            ConnectionError("Fail 2"),
            Mock(status_code=200) # Success on 3rd try (2nd retry)
        ]

        response = self.client.get("http://example.com")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client._session.request.call_count, 3)
        # Circuit breaker should record success after the final successful attempt
        self.assertEqual(self.client.circuit_breaker.failure_count, 0)

    def test_circuit_breaker_trips(self):
        """Test that circuit breaker opens after threshold failures."""
        self.client._session.request.side_effect = ConnectionError("Fail")

        # 1. Fail max_retries+1 times (1 call) -> +1 failure count
        with self.assertRaises(ConnectionError):
            self.client.get("http://example.com")
        
        self.assertEqual(self.client.circuit_breaker.failure_count, 1)

        # 2. Fail again
        with self.assertRaises(ConnectionError):
            self.client.get("http://example.com")
        self.assertEqual(self.client.circuit_breaker.failure_count, 2)

        # 3. Fail again -> Threshold reached (3)
        with self.assertRaises(ConnectionError):
            self.client.get("http://example.com")
        self.assertTrue(self.client.circuit_breaker.is_open)

        # 4. Next call should raise CircuitBreakerOpenError immediately
        self.client._session.request.reset_mock()
        with self.assertRaises(CircuitBreakerOpenError):
            self.client.get("http://example.com")
        
        # Should not have called request
        self.client._session.request.assert_not_called()

    def test_circuit_breaker_recovery(self):
        """Test half-open state and recovery."""
        # Trip the breaker manually
        self.client.circuit_breaker.is_open = True
        self.client.circuit_breaker.last_failure_time = time.time() - 2 # Past the 1s timeout

        # Next request should be allowed (half-open)
        mock_response = Mock()
        mock_response.status_code = 200
        self.client._session.request.side_effect = None
        self.client._session.request.return_value = mock_response

        response = self.client.get("http://example.com")
        
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.client.circuit_breaker.is_open)
        self.assertEqual(self.client.circuit_breaker.failure_count, 0)

if __name__ == '__main__':
    unittest.main()
