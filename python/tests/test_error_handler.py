import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import unittest
from python.internal_systems.error_handling.error_handler import classify_exception, ErrorDecision
from python.internal_systems.error_handling.exceptions import (
    TransientError,
    StaleStateError,
    RateLimitException,
    FatalError,
    AccountBannedException,
    NetworkError,
    ElementNotFoundError
)

class TestErrorHandler(unittest.TestCase):
    def test_classify_transient(self):
        self.assertEqual(classify_exception(TransientError()), ErrorDecision.RETRY)
        self.assertEqual(classify_exception(NetworkError()), ErrorDecision.RETRY)
        
    def test_classify_stale_state(self):
        self.assertEqual(classify_exception(StaleStateError()), ErrorDecision.RESTART_BROWSER)
        
    def test_classify_rate_limit(self):
        self.assertEqual(classify_exception(RateLimitException()), ErrorDecision.BACKOFF_AND_SLOW)
        
    def test_classify_fatal(self):
        self.assertEqual(classify_exception(FatalError()), ErrorDecision.ABORT)
        self.assertEqual(classify_exception(AccountBannedException()), ErrorDecision.ABORT)
        
    def test_classify_unknown(self):
        self.assertEqual(classify_exception(ValueError("Unknown")), ErrorDecision.ABORT)
        
    def test_classify_element_not_found(self):
        self.assertEqual(classify_exception(ElementNotFoundError()), ErrorDecision.RETRY)

if __name__ == "__main__":
    unittest.main()
